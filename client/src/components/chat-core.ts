/**
 * client/src/components/chat-core.ts —— ChatUI 纯逻辑核心（CL-03）
 *
 * 职责：把「消息模型 + 消息流增删 + /api/chat 发送」抽成零 React 依赖的纯函数，
 * 便于 node 直接自检（与 avatar-canvas-core / voice-machine 惯例一致），
 * ChatUI.tsx 只做 React 绑定与 DOM 渲染。
 *
 * 链路（对齐契约 §2.1 / AP-02 Orchestrator）：
 *   POST /api/chat  {message, personaId?}  →  {reply, personaId, ok, durationMs}
 *
 * 边界（红线）：
 *  - 纯内存消息（组件状态），无持久化、无本地存储（红线 1）
 *  - 单一人设：不提供人设切换 UI（收敛，PS-03 另行实现）
 *  - sendChatMessage 接受 fetchImpl 注入（node 自检用 fake fetch，不发真实网络）
 */

/** 消息角色 */
export type ChatRole = 'user' | 'assistant';

/** 聊天消息（纯内存模型） */
export interface ChatMessage {
  /** 唯一 id（createMessageId 生成；也可外部注入便于测试断言） */
  id: string;
  role: ChatRole;
  /** 消息文本（assistant pending 时为 ''） */
  text: string;
  /** 时间戳（ms） */
  ts: number;
  /** 等待 AI 回复中（渲染打字占位） */
  pending?: boolean;
  /** 发送/请求失败（渲染错误样式） */
  error?: boolean;
}

/** /api/chat 响应（契约 §2.1） */
export interface ChatSendResult {
  ok: boolean;
  reply: string;
  personaId: string;
  durationMs: number;
}

/** sendChatMessage 输入（可注入项便于测试） */
export interface SendChatInput {
  /** 用户消息文本（必填，组件侧已 trim 校验） */
  text: string;
  /** 可选：指定人设 id（缺省服务端用当前活跃人设） */
  personaId?: string;
  /** API 地址（默认同源 /api/chat，vite 代理到后端 3000） */
  apiUrl?: string;
  /** 测试注入：fake fetch（缺省用全局 fetch） */
  fetchImpl?: typeof fetch;
  /** 中断信号（组件卸载/新发送时 abort 旧请求） */
  signal?: AbortSignal;
}

/**
 * 生成消息 id（时间戳 + 随机数，冲突可忽略；prefix 区分角色便于调试）。
 * 纯函数（node 可测：同前缀连续调用不重复）。
 */
export function createMessageId(prefix = 'msg'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 追加用户消息（trim 后空文本返回原数组，不产生空消息） */
export function addUserMessage(messages: ChatMessage[], text: string, id?: string): ChatMessage[] {
  const t = text.trim();
  if (!t) return messages;
  return [...messages, { id: id ?? createMessageId('u'), role: 'user', text: t, ts: Date.now() }];
}

/** 追加 AI pending 占位（等待回复期间显示打字动画） */
export function addPending(messages: ChatMessage[], id?: string): ChatMessage[] {
  return [...messages, { id: id ?? createMessageId('a'), role: 'assistant', text: '', ts: Date.now(), pending: true }];
}

/**
 * 用发送结果填充 pending 占位（成功 → 正常文本；失败 → error 标记 + 错误文案）。
 * pending 占位不存在时原样返回（防并发/卸载竞态）。
 */
export function resolvePending(messages: ChatMessage[], pendingId: string, result: ChatSendResult): ChatMessage[] {
  return messages.map((m) =>
    m.id === pendingId && m.pending
      ? { ...m, text: result.reply, pending: false, error: !result.ok }
      : m,
  );
}

/** 手动把 pending 标记为失败（网络层异常兜底，不经过 sendChatMessage 时用） */
export function markError(messages: ChatMessage[], pendingId: string, errorText: string): ChatMessage[] {
  return messages.map((m) =>
    m.id === pendingId && m.pending ? { ...m, text: errorText, pending: false, error: true } : m,
  );
}

/**
 * 发送聊天消息（POST /api/chat，契约 §2.1）。
 * 不抛错：网络失败 / 非 2xx / 响应结构异常 → 返回 ok:false + 友好文案（上层转 UI 展示）。
 */
export async function sendChatMessage(input: SendChatInput): Promise<ChatSendResult> {
  const { text, personaId, apiUrl = '/api/chat', fetchImpl = fetch, signal } = input;
  const fallback: ChatSendResult = { ok: false, reply: '', personaId: personaId ?? '', durationMs: 0 };
  try {
    const res = await fetchImpl(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, personaId }),
      signal,
    });
    if (!res.ok) {
      return { ...fallback, reply: `请求失败（HTTP ${res.status}）` };
    }
    const data = (await res.json()) as Partial<ChatSendResult>;
    return {
      ok: data.ok !== false && typeof data.reply === 'string',
      reply: typeof data.reply === 'string' ? data.reply : '（服务返回空回复）',
      personaId: typeof data.personaId === 'string' ? data.personaId : (personaId ?? ''),
      durationMs: typeof data.durationMs === 'number' ? data.durationMs : 0,
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    return { ...fallback, reply: `发送失败：${reason}` };
  }
}

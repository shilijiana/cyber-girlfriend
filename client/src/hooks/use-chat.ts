/**
 * client/src/hooks/use-chat.ts —— 文本聊天 Hook（CL-07，P2：调试/降级链路）
 *
 * 职责：把「文本消息 → POST /api/chat → 展示回复」封装为 React 状态与命令，
 *   供 ChatUI（CL-03）与调试页消费。语音为主链路（CL-06 useVoice），
 *   文本聊天是调试/降级通道（契约 §2.1 / AP-02 Core Orchestrator 完整链路）。
 *
 * 实现说明（2026-08-09 并发协调）：消息模型与发送逻辑复用 CL-03 的纯函数核心
 *   `chat-core.ts`（契约 v1.11 引用，消息流 addUserMessage/addPending/resolvePending/
 *   markError + sendChatMessage 可注入 fetch）——本 Hook 只做 React 状态绑定，
 *   不重复实现消息/请求逻辑（防双模型漂移）。
 *
 * 链路（对齐契约 §2.1 REST API）：
 *   sendMessage(text)
 *     ├─ 追加 user 消息 + assistant pending 占位（打字动画）→ isLoading=true
 *     ├─ POST /api/chat  body: { message, personaId? }
 *     ├─ resolvePending：ok=true → 正常回复；ok=false → 错误文案（error 样式）
 *     ├─ 网络/HTTP 异常 → sendChatMessage 兜底 ok:false + 友好文案（不抛错）
 *     └─ isLoading=false
 *
 * 红线：零持久化（不存 localStorage / sessionStorage 草稿，纯内存）；
 *   零第三方依赖（原生 fetch，无 uuid / axios）。
 */

import { useCallback, useRef, useState } from 'react';
import {
  addPending,
  addUserMessage,
  resolvePending,
  sendChatMessage,
  type ChatMessage,
} from '../components/chat-core.ts';

export type { ChatMessage };

/** useChat 选项 */
export interface UseChatOptions {
  /** /api/chat 地址；默认同源（vite dev 代理到后端 3000） */
  url?: string;
  /** 可选：指定人设 id；缺省用服务端当前活跃人设 */
  personaId?: string;
  /** 错误回调（网络失败 / 业务降级时触发，参数为展示文案） */
  onError?: (message: string) => void;
  /** 回复完成回调（App 集成用：如驱动字幕条展示 AI 回复） */
  onReply?: (result: { ok: boolean; reply: string }) => void;
}

export interface UseChatResult {
  /** 消息列表（user + assistant 交替，assistant pending 为打字占位） */
  messages: ChatMessage[];
  /** 是否正在等待回复（发送中禁用输入/发送按钮） */
  isLoading: boolean;
  /** 最近一次请求失败文案（网络异常/降级；无失败为 null） */
  error: string | null;
  /** 输入框内容（受控） */
  inputValue: string;
  setInputValue: (value: string) => void;
  /** 发送消息：缺省用 inputValue；空文本 / 发送中忽略；成功后清空输入 */
  sendMessage: (text?: string) => Promise<void>;
  /** 清空消息列表（纯内存操作） */
  clear: () => void;
}

export function useChat(options: UseChatOptions = {}): UseChatResult {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');

  // 回调用 ref 持有最新引用，避免 sendMessage 闭包过期
  const optsRef = useRef(options);
  optsRef.current = options;
  const busyRef = useRef(false);

  // messages 双写 ref：sendMessage 同步读取最新列表（函数式 setState 内取 id 不可靠）
  const messagesRef = useRef<ChatMessage[]>([]);
  const commitMessages = useCallback((updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    setMessages((prev) => {
      const next = updater(prev);
      messagesRef.current = next;
      return next;
    });
  }, []);

  const sendMessage = useCallback(async (text?: string): Promise<void> => {
    if (busyRef.current) return;
    const content = (text ?? inputValue).trim();
    if (content.length === 0) return;

    busyRef.current = true;
    setIsLoading(true);
    setError(null);
    setInputValue('');

    // ① 追加 user 消息 + assistant pending 占位（同步拿 pendingId，防竞态）
    const withUser = addUserMessage(messagesRef.current, content);
    const withPending = addPending(withUser);
    const pendingId = withPending[withPending.length - 1]?.id ?? '';
    commitMessages(() => withPending);

    // ② 发送（sendChatMessage 内部兜底所有失败：网络/HTTP/结构异常 → ok:false + 友好文案）
    const result = await sendChatMessage({
      text: content,
      personaId: optsRef.current.personaId,
      apiUrl: optsRef.current.url ?? '/api/chat',
    });

    // ③ 填充 pending：ok=true → 正常回复；ok=false → 错误文案（error 样式）
    commitMessages((prev) => resolvePending(prev, pendingId, result));
    optsRef.current.onReply?.({ ok: result.ok, reply: result.reply });
    if (!result.ok) {
      const reason = result.reply || '发送失败';
      setError(reason);
      optsRef.current.onError?.(reason);
    }

    busyRef.current = false;
    setIsLoading(false);
  }, [inputValue, commitMessages]);

  const clear = useCallback(() => {
    commitMessages(() => []);
    setError(null);
  }, [commitMessages]);

  return {
    messages,
    isLoading,
    error,
    inputValue,
    setInputValue,
    sendMessage,
    clear,
  };
}

export default useChat;

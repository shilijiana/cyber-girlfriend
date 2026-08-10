/**
 * brain/qwen-fallback.ts —— Hermes 不可用时的纯 Qwen 文本降级通道（M5-02）
 *
 * 职责：Hermes 子进程不可用 / 超时 / 执行失败时，编排层降级调用本通道——
 *   直接用 DashScope OpenAI 兼容 chat/completions（qwen-plus 文本模型）回答用户，
 *   让人设 instructions 作为 system 提示、用户消息作为 user 输入，返回 Qwen 纯文本回答。
 *
 * 设计要点：
 *   - 接口同构：实现与 BR-01 `BrainRunner` 完全一致的契约（run(task) → BrainResult），
 *     orchestrator 可无缝切换（契约 §2.3 / §2.7 M5-02 降级语义）。
 *   - 零第三方依赖（红线 5）：Node 22 全局 fetch + AbortController 超时，无新增依赖。
 *   - 密钥走 config（红线 3）：Bearer 取 `config.dashscope.apiKey`，不硬编码。
 *   - 无状态无持久化（红线 1）：每次调用独立，不落盘。
 *   - 不抛错：所有失败（网络/超时/HTTP/结构异常）都返回 ok:false + error，
 *     由编排层决定最终降级文案（双重失败 → 友好提示）。
 *
 * 端点（官方 OpenAI 兼容模式，2026-08-09 确认）：
 *   POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
 *   Header: Authorization: Bearer <DASHSCOPE_API_KEY>
 *   Body:   { model: 'qwen-plus', messages: [{role:'system',...},{role:'user',...}] }
 */

import type { BrainResult, BrainRunner, BrainTask } from './hermes-runner.ts';
import { config } from '../config/loader.ts';

/** 默认文本模型：qwen-plus（DashScope 通用文本模型，官方文档示例模型） */
export const QWEN_TEXT_MODEL = 'qwen-plus';
/** 兼容模式端点（cn-beijing，与 config.dashscope.region 无关，官方固定域名） */
const COMPAT_ENDPOINT = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
/** 默认超时：30s（文本对话比 Hermes 子进程快得多；Hermes 超时 120s 是执行事务，这里是纯聊天降级） */
const DEFAULT_TIMEOUT_MS = 30_000;
/** 响应内容上限：防异常大回复刷内存 */
const MAX_OUTPUT_CHARS = 16_384;
/** L16：输入长度上限（instruction 超长截断，防 Qwen 上下文溢出/浪费 token） */
const MAX_INPUT_CHARS = 8_000;

/** 降级通道选项（全部可选，测试注入用） */
export interface QwenFallbackOptions {
  /** 模型名（默认 qwen-plus） */
  model?: string;
  /** API Key（默认 config.dashscope.apiKey） */
  apiKey?: string;
  /** 超时毫秒数（默认 30_000） */
  timeoutMs?: number;
  /** 端点（默认官方兼容模式；测试注入 mock server 用） */
  endpoint?: string;
  /** 测试注入：fake fetch（缺省用全局 fetch） */
  fetchImpl?: typeof fetch;
  /** 日志回调（默认 console） */
  log?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;
}

/** OpenAI 兼容 chat/completions 成功响应的最小结构（只取需要的字段） */
interface CompatChatResponse {
  choices?: Array<{ message?: { content?: unknown } }>;
  error?: { message?: unknown };
}

/**
 * 执行一次 Qwen 文本对话降级（实现 BrainRunner 契约）。
 * @param task instruction 为用户消息；context 为人设 instructions（作 system 提示）
 * @param options 可选覆盖（模型/密钥/超时/端点/fetch，测试用）
 */
export async function runQwenChat(task: BrainTask, options: QwenFallbackOptions = {}): Promise<BrainResult> {
  const started = Date.now();
  const log = options.log ?? ((level, msg, meta) => {
    const line = `[qwen-fallback] ${msg}${meta !== undefined ? ' ' + JSON.stringify(meta) : ''}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  });

  const apiKey = options.apiKey ?? config.dashscope.apiKey;
  if (!apiKey) {
    return fail('DashScope API Key 未配置（config/apikeys.json 或 DASHSCOPE_API_KEY）', started);
  }

  // L16：输入长度限制——instruction 超长截断（Qwen 文本模型有上下文上限，防浪费 token）
  const instruction =
    task.instruction.length > MAX_INPUT_CHARS
      ? `${task.instruction.slice(0, MAX_INPUT_CHARS)}…[输入过长已截断]`
      : task.instruction;

  const endpoint = options.endpoint ?? COMPAT_ENDPOINT;
  const model = options.model ?? QWEN_TEXT_MODEL;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    log('debug', '降级调用 Qwen 文本对话', { model, endpoint, hasContext: Boolean(task.context) });

    const res = await fetchImpl(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          // 人设 instructions 作为 system 提示（保持角色一致性）
          ...(task.context ? [{ role: 'system' as const, content: task.context }] : []),
          { role: 'user' as const, content: instruction },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      return fail(`Qwen 降级 HTTP ${res.status}`, started);
    }

    const data = (await res.json()) as CompatChatResponse;

    // 业务错误（如模型名非法 / 额度不足）也走失败路径
    if (data.error) {
      const msg = typeof data.error.message === 'string' ? data.error.message : 'Qwen 返回业务错误';
      return fail(msg, started);
    }

    const content = data.choices?.[0]?.message?.content;
    const output = typeof content === 'string' ? content.trim() : '';
    if (!output) {
      return fail('Qwen 降级返回空回复', started);
    }

    // M9：超长输出截断时追加标记，用户/上层可感知"回复被截断"（原实现静默截断）；
    // 截断位预留标记长度，保证总长不超过 MAX_OUTPUT_CHARS（回归测试断言 <= 16384）
    const TRUNCATE_MARKER = '…[回复过长已截断]';
    const truncated =
      output.length > MAX_OUTPUT_CHARS
        ? `${output.slice(0, MAX_OUTPUT_CHARS - TRUNCATE_MARKER.length)}${TRUNCATE_MARKER}`
        : output;
    return {
      ok: true,
      output: truncated,
      durationMs: Date.now() - started,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return fail(reason, started);
  } finally {
    clearTimeout(timer);
  }
}

/** 构造失败结果（统一错误结构，与 hermes-runner 一致） */
function fail(error: string, started: number): BrainResult {
  return {
    ok: false,
    output: '',
    durationMs: Date.now() - started,
    error,
  };
}

/** BrainRunner 适配器：与 BR-01 brainRunner 同构，编排层注入时二选一/降级用 */
export const qwenFallbackRunner: BrainRunner = {
  run: (task: BrainTask) => runQwenChat(task),
};

export default runQwenChat;

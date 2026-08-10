/**
 * brain/function-router.ts —— Function Calling 中转器（BR-02）
 *
 * 职责：拦截 Qwen-Audio Realtime 下发的 function_call("hermes_brain")
 *   → 解析 arguments → 调 hermes-runner 执行 → 构造 function_call_output 写回。
 * 位置：在 Qwen Realtime 协议（WS 事件收发，voice-shell 负责）与 Hermes 大脑之间
 *   做纯文本中转——本文件不碰 WS、不碰协议细节，只做"事件归一化 ↔ 任务执行 ↔ 输出构造"。
 *
 * 链路（契约 v1.4 §2.8，OpenAI Realtime 兼容协议）：
 *   Qwen 下行 {type:'conversation.item.created', item:{type:'function_call', name:'hermes_brain', arguments, call_id}}
 *     → extractFunctionCall(event) 提取归一化 FunctionCall
 *     → router.handle(call) 调 hermes-runner.run(task)
 *     → buildFunctionCallOutputEvent(out) 构造上行事件（由 voice-shell 发回 Qwen）
 *     → 再发 response.create，Qwen 用语音+字幕"说"出 Hermes 结果
 *
 * 边界与红线：
 *   - 无状态、无持久化、无数据库（红线 1）：每次调用独立，记忆/事务归 Hermes
 *   - 文本中转不漂移（红线 4）：instruction / output 只传纯文本
 *   - 依赖最小化（红线 5）：仅 import brain/hermes-runner.ts（+ Node 内置，无第三方）
 *   - 不越权：只处理 hermes_brain；未知工具名一律 failed 写回，绝不执行
 */

import { brainRunner, type BrainResult, type BrainRunner } from './hermes-runner.ts';

/** 工具名：Hermes 大脑在 Qwen 侧的注册名（VS-06 注册用，须与 hermesBrainTool.name 一致） */
export const HERMES_TOOL_NAME = 'hermes_brain';

/** 超时上限：与 hermes-runner 默认 120s 对齐，防 Qwen 传超大值拖死会话 */
const MAX_TIMEOUT_MS = 120_000;

/** 归一化函数调用（协议无关，从 Qwen Realtime 事件提取，契约 v1.4 §2.8） */
export interface FunctionCall {
  callId: string;                     // 回写时原样带回（call_id）
  name: string;                       // 工具名（如 hermes_brain）
  arguments: Record<string, unknown>; // 已解析的参数对象
  rawArguments?: string;              // 原始 arguments 文本（JSON 解析失败时兜底为 instruction）
}

/** 函数调用输出（写回 Qwen 的内容，契约 v1.4 §2.8） */
export interface FunctionCallOutput {
  callId: string;
  /** JSON 文本：{ok, output, durationMs, error?}（BrainResult 序列化），Qwen 据此组织语音回复 */
  output: string;
  /** failed = 未知工具 / 参数非法 / runner 失败；completed = runner 成功 */
  status: 'completed' | 'failed';
}

/** 中转器契约（契约 v1.4 §2.8）：拦截 → 调 runner → 写回 */
export interface FunctionRouter {
  handle(call: FunctionCall): Promise<FunctionCallOutput>;
}

/** 工具 schema：注册到 Qwen session 用（VS-06）。小而严格——只传任务描述 + 上下文摘要 */
export const hermesBrainTool = {
  type: 'function',
  name: HERMES_TOOL_NAME,
  description:
    '执行具体事务（查资料、算东西、读写文件、回顾记忆等）。日常闲聊与陪聊不用调用，遇到需要动手/查证/办事的请求才调用本工具。',
  parameters: {
    type: 'object',
    properties: {
      instruction: {
        type: 'string',
        description: '任务描述（必填，自然语言，尽量具体明确）',
      },
      context: {
        type: 'string',
        description: '可选：相关上下文或人设背景，帮助理解任务',
      },
      timeoutMs: {
        type: 'number',
        description: '可选：超时毫秒数，默认 120000，最大 120000',
      },
    },
    required: ['instruction'],
    additionalProperties: false,
  },
} as const;

/**
 * 从 Qwen Realtime 下行事件中提取 function_call，归一化为 FunctionCall。
 * 兼容三种形态（OpenAI Realtime 兼容协议）：
 *   ① {type:'conversation.item.created', item:{type:'function_call', ...}}
 *   ② {type:'response.output_item.done', item:{type:'function_call', ...}}
 *   ③ {type:'function_call', name, arguments, call_id}（部分实现直接顶层下发）
 * 非 function_call 事件 → 返回 null（调用方静默跳过）。
 */
export function extractFunctionCall(event: unknown): FunctionCall | null {
  if (typeof event !== 'object' || event === null) return null;
  const e = event as {
    type?: unknown;
    item?: { type?: unknown; name?: unknown; arguments?: unknown; call_id?: unknown };
    name?: unknown;      // 形态 ③：顶层 function_call 事件
    arguments?: unknown;
    call_id?: unknown;
  };

  // 形态 ①②：事件挂在 item 下
  if (
    (e.type === 'conversation.item.created' || e.type === 'response.output_item.done') &&
    typeof e.item === 'object' &&
    e.item !== null &&
    e.item.type === 'function_call'
  ) {
    return normalizeCall({
      name: e.item.name,
      arguments: e.item.arguments,
      callId: e.item.call_id,
    });
  }

  // 形态 ③：顶层 function_call 事件
  if (e.type === 'function_call') {
    return normalizeCall({ name: e.name, arguments: e.arguments, callId: e.call_id });
  }

  return null;
}

/** 归一化内部实现：容错 name/arguments/call_id 缺失 */
function normalizeCall(raw: {
  name?: unknown;
  arguments?: unknown;
  callId?: unknown;
}): FunctionCall | null {
  const name = typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : '';
  const callId = typeof raw.callId === 'string' ? raw.callId : '';
  // M8：name 为空但 callId 非空时也返回 null——无工具名无法判断归属，丢弃
  // （原实现只拦"两者皆空"，会产生无工具名的调用对象导致下游异常）
  if (!name) return null;

  // arguments：字符串（JSON 文本）或对象，解析失败保留原文兜底
  let args: Record<string, unknown> = {};
  let rawArgs: string | undefined;
  if (typeof raw.arguments === 'string') {
    rawArgs = raw.arguments;
    try {
      const parsed = JSON.parse(raw.arguments) as unknown;
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      }
    } catch {
      // 解析失败：保留原文，由 handle() 兜底为 instruction
    }
  } else if (typeof raw.arguments === 'object' && raw.arguments !== null) {
    // L14：数组形态强制当 Record 使用会出错，显式排除
    if (!Array.isArray(raw.arguments)) {
      args = raw.arguments as Record<string, unknown>;
    }
  }

  return { callId, name, arguments: args, rawArguments: rawArgs };
}

/** 解析参数 → BrainTask；instruction 缺失/为空时尝试用原始 arguments 文本兜底 */
function buildTask(call: FunctionCall): import('./hermes-runner.ts').BrainTask | null {
  const a = call.arguments;
  const instruction =
    typeof a.instruction === 'string' && a.instruction.trim().length > 0
      ? a.instruction.trim()
      : '';

  if (!instruction) {
    // 兜底：Qwen 偶尔把纯文本直接塞进 arguments，视为 instruction
    if (call.rawArguments && call.rawArguments.trim().length > 0) {
      return { instruction: call.rawArguments.trim() };
    }
    return null;
  }

  const context =
    typeof a.context === 'string' && a.context.trim().length > 0
      ? a.context.trim()
      : undefined;
  // L15：timeoutMs 下限保护（下限 5s——太小会误杀正常 Hermes 调用，且 Math.floor 后可能为 0/负数）
  const timeoutMs =
    typeof a.timeoutMs === 'number' && a.timeoutMs > 0
      ? Math.min(Math.max(Math.floor(a.timeoutMs), 5_000), MAX_TIMEOUT_MS)
      : undefined;

  return { instruction, context, timeoutMs };
}

/** 中转器实现：不抛错，所有失败都以 status:'failed' + error 写回（契约 v1.4 §2.8 错误语义） */
class HermesFunctionRouter implements FunctionRouter {
  private readonly runner: BrainRunner;

  constructor(runner: BrainRunner) {
    this.runner = runner;
  }

  async handle(call: FunctionCall): Promise<FunctionCallOutput> {
    // ① 拦截：只处理 hermes_brain，未知工具名绝不执行
    if (call.name !== HERMES_TOOL_NAME) {
      return this.fail(call.callId, `未知工具：${call.name || '(空)'}，本路由只处理 ${HERMES_TOOL_NAME}`);
    }

    // ② 解析入参 → BrainTask
    const task = buildTask(call);
    if (!task) {
      return this.fail(call.callId, '参数缺失：instruction 必填（非空字符串）');
    }

    // ③ 调 runner（hermes-runner：子进程 + 120s 超时 + 错误兜底）
    // 契约 §2.3 BrainRunner 承诺不抛错，但防御性兜底：runner 实现未来可能
    // 违反契约，此处 try-catch 保证 handle() 永不向外抛（H4，契约 §3.3 错误语义）
    let result: BrainResult;
    try {
      result = await this.runner.run(task);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return this.fail(call.callId, `大脑执行异常：${msg}`);
    }

    // ④ 写回：BrainResult 序列化为 JSON 文本，status 随 ok 标记
    return {
      callId: call.callId,
      status: result.ok ? 'completed' : 'failed',
      output: JSON.stringify(result),
    };
  }

  /** 失败写回（统一错误结构，Qwen 可读） */
  private fail(callId: string, error: string): FunctionCallOutput {
    const body: BrainResult = {
      ok: false,
      output: '',
      durationMs: 0,
      error,
    };
    return { callId, status: 'failed', output: JSON.stringify(body) };
  }
}

/** 构造上行 function_call_output 事件（conversation.item.create，由 voice-shell 发回 Qwen） */
export function buildFunctionCallOutputEvent(out: FunctionCallOutput): unknown {
  return {
    type: 'conversation.item.create',
    item: {
      type: 'function_call_output',
      call_id: out.callId,
      output: out.output,
    },
  };
}

/** 默认实例（依赖 BR-01 的 brainRunner 适配器；测试可注入 mock runner） */
export const functionRouter: FunctionRouter = new HermesFunctionRouter(brainRunner);

/** 工厂：依赖注入入口（VS-06 装配时可传入自定义 runner） */
export function createFunctionRouter(runner: BrainRunner = brainRunner): FunctionRouter {
  return new HermesFunctionRouter(runner);
}

export default functionRouter;

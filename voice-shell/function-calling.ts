/**
 * voice-shell/function-calling.ts —— Function Calling 装配层（VS-06）
 *
 * 职责：把「Qwen-Audio Realtime 的 function_call 事件」与「BR-02 Hermes 大脑路由」串成闭环：
 *   ① 注册 hermes_brain 工具 schema（hermesBrainTool → session.update.tools）
 *   ② 拦截 function_call 事件（gateway deps.onFunctionCall 接入，BR-02 extractFunctionCall 已在
 *      VS-01 客户端提取为归一化 FunctionCall）
 *   ③ 调 router.handle 执行（Hermes 子进程，120s 超时）
 *   ④ 用 session.sendFunctionCallOutput 写回 function_call_output + response.create
 *      → Qwen 用语音+字幕"说出"Hermes 结果
 *   ⑤ brain 状态上报（working/done/failed → 浏览器 + 上层，供字幕"小呆正在思考…"等 UX）
 *
 * 契约对齐：docs/architecture/module-contracts.md §2.8（v1.7）+ §2.2 VoiceSession.sendFunctionCallOutput
 * 依赖：BR-02 function-router（hermesBrainTool / FunctionRouter / FunctionCallOutput）
 * 装配用法（AP-05 挂载 /ws/voice 时）：
 *   const fc = createFunctionCallingLayer({ onBrainStatus: (s, r) => sse.broadcast(...) });
 *   const gateway = createVoiceGateway({
 *     provider: createQwenAudioClient({ tools: fc.tools }),  // ① 注册 hermes_brain
 *     onFunctionCall: fc.onFunctionCall,                     // ② 拦截 → router.handle
 *     onSessionCreated: fc.onSessionCreated,                 // ③ 拿 session 写回
 *   });
 *
 * 边界与红线：
 *   - 只做文本中转（红线 4）：instruction / output 纯文本，不漂移
 *   - 无状态、无持久化（红线 1）：每次 function_call 独立执行，记忆/事务归 Hermes
 *   - 依赖最小化（红线 5）：仅 import BR-02 function-router + gateway 类型，零第三方
 *   - 不越权：只处理 hermes_brain（router.handle 内部已校验工具名，未知工具 failed 写回）
 */

import { hermesBrainTool, functionRouter, type FunctionCall, type FunctionCallOutput, type FunctionRouter } from '../brain/function-router.ts';
import type { VoiceGatewayContext } from './gateway.ts';

/** brain 状态（契约 §2.1：working=执行中 / done=完成 / failed=失败） */
export type BrainStatus = 'working' | 'done' | 'failed';

/** 装配层依赖（全部可选，默认零配置可用） */
export interface FunctionCallingLayerDeps {
  /** BR-02 中转器（默认 functionRouter：hermes-runner 子进程 + 120s 超时） */
  router?: FunctionRouter;
  /** 工具 schema 列表（默认 [hermesBrainTool]，只注册 hermes_brain） */
  tools?: unknown[];
  /** brain 状态上报（供 SSE/编排层消费；浏览器下行由内部 sendToBrowser 处理） */
  onBrainStatus?: (status: BrainStatus, result?: string) => void;
  /** 日志回调（默认 console） */
  log?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;
  /** 即时应答文案（Hermes 执行前注入，让用户先听到"正在执行"；默认内置几句随机）
   *  2026-08-12：老板反馈 description 软约束不稳定（有时不说"正在执行"）→ 改为硬性注入 */
  instantReplies?: string[];
}

/** 装配层产物：三个钩子，分别挂到 gateway deps 对应字段 */
export interface FunctionCallingLayer {
  /** ① 工具 schema 列表（传给 createQwenAudioClient({ tools })） */
  tools: unknown[];
  /** ② function_call 拦截（挂 gateway deps.onFunctionCall；内部调 router.handle） */
  onFunctionCall: (call: FunctionCall) => void;
  /** ③ 会话建立钩子（挂 gateway deps.onSessionCreated；拿 session 用于写回 + 浏览器状态） */
  onSessionCreated: (ctx: VoiceGatewayContext) => void;
}

/** 创建 Function Calling 装配层（VS-06；零配置默认可用，AP-05 挂载时接线） */
export function createFunctionCallingLayer(
  deps: FunctionCallingLayerDeps = {},
): FunctionCallingLayer {
  const log = deps.log ?? ((level, msg, meta) => {
    const line = `[fc] ${msg}${meta !== undefined ? ' ' + JSON.stringify(meta) : ''}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  });

  // 路由实例（默认 BR-02 functionRouter）
  const router: FunctionRouter = deps.router ?? functionRouter;

  // 会话上下文：onSessionCreated 时注入，function_call 到来时用于写回
  let ctx: VoiceGatewayContext | null = null;

  /** 向浏览器 + 上层广播 brain 状态（浏览器下行已关闭时静默） */
  const broadcastStatus = (status: BrainStatus, result?: string): void => {
    ctx?.sendToBrowser({ type: 'brain', status, ...(result !== undefined ? { result } : {}) });
    deps.onBrainStatus?.(status, result);
  };

  return {
    tools: deps.tools ?? [hermesBrainTool],

    onFunctionCall: (call: FunctionCall): void => {
      // 会话未建立（理论上不会发生：function_call 只在会话中就绪后下发）
      if (!ctx) {
        log('warn', 'function_call 到达但会话未就绪，丢弃', { name: call.name, callId: call.callId });
        return;
      }

      // ① 状态：working（前端可显示"小呆正在思考…"）
      broadcastStatus('working');
      log('info', '拦截 function_call → 调 Hermes', {
        name: call.name,
        callId: call.callId,
        args: call.arguments,
      });

      // ② 硬性即时应答（2026-08-12）：Hermes 执行需几秒~几十秒，
      //    拦截 function_call 立即注入"正在执行"类短句，让用户先听到反馈（模仿真人）
      //    ——不再依赖 Qwen description 软约束（实测不稳定，有时不说）
      const replies = deps.instantReplies ?? [
        '好的，马上开始~',
        '收到，正在执行，请稍等~',
        '没问题，我这就去办~',
        'OK，知道了，马上搞定~',
      ];
      const instant = replies[Math.floor(Math.random() * replies.length)];
      try {
        ctx.session.injectAssistantText(instant);
        log('debug', '已注入即时应答', { instant });
      } catch (e) {
        log('warn', '即时应答注入失败（不影响 Hermes 执行）', { error: e instanceof Error ? e.message : String(e) });
      }

      // ③ 执行（router.handle 不抛错：未知工具/参数非法/超时都以 failed 写回）
      router
        .handle(call)
        .then((out: FunctionCallOutput) => {
          log('info', 'Hermes 执行完成，写回 Qwen', {
            callId: out.callId,
            status: out.status,
          });
          // ④ 写回 function_call_output + response.create → Qwen 语音回复
          ctx?.session.sendFunctionCallOutput(out);
          // ⑤ 状态：done / failed
          broadcastStatus(out.status === 'completed' ? 'done' : 'failed', out.output);
        })
        .catch((e: unknown) => {
          // 理论不可达（router 不抛错），防御性兜底：构造 failed 写回，防会话卡死
          const msg = e instanceof Error ? e.message : String(e);
          log('error', 'router.handle 异常（防御兜底）', { error: msg });
          const out: FunctionCallOutput = {
            callId: call.callId,
            status: 'failed',
            output: JSON.stringify({ ok: false, output: '', durationMs: 0, error: msg }),
          };
          ctx?.session.sendFunctionCallOutput(out);
          broadcastStatus('failed', out.output);
        });
    },

    onSessionCreated: (gatewayCtx: VoiceGatewayContext): void => {
      ctx = gatewayCtx;
      log('info', '会话就绪，Function Calling 已就位', { sessionId: gatewayCtx.sessionId });
    },
  };
}

export default createFunctionCallingLayer;

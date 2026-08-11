/**
 * app/server/ws.ts —— WS 服务端挂载与生命周期（AP-05）
 *
 * 职责：把 VS-02 语音网关挂到 HTTP 服务器的 `/ws/voice` 路径——
 *   ① WebSocketServer attach（path 过滤：非 /ws/voice 的 upgrade 不拦截，留给其他 handler）
 *   ② 连接处理：先解析当前活跃人设 instructions（PersonaProvider 组装，§2.4），
 *      再交 gateway.handleConnection（Qwen 双向中继，§2.2/§2.8）
 *   ③ 生命周期：wss 错误兜底、人设解析失败降级关闭、服务器关闭时全量断开（触发 gateway 清理）
 *
 * 契约对齐：docs/architecture/module-contracts.md §2.1（/ws/voice 协议）+ §2.8（装配用法，VS-06）
 * 依赖注入：provider 默认 Qwen（createQwenAudioClient，注册 hermes_brain 工具），测试可注入 mock；
 *           resolveInstructions 由装配处提供（index.ts 用 orchestrator + personaProvider 组装）。
 *
 * 边界与红线：
 *   - 只做挂载与生命周期（红线 2：本任务职责），中继/分发/function_call 逻辑全在 voice-shell
 *   - 无状态、无持久化（红线 1）：每次连接独立会话，关闭即清
 *   - 依赖最小化（红线 5）：仅 `ws`（服务端 WS 库）+ voice-shell 装配，零新增第三方
 *   - 密钥走 config（红线 3）：由 voice-shell 内部处理，本文件不碰密钥
 */

import type { Server, IncomingMessage } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import type { VoiceProvider } from '../../voice-shell/provider.ts';
import { createQwenAudioClient } from '../../voice-shell/qwen-audio-client.ts';
import {
  createVoiceGateway,
  type VoiceGateway,
  type BrowserSocket,
} from '../../voice-shell/gateway.ts';
import { createFunctionCallingLayer } from '../../voice-shell/function-calling.ts';
import { createSubtitleCapture, isSubtitleCaptureEnabled } from '../../tools/subtitle-capture.ts';

/** WS 挂载路径（契约 §2.1） */
export const VOICE_WS_PATH = '/ws/voice';
/** 服务器关闭兜底：wss.close 等待客户端断开的上限（防残留连接挂死） */
const CLOSE_GRACE_MS = 3_000;
/** H3：WS 最大并发连接数（防资源耗尽；单用户场景 10 连接足够，可经 deps 覆盖） */
const DEFAULT_MAX_CONNECTIONS = 10;
/** H3：允许的 Origin（浏览器跨站劫持防护）——仅放行 localhost/127.0.0.1 任意端口；
 *  无 Origin 的连接（Node 客户端/同源非浏览器工具）放行，与现有测试兼容 */
const ALLOWED_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/** WS 挂载依赖（构造注入，全部为抽象接口） */
export interface VoiceWsDeps {
  /** HTTP 服务器（Express app 挂载其上，WS 共享同一端口） */
  server: Server;
  /** 解析当前活跃人设的 Qwen instructions（装配处用 orchestrator + PersonaProvider 组装） */
  resolveInstructions: () => Promise<string>;
  /** 语音供应商（默认 Qwen-Audio + hermes_brain 工具注册；测试注入 mock） */
  provider?: VoiceProvider;
  /** H3：最大并发连接数（默认 10；超限拒绝新连接） */
  maxConnections?: number;
  /** 日志回调（默认 console） */
  log?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;
}

/** WS 挂载句柄（启动/测试/关闭共用） */
export interface VoiceWsHandle {
  /** WebSocketServer 实例（测试断言用） */
  wss: WebSocketServer;
  /** 语音网关实例（测试断言用） */
  gateway: VoiceGateway;
  /** 优雅关闭：断开全部客户端（触发 gateway 清理 Qwen 会话）→ 关闭 wss（含兜底强关） */
  close(): Promise<void>;
}

/** 默认日志（console，带 [ws] 前缀） */
function defaultLog(level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown): void {
  const line = `[ws] ${msg}${meta !== undefined ? ' ' + JSON.stringify(meta) : ''}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/**
 * 挂载语音 WebSocket 服务（AP-05 核心交付）：
 *   WebSocketServer attach 到 `server`，仅处理 /ws/voice 升级请求；
 *   每个浏览器连接：解析人设 instructions → gateway.handleConnection（Qwen 中继）。
 */
export function setupVoiceWebSocket(deps: VoiceWsDeps): VoiceWsHandle {
  const log = deps.log ?? defaultLog;

  // 装配（契约 §2.8）：Function Calling 层（VS-06）→ gateway（VS-02）→ Qwen provider（VS-01）
  // ① 注册 hermes_brain 工具 + 拦截 function_call → BR-02 执行 → 写回
  const fc = createFunctionCallingLayer({
    // 大脑状态上报：当前 SSE 为单客户端骨架，先打日志（后续 Orchestrator 接入可广播）
    onBrainStatus: (status, result) => {
      log('info', `brain 状态：${status}`, result !== undefined ? { result: String(result).slice(0, 120) } : undefined);
    },
    log,
  });
  // ② 语音网关：浏览器 ↔ Qwen 双向中继（下行 audio/subtitle/emotion/vadState/function_call 分发）
  // 字幕抓取器（SUBTITLE_CAPTURE=1 启用）：挂 deps.onSubtitle/onInputTranscript，实时写文件供审核
  const subtitleCapture = createSubtitleCapture();
  if (isSubtitleCaptureEnabled()) {
    log('info', `字幕抓取已启用 → ${subtitleCapture.file ?? '（待创建）'}`);
  }
  const gateway = createVoiceGateway({
    provider: deps.provider ?? createQwenAudioClient({ tools: fc.tools }),
    onFunctionCall: fc.onFunctionCall, // ③ function_call → router.handle → sendFunctionCallOutput 写回
    onSessionCreated: fc.onSessionCreated, // ④ 会话建立后拿 session 用于写回 + 浏览器 brain 状态
    onSubtitle: subtitleCapture.onSubtitle, // 字幕抓取：AI 字幕增量
    onInputTranscript: subtitleCapture.onInputTranscript, // 字幕抓取：用户转写
    log,
  });

  // 挂载：ws 库 attach 模式自动监听 upgrade，path 不匹配的请求不拦截（留给其他 handler）
  const wss = new WebSocketServer({ server: deps.server, path: VOICE_WS_PATH });
  const maxConnections = deps.maxConnections ?? DEFAULT_MAX_CONNECTIONS;

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // H3 ① Origin 校验：浏览器跨站 WebSocket 劫持防护——带 Origin 的请求必须来自
    //   localhost/127.0.0.1（任意端口）；无 Origin（Node 客户端/测试/同源工具）放行
    const origin = req.headers.origin;
    if (origin && !ALLOWED_ORIGIN_PATTERN.test(origin)) {
      log('warn', '拒绝跨源 WS 连接（Origin 不在白名单）', { origin });
      try {
        ws.close(1008, 'origin not allowed');
      } catch {
        // 连接已断开，忽略
      }
      return;
    }
    // H3 ② 连接数限制：超过上限拒绝新连接（防资源耗尽 / API 配额滥用）
    if (wss.clients.size > maxConnections) {
      log('warn', 'WS 连接数超限，拒绝新连接', { count: wss.clients.size, max: maxConnections });
      try {
        ws.close(1013, 'too many connections');
      } catch {
        // 连接已断开，忽略
      }
      return;
    }
    // L10：显式 .catch 兜底（handleBrowserConnection 内部已 try/catch，此处仅防未来实现变化）
    void handleBrowserConnection(ws, deps.resolveInstructions, gateway, log).catch((e) => {
      log('error', '浏览器连接处理异常', { error: String(e) });
    });
  });

  // wss 级错误兜底（upgrade 握手异常等），不崩溃整个服务器
  wss.on('error', (err) => {
    log('error', 'WebSocketServer 错误', { error: err.message });
  });

  return {
    wss,
    gateway,
    close: () => closeWss(wss, log),
  };
}

/**
 * 单个浏览器连接处理：
 *   先取人设 instructions（失败 → 发 {type:'error'} + 1011 关闭，不建立语音会话），
 *   再交 gateway（其内部对 Qwen 连接失败有兜底，不向外抛）。
 */
async function handleBrowserConnection(
  ws: BrowserSocket,
  resolveInstructions: () => Promise<string>,
  gateway: VoiceGateway,
  log: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void,
): Promise<void> {
  let instructions = '';
  try {
    instructions = await resolveInstructions();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log('error', '人设指令解析失败，拒绝语音会话', { error: msg });
    try {
      ws.send(JSON.stringify({ type: 'error', message: `人设加载失败：${msg}` }));
    } catch {
      // 发送失败说明连接已断开，忽略
    }
    try {
      ws.close(1011, 'persona load failed');
    } catch {
      // 忽略
    }
    return;
  }
  try {
    await gateway.handleConnection(ws, instructions);
  } catch (e) {
    // 防御性兜底：gateway 内部已 try/catch，此处仅防未来实现变化
    log('error', '语音网关处理异常', { error: String(e) });
  }
}

/** 优雅关闭：断开全部客户端（触发 gateway cleanup → Qwen 会话关闭）→ wss.close（带兜底强关） */
async function closeWss(
  wss: WebSocketServer,
  log: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void,
): Promise<void> {
  log('info', `关闭语音服务：断开 ${wss.clients.size} 个活跃连接`);
  for (const client of wss.clients) {
    try {
      client.close(1001, 'server shutting down');
    } catch {
      // 客户端已断开，忽略
    }
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve();
    };
    // wss.close 在全部客户端连接关闭后回调
    wss.close(() => finish());
    // 兜底：客户端不响应关闭帧时强关，防挂死
    setTimeout(finish, CLOSE_GRACE_MS).unref?.();
  });
  log('info', '语音服务已关闭');
}

export default setupVoiceWebSocket;

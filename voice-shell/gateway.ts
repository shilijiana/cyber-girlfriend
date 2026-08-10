/**
 * voice-shell/gateway.ts —— 语音网关（VS-02）
 *
 * 职责：把「浏览器（客户端 WS）」与「Qwen-Audio（服务端 WS）」之间的音频流双向中继，
 *   是语音壳的桥梁层。AP-05 在 app/server 挂载 `/ws/voice` 时调用本网关的处理逻辑。
 *
 * 链路：
 *   浏览器 ──WS(/ws/voice)──▶ gateway.ts ◀──WS(服务端 realtime)── Qwen-Audio
 *     上行 PCM 16kHz  ▶──────中继──────▶ 上行 PCM 16kHz（session.sendAudio）
 *     下行 PCM 24kHz  ◀──────中继──────◀ 下行 PCM 24kHz（onAudio 回调）
 *     副文本/情绪      ◀──────透传──────◀ subtitle / emotion 回调 → 浏览器 + deps 回调
 *     VAD 状态         ◀──────透传──────◀ onVadState 回调 → 浏览器 status listening（VS-04）
 *     function_call    ◀──────透传──────◀ onFunctionCall 回调 → BR-02（VS-06 接入，本网关不执行）
 *
 * 契约对齐：docs/architecture/module-contracts.md §2.1（/ws/voice 协议）+ §2.2（VoiceProvider）
 * 规格依据：docs/tasks/VS-02-gateway.md（v1.0）+ VS-04（VAD 与打断：server_vad 状态透传）
 *
 * 边界与红线：
 *   - 只做中继与分发，不写业务判断（红线 6：语音壳不碰业务）
 *   - 无状态、无持久化（红线 1）：每次 handleConnection 一个会话，结束即清
 *   - 依赖最小化（红线 5）：仅 `ws`（服务端 WS 类型）+ VS-01 客户端，无第三方
 *   - Key 走 config（红线 3）：由 VS-01 provider 内部处理，本文件不碰密钥
 */

import { randomUUID } from 'crypto';
import type { Emotion } from '../avatar/clip-matcher.ts';
import type { FunctionCall } from '../brain/function-router.ts';
import type { VoiceProvider, VoiceSession } from './provider.ts';
import { createVoiceDispatcher, type VoiceConsumer } from './dispatcher.ts';

/** ws.OPEN 常量（ws 库与原生一致 = 1） */
const WS_OPEN = 1;
/** 下行音频停流后多久回到 idle 状态（无音频 = AI 说话结束） */
const IDLE_TIMEOUT_MS = 1500;

/** 浏览器端 WS 最小接口（duck typing：ws 库 WebSocket 天然满足，测试可 mock） */
export interface BrowserSocket {
  readonly readyState: number;
  send(data: string | Uint8Array | ArrayBuffer): void;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  off?(event: string, listener: (...args: unknown[]) => void): unknown;
  close(code?: number, reason?: string): void;
}

/** 网关上下文（onSessionCreated 时交给上层，供 VS-06 挂 function_call 处理/回写） */
export interface VoiceGatewayContext {
  /** 本次连接的业务侧会话标识 */
  sessionId: string;
  /** VS-01 语音会话（injectAssistantText / interrupt / close 等） */
  session: VoiceSession;
  /** 向浏览器发送 JSON 消息（{type:'subtitle'|'emotion'|'brain'|...}，自动 JSON 序列化） */
  sendToBrowser(obj: unknown): void;
}

/** 网关依赖（构造注入，全部为抽象接口） */
export interface VoiceGatewayDeps {
  /** VS-01 语音供应商（Qwen-Audio 实现） */
  provider: VoiceProvider;
  /** 字幕透传（供编排层/SSE 等消费，与浏览器下行并存） */
  onSubtitle?: (text: string) => void;
  /** 情绪透传（供数字人模块消费） */
  onEmotion?: (e: Emotion) => void;
  /** function_call 透传（→ BR-02，VS-06 接入；本网关只透传不执行） */
  onFunctionCall?: (call: FunctionCall) => void;
  /** 用户语音转写透传（VS-05：delta=true 增量 / false 最终；供编排层/SSE 消费，与浏览器下行并存） */
  onInputTranscript?: (text: string, info: { delta: boolean }) => void;
  /** 会话建立后回调（VS-06 在此注册 function_call 写回 / brain 状态上报） */
  onSessionCreated?: (ctx: VoiceGatewayContext) => void;
  /** 日志回调（默认 console） */
  log?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;
}

/** 语音网关：浏览器连接 → 中继 ↔ Qwen（AP-05 挂载点调用） */
export interface VoiceGateway {
  /**
   * 浏览器 WS 连入时调用，建立与 Qwen 的双向中继。
   * 内部 try/catch：Qwen 连接失败 → 向浏览器发 {type:'error'} 并关闭，不向外抛。
   * @param browserWs 浏览器连接（ws 库 WebSocket 实例）
   * @param personaInstructions 人设指令（由编排层从 PersonaProvider 取，注入 session.update）
   */
  handleConnection(browserWs: BrowserSocket, personaInstructions: string): Promise<void>;
}

type GatewayState = 'connected' | 'speaking' | 'listening' | 'idle';

/** 网关实现（不对外暴露，统一走 createVoiceGateway 工厂） */
class VoiceGatewayImpl implements VoiceGateway {
  private readonly deps: VoiceGatewayDeps;
  private readonly log: NonNullable<VoiceGatewayDeps['log']>;

  constructor(deps: VoiceGatewayDeps) {
    this.deps = deps;
    this.log = deps.log ?? ((level, msg, meta) => {
      const line = `[gateway] ${msg}${meta !== undefined ? ' ' + JSON.stringify(meta) : ''}`;
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    });
  }

  async handleConnection(browserWs: BrowserSocket, personaInstructions: string): Promise<void> {
    const sessionId = randomUUID();
    const log = (level: Parameters<NonNullable<VoiceGatewayDeps['log']>>[0], msg: string, meta?: unknown) =>
      this.log(level, `[${sessionId}] ${msg}`, meta);

    // 浏览器未就绪（连接已断开）直接放弃
    if (browserWs.readyState !== WS_OPEN) {
      log('warn', '浏览器连接未就绪，放弃建立会话', { readyState: browserWs.readyState });
      return;
    }

    let state: GatewayState = 'idle';
    let session: VoiceSession | null = null;
    let dispatcher: ReturnType<typeof createVoiceDispatcher> | null = null;
    let closed = false;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    /** 向浏览器发送 JSON（连接已关闭时静默丢弃）
     *  H8 修复：必须发文本帧（opcode 0x01）而非二进制帧——浏览器 onmessage
     *  对文本帧直接给 string，二进制帧则给 Blob/ArrayBuffer 需额外转换，易解析异常 */
    const sendToBrowser = (obj: unknown): void => {
      if (closed || browserWs.readyState !== WS_OPEN) return;
      try {
        browserWs.send(JSON.stringify(obj));
      } catch (e) {
        log('warn', '向浏览器发送失败', { error: String(e) });
      }
    };

    /** 状态切换（仅变化时发送，避免刷屏） */
    const setState = (s: GatewayState): void => {
      if (state === s) return;
      state = s;
      sendToBrowser({ type: 'status', state: s });
    };

    /** 清理：移除监听 → 关浏览器 WS → 关 Qwen 会话（幂等） */
    const cleanup = async (reason: string): Promise<void> => {
      if (closed) return;
      closed = true;
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = null;
      log('info', '清理中', { reason });
      try {
        browserWs.off?.('message', onBrowserMessage);
        browserWs.off?.('close', onBrowserClose);
        browserWs.off?.('error', onBrowserError);
      } catch {
        // 移除监听失败不影响清理
      }
      try {
        browserWs.close(1000, 'gateway cleanup');
      } catch {
        // 浏览器已断开的场景忽略
      }
      const s = session;
      session = null;
      if (s) {
        await s.close().catch(() => undefined);
        log('info', 'Qwen 会话已关闭，无残留');
      }
      // 双路分发器释放（VS-03）：解绑会话事件源 + 清空消费者，防事件泄漏
      if (dispatcher) {
        dispatcher.dispose();
        dispatcher = null;
      }
    };

    // ------------------------------------------------------------ Qwen 会话建立
    try {
      session = await this.deps.provider.connect(sessionId, personaInstructions);
    } catch (e) {
      log('error', 'Qwen 会话建立失败', { error: String(e) });
      sendToBrowser({ type: 'error', message: `语音服务连接失败：${String(e)}` });
      try {
        browserWs.close(1011, 'provider connect failed');
      } catch {
        // 忽略
      }
      return;
    }
    log('info', 'Qwen 会话建立成功');

    // ------------------------------------------------------------ 双路分发（VS-03）
    // dispatcher 把 Qwen 下行事件广播给两路消费者：①浏览器（audio→播放/subtitle→字幕/
    // emotion→数字人）②deps 回调（编排层/SSE/BR-02）。广播顺序 = 订阅顺序（浏览器先收）。
    dispatcher = createVoiceDispatcher({ log: (level, msg, meta) => log(level, msg, meta) });

    // 路①浏览器消费者：下行 → WS（audio 顺带驱动 speaking/idle 状态机）
    const browserConsumer: VoiceConsumer = {
      onAudio: (chunk) => {
        if (closed) return;
        setState('speaking');
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          idleTimer = null;
          setState('idle');
        }, IDLE_TIMEOUT_MS);
        sendToBrowser({ type: 'audio', data: chunk.toString('base64') });
      },
      onSubtitle: (text) => sendToBrowser({ type: 'subtitle', text }),
      onEmotion: (e) => sendToBrowser({ type: 'emotion', emotion: e }),
      // VS-04 VAD：用户说话 → listening 态（AI 若在播，服务端 server_vad 会自动打断，
      // 客户端只需把状态透传给前端驱动数字人/UI）；语音结束 → 回 connected 等 AI 响应
      onVadState: (speaking) => {
        if (closed) return;
        if (speaking) {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = null;
          setState('listening');
        } else if (state === 'listening') {
          setState('connected');
        }
      },
      // M17：用户语音转写（VS-05）走 dispatcher 统一分发（错误隔离）
      onInputTranscript: (text, info) => {
        sendToBrowser({ type: 'user_transcript', text, delta: info.delta });
      },
    };
    dispatcher.subscribe(browserConsumer);

    // 路②deps 消费者：副文本/情绪/function_call/用户转写 → 上层（function_call 只透传，红线 6）
    const depsConsumer: VoiceConsumer = {
      onSubtitle: (text) => this.deps.onSubtitle?.(text),
      onEmotion: (e) => this.deps.onEmotion?.(e),
      onFunctionCall: (call) => this.deps.onFunctionCall?.(call),
      onInputTranscript: (text, info) => this.deps.onInputTranscript?.(text, info),
    };
    dispatcher.subscribe(depsConsumer);

    // 绑定会话事件源 → dispatcher 开始广播（audio/subtitle/emotion/functionCall/inputTranscript 五路）
    dispatcher.bind(session);

    // ------------------------------------------------------------ 浏览器上行 → Qwen
    // 帧类型判定（AP-05 实测修正）：ws 库（Node 22 + ws@8）文本帧与二进制帧都以 Buffer
    // 交付（receiver.js: emit('message', buf, isBinary)），必须用 isBinary 标志区分——
    // 否则 JSON 控制消息会被误判为二进制音频帧直接上行。mock 测试发 string 不受影响。
    const onBrowserMessage = (raw: unknown, isBinary?: unknown): void => {
      if (closed || !session) return;

      // 二进制帧 → 直接作为上行音频（契约 §2.1：音频可走二进制 ArrayBuffer 形式）
      let payload: Buffer | string;
      if (Array.isArray(raw)) {
        payload = Buffer.concat(raw as Buffer[]);
      } else if (Buffer.isBuffer(raw)) {
        payload = isBinary === true ? raw : raw.toString('utf-8');
      } else if (raw instanceof ArrayBuffer) {
        payload = Buffer.from(raw);
      } else {
        payload = String(raw);
      }
      if (Buffer.isBuffer(payload)) {
        session.sendAudio(payload);
        return;
      }

      // JSON 文本控制消息
      let ev: unknown;
      try {
        ev = JSON.parse(payload);
      } catch {
        log('warn', '无法解析的浏览器消息', { raw: payload.slice(0, 120) });
        return;
      }
      if (typeof ev !== 'object' || ev === null) return;
      const msg = ev as { type?: string; data?: unknown };
      switch (msg.type) {
        case 'audio': {
          // 规格 §4：{type:'audio', data:'<base64 PCM16k>'}> → 上行
          if (typeof msg.data === 'string' && msg.data.length > 0) {
            session.sendAudio(Buffer.from(msg.data, 'base64'));
          }
          break;
        }
        case 'interrupt':
          // 打断当前响应（barge-in；server_vad 下 Qwen 服务端也会处理插话）
          session.interrupt();
          break;
        case 'close':
          // 客户端主动结束
          void cleanup('browser close');
          break;
        case 'start':
          // 契约 §2.1：start 开启会话（本实现连接即就绪，重复 start 幂等回 ready）
          sendToBrowser({ type: 'ready', config: { sampleRate: 24000 } });
          break;
        default:
          log('debug', '未识别的浏览器消息', { type: msg.type });
      }
    };

    const onBrowserClose = (): void => {
      void cleanup('browser disconnect');
    };
    const onBrowserError = (e: unknown): void => {
      log('warn', '浏览器连接异常', { error: e instanceof Error ? e.message : String(e) });
      void cleanup('browser error');
    };

    browserWs.on('message', onBrowserMessage);
    browserWs.on('close', onBrowserClose);
    browserWs.on('error', onBrowserError);

    // ------------------------------------------------------------ 就绪通知
    sendToBrowser({ type: 'ready', config: { sampleRate: 24000 } });
    setState('connected');
    this.deps.onSessionCreated?.({ sessionId, session, sendToBrowser });
  }
}

/** 创建语音网关（VS-02 装配入口；AP-05 挂载 /ws/voice 时使用） */
export function createVoiceGateway(deps: VoiceGatewayDeps): VoiceGateway {
  return new VoiceGatewayImpl(deps);
}

export default createVoiceGateway;

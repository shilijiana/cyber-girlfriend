/**
 * voice-shell/qwen-audio-client.ts —— Qwen-Audio Realtime WS 客户端（VS-01）
 *
 * 职责：Qwen-Audio-3.0-Realtime-Flash WebSocket 客户端——连接、人设注入、
 *   音频收发、事件分发（字幕/情绪/function_call）、断线重连。供 VS-02 gateway 使用。
 *
 * 契约对齐：docs/architecture/module-contracts.md §2.2（VoiceProvider，v1.2）
 * 协议参考：Qwen-Audio Realtime WebSocket API（help.aliyun.com/zh/model-studio/fun-audiochat-realtime-websocket-api）
 *   实测（2026-08-09）：连接成功 → session.created → session.update 被接受
 *
 * 关键设计：
 *   - 依赖最小化（红线 5）：Node 22 原生全局 WebSocket，零第三方依赖
 *   - 密钥走 config（红线 8）：默认读 config/loader.ts，options.apiKey 可覆盖
 *   - 无状态无持久化（红线 1）：回调即接即用，不落盘
 *   - function_call 只透传（红线 6）：提取用 BR-02 extractFunctionCall，不执行
 *   - 断线重连：指数退避（1s→2s→…→30s 封顶），重连后自动重新注入 instructions
 *   - 心跳：activity 超时探测（服务端无事件超时 → 主动断开触发重连），防半死连接
 */

import { extractFunctionCall, type FunctionCall } from '../brain/function-router.ts';
import type { Emotion } from '../avatar/clip-matcher.ts';
import { config, maskKey } from '../config/loader.ts';
import type { VoiceProvider, VoiceSession } from './provider.ts';

/** VAD 灵敏度/静音时长默认值（官方推荐：对话场景 silence 400-800ms） */
const DEFAULT_VAD = { threshold: 0.5, silence_duration_ms: 800 } as const;
/**
 * 默认音色：longanqian（官方默认系统音色，最稳）。
 * 实测（2026-08-09）：规格旧音色 zh_female_roumeinvyou_uranus_bigtts 在 flash 模型已不支持，
 * 官方支持：longanqian / longanlingxin / longanlufeng / longanlingxi / longanxiaoxin /
 * longanfengyue / longanyuanfei / longanhuan_v3.6 / longjielidou_v3.6 / longpaopao_v3.6 /
 * longhuohuo_v3.6 / longchuanshu_v3.6 / loongmary / loongeva_v3.6 / loongjohn。
 * 小呆活泼人设可换 longanhuan_v3.6（欢快系），options.voice 覆盖。
 */
const DEFAULT_VOICE = 'longanqian';
/** 输入转写模型（VS-05 依赖；session.update 与 OpenAI 兼容协议字段） */
const DEFAULT_ASR_MODEL = 'fun-asr';

export interface QwenAudioClientOptions {
  /** API Key（默认取 config.dashscope.apiKey） */
  apiKey?: string;
  /** 模型名（默认 config.dashscope.model = qwen-audio-3.0-realtime-flash） */
  model?: string;
  /** 业务空间 ID（默认 config.dashscope.workspaceId；有值则用专属域名） */
  workspaceId?: string;
  /** 业务空间地域（默认 cn-beijing，拼专属域名用） */
  region?: string;
  /** TTS 音色（默认小呆音色；也可用官方系统音色 longanqian 等） */
  voice?: string;
  /** Function Calling 工具列表（VS-06 注册 hermes_brain；默认不注册） */
  tools?: unknown[];
  /** 轮次检测：null = push-to-talk；undefined = server_vad（默认） */
  turnDetection?:
    | { type: 'server_vad' | 'smart_turn'; threshold?: number; silence_duration_ms?: number }
    | null;
  /** 用户语音输入转写（VS-05；默认开启 fun-asr） */
  inputAudioTranscription?: { enabled?: boolean; model?: string } | null;
  /** 最大重连次数（默认 8，超过后放弃） */
  maxReconnectAttempts?: number;
  /** connect 等待 session.updated 超时（默认 15s） */
  connectTimeoutMs?: number;
  /** activity 心跳超时：超过无下行事件判定连接半死（默认 120s，0 关闭探测） */
  activityTimeoutMs?: number;
  /** 日志回调（默认 console） */
  log?: (level: 'debug' | 'info' | 'warn' | 'error', msg: string, meta?: unknown) => void;
}

/** 会话内部回调集合 */
interface SessionCallbacks {
  audio?: (chunk: Buffer) => void;
  subtitle?: (text: string) => void;
  emotion?: (e: Emotion) => void;
  functionCall?: (call: FunctionCall) => void;
}

/** 有效情绪集合（Emotion 白名单，协议值不在其中归一化为 neutral） */
const VALID_EMOTIONS: readonly Emotion[] = ['happy', 'gentle', 'serious', 'surprise', 'neutral'];

/** 情绪归一化：协议返回任意值 → 白名单 Emotion，无效映射 neutral */
function normalizeEmotion(v: unknown): Emotion {
  if (typeof v === 'string' && (VALID_EMOTIONS as readonly string[]).includes(v)) {
    return v as Emotion;
  }
  return 'neutral';
}

class QwenAudioSessionImpl implements VoiceSession {
  private ws: WebSocket | null = null;
  private readonly sessionId: string; // 业务侧标识（日志追踪用）
  private readonly instructions: string;
  private readonly opts: Required<Pick<
    QwenAudioClientOptions,
    'maxReconnectAttempts' | 'connectTimeoutMs' | 'activityTimeoutMs'
  >> &
    QwenAudioClientOptions;
  private readonly log: NonNullable<QwenAudioClientOptions['log']>;
  private readonly callbacks: SessionCallbacks = {};

  private closed = false; // 手动关闭标记（不重连）
  private connecting = false; // 正在建立连接
  private ready: { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } | null =
    null;
  private serverSessionId = ''; // 服务端 session.id（session.created）
  private reconnectAttempts = 0;
  private lastActivity = 0; // 最后收到下行事件时间
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private voice = ''; // 当前生效音色（初始取配置，Unsupported voice 时降级 DEFAULT_VOICE）
  private voiceFallbackDone = false; // 音色降级只做一次，防循环重发

  constructor(
    sessionId: string,
    instructions: string,
    options: QwenAudioClientOptions = {},
  ) {
    this.sessionId = sessionId;
    this.instructions = instructions;
    this.log = options.log ?? ((level, msg, meta) => {
      const line = `[voice:${sessionId}] ${msg}${meta !== undefined ? ' ' + JSON.stringify(meta) : ''}`;
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    });
    this.opts = {
      maxReconnectAttempts: 8,
      connectTimeoutMs: 15_000,
      activityTimeoutMs: 120_000,
      ...options,
    };
    this.voice = this.opts.voice ?? DEFAULT_VOICE;
    this.lastActivity = Date.now();
  }

  // ---------------------------------------------------------------- 连接

  /** 建立连接并等待会话就绪（session.created → session.update → session.updated） */
  async connect(): Promise<void> {
    this.closed = false;
    if (this.ready) return this.ready.promise; // 已在连接中
    this.ready = this.createReady();
    this.openConnection();
    const timer = setTimeout(() => {
      this.ready?.reject(new Error(`连接超时：${this.opts.connectTimeoutMs}ms 内未收到 session.updated`));
      this.ready = null;
      this.forceClose();
    }, this.opts.connectTimeoutMs);
    this.connectTimer = timer;
    try {
      await this.ready.promise;
    } finally {
      if (this.connectTimer) clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  private createReady(): { promise: Promise<void>; resolve: () => void; reject: (e: Error) => void } {
    let resolve!: () => void;
    let reject!: (e: Error) => void;
    const promise = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  private buildUrl(): string {
    const model = this.opts.model ?? config.dashscope.model;
    const wsId = this.opts.workspaceId ?? config.dashscope.workspaceId;
    if (wsId) {
      const region = this.opts.region ?? config.dashscope.region ?? 'cn-beijing';
      return `wss://${wsId}.${region}.maas.aliyuncs.com/api-ws/v1/realtime?model=${model}`;
    }
    return `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=${model}`;
  }

  private openConnection(): void {
    if (this.closed || this.connecting) return;
    const apiKey = this.opts.apiKey ?? config.dashscope.apiKey;
    if (!apiKey) {
      this.log('error', '缺少 DASHSCOPE_API_KEY：请在 config/apikeys.json 或环境变量配置');
      this.ready?.reject(new Error('缺少 DASHSCOPE_API_KEY'));
      this.ready = null;
      return;
    }

    this.connecting = true;
    const url = this.buildUrl();
    this.log('info', `连接 ${url}`, { key: maskKey(apiKey) });

    let ws: WebSocket;
    try {
      // Node 22 全局 WebSocket 基于 undici，支持 { headers } 初始化选项（@types/node
      // 类型签名未覆盖，运行时有效，实测鉴权通过）；此处仅做类型收窄，行为不变。
      ws = new WebSocket(
        url,
        { headers: { Authorization: `Bearer ${apiKey}` } } as unknown as string[],
      );
    } catch (e) {
      this.log('error', 'WebSocket 构造失败', { error: String(e) });
      this.connecting = false;
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => this.log('debug', 'WS open');
    ws.onerror = (ev) => {
      // 握手失败（401/403）等构造性错误：重连无意义，直接放弃
      const msg = ev instanceof ErrorEvent ? ev.message : '';
      if (/401|403|Unauthorized|Forbidden|400|Bad Request/i.test(msg)) {
        this.log('error', '鉴权/握手失败，放弃重连', { msg });
        this.closed = true;
        this.ready?.reject(new Error(`WS 握手失败：${msg || '鉴权错误'}`));
        this.ready = null;
      } else {
        this.log('warn', 'WS error', { msg });
      }
    };
    ws.onclose = (ev) => {
      this.log('warn', 'WS close', { code: ev.code, reason: ev.reason });
      this.connecting = false;
      this.serverSessionId = '';
      if (!this.closed) this.scheduleReconnect();
    };
    ws.onmessage = (ev) => this.handleMessage(ev.data);
  }

  /** 断线重连：指数退避 1s→2s→4s→…→30s 封顶 */
  private scheduleReconnect(): void {
    if (this.closed || this.reconnectTimer) return;
    if (this.reconnectAttempts >= this.opts.maxReconnectAttempts) {
      this.log('error', `重连次数超过上限(${this.opts.maxReconnectAttempts})，会话终止`);
      this.ready?.reject(new Error('重连次数超限'));
      this.ready = null;
      return;
    }
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 30_000);
    this.reconnectAttempts += 1;
    this.log('info', `计划第 ${this.reconnectAttempts} 次重连（${delay}ms 后）`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openConnection();
    }, delay);
  }

  /** 心跳：activity 超时探测（服务端无事件 → 判定半死 → 主动断开触发重连） */
  private startHeartbeat(): void {
    this.stopHeartbeat();
    const timeout = this.opts.activityTimeoutMs;
    if (!timeout) return;
    this.heartbeatTimer = setInterval(() => {
      const idle = Date.now() - this.lastActivity;
      if (idle > timeout && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.log('warn', `连接空闲 ${idle}ms，判定半死，主动断开以触发重连`);
        this.forceClose();
      }
    }, 30_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  // ---------------------------------------------------------------- 事件处理

  private handleMessage(data: unknown): void {
    this.lastActivity = Date.now();
    if (typeof data === 'string') {
      let ev: unknown;
      try {
        ev = JSON.parse(data);
      } catch {
        this.log('warn', '无法解析的 JSON 消息', { raw: data.slice(0, 200) });
        return;
      }
      this.dispatch(ev);
      return;
    }
    // 二进制帧（防御性兜底：Qwen 协议音频走 base64 文本，理论上不出现）
    if (data instanceof ArrayBuffer) {
      this.callbacks.audio?.(Buffer.from(data));
    } else if (ArrayBuffer.isView(data)) {
      this.callbacks.audio?.(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    }
  }

  /** 统一消息分发：按 type 路由到回调；function_call 三形态由 extractFunctionCall 兜底 */
  private dispatch(ev: unknown): void {
    if (typeof ev !== 'object' || ev === null) return;
    const e = ev as {
      type?: unknown;
      session?: { id?: string };
      delta?: unknown;
      text?: unknown;
      transcript?: unknown;
      emotion?: unknown;
      error?: { message?: string; type?: string };
    };

    switch (e.type) {
      case 'session.created':
        this.serverSessionId = e.session?.id ?? '';
        this.log('info', 'session.created', { session_id: this.serverSessionId });
        this.sendSessionUpdate();
        break;
      case 'session.updated':
        this.log('info', 'session.updated —— 人设注入成功');
        this.reconnectAttempts = 0; // 连接链路恢复，重置退避计数
        this.startHeartbeat();
        if (this.ready) {
          this.ready.resolve();
          this.ready = null;
        }
        break;
      case 'response.audio.delta':
        if (typeof e.delta === 'string') {
          this.callbacks.audio?.(Buffer.from(e.delta, 'base64'));
        }
        break;
      // 字幕：音频模式走 audio_transcript，纯文本模式走 text（双兼容）
      case 'response.audio_transcript.delta':
      case 'response.text.delta':
        if (typeof e.delta === 'string' && e.delta.length > 0) {
          this.callbacks.subtitle?.(e.delta);
        }
        break;
      // 情绪：协议文档无独立事件，兼容两种来源（顶层 emotion / 转写 delta 内嵌）
      case 'emotion':
        this.callbacks.emotion?.(normalizeEmotion(e.emotion));
        break;
      case 'conversation.item.input_audio_transcription.delta':
        if (e.emotion !== undefined) this.callbacks.emotion?.(normalizeEmotion(e.emotion));
        break;
      case 'error': {
        const msg = e.error?.message ?? '未知错误';
        const type = e.error?.type ?? '';
        // 容错：配置音色不被支持 → 降级默认音色重发 session.update（只降级一次）
        if (!this.voiceFallbackDone && /unsupported voice/i.test(msg)) {
          this.voiceFallbackDone = true;
          this.voice = DEFAULT_VOICE;
          this.log('warn', '音色不受支持，降级重发 session.update', { voice: DEFAULT_VOICE, msg });
          this.sendSessionUpdate();
          break;
        }
        this.log(type === 'server_error' ? 'error' : 'warn', `服务端事件 error`, {
          type,
          message: msg,
        });
        break;
      }
      default:
        break;
    }

    // function_call 提取（三形态兜底，BR-02）：命中才回调，否则静默
    const call = extractFunctionCall(ev);
    if (call) this.callbacks.functionCall?.(call);
  }

  // ---------------------------------------------------------------- 上行

  private sendJson(obj: unknown): void {
    if (this.closed) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.log('warn', '连接未就绪，丢弃上行事件', { type: (obj as { type?: string }).type });
      return;
    }
    this.ws.send(JSON.stringify(obj));
  }

  /** 人设注入：session.update（连接后收到 session.created 即发） */
  private sendSessionUpdate(): void {
    const session: Record<string, unknown> = {
      instructions: this.instructions,
      modalities: ['audio', 'text'],
      voice: this.voice,
      turn_detection: this.opts.turnDetection === null ? null : {
        type: 'server_vad',
        threshold: DEFAULT_VAD.threshold,
        silence_duration_ms: DEFAULT_VAD.silence_duration_ms,
        ...(this.opts.turnDetection ?? {}),
      },
      input_audio_transcription: this.opts.inputAudioTranscription === null ? undefined : {
        enabled: true,
        model: DEFAULT_ASR_MODEL,
        ...(this.opts.inputAudioTranscription ?? {}),
      },
    };
    if (this.opts.tools && this.opts.tools.length > 0) session.tools = this.opts.tools;
    this.sendJson({ type: 'session.update', session });
  }

  // ---------------------------------------------------------------- VoiceSession 契约

  sendAudio(chunk: Buffer): void {
    if (!Buffer.isBuffer(chunk) || chunk.length === 0) return;
    this.sendJson({ type: 'input_audio_buffer.append', audio: chunk.toString('base64') });
  }

  onAudio(cb: (chunk: Buffer) => void): void {
    this.callbacks.audio = cb;
  }

  onSubtitle(cb: (text: string) => void): void {
    this.callbacks.subtitle = cb;
  }

  onEmotion(cb: (e: Emotion) => void): void {
    this.callbacks.emotion = cb;
  }

  onFunctionCall(cb: (call: FunctionCall) => void): void {
    this.callbacks.functionCall = cb;
  }

  /** 注入文本让 Qwen 朗读（Hermes 结果）：插入用户消息 + 触发推理 */
  injectAssistantText(text: string): void {
    if (!text || !text.trim()) return;
    this.sendJson({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'user',
        content: [{ type: 'input_text', text: text.trim() }],
      },
    });
    this.sendJson({ type: 'response.create', response: { modalities: ['audio', 'text'] } });
  }

  /** 打断当前响应（用户插话 / 手动打断） */
  interrupt(): void {
    this.sendJson({ type: 'response.cancel' });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.stopHeartbeat();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = null;
    this.forceClose();
    this.callbacks.audio = undefined;
    this.callbacks.subtitle = undefined;
    this.callbacks.emotion = undefined;
    this.callbacks.functionCall = undefined;
  }

  /** 断开底层 WS（不触发重连标记；close() 前置 closed=true） */
  private forceClose(): void {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.onclose = null; // 手动断开，不走重连
        ws.onerror = null;
        ws.close(1000, 'client close');
      } catch {
        // 忽略关闭异常
      }
    }
  }

  /** 测试/调试辅助：获取服务端 session.id */
  getServerSessionId(): string {
    return this.serverSessionId;
  }
}

/** QwenAudioClient：实现 VoiceProvider 契约，连接即返回会话 */
class QwenAudioClient implements VoiceProvider {
  private readonly options: QwenAudioClientOptions;
  private readonly log: NonNullable<QwenAudioClientOptions['log']>;

  constructor(options: QwenAudioClientOptions = {}) {
    this.options = options;
    this.log = options.log ?? ((level, msg, meta) => {
      const line = `[voice] ${msg}${meta !== undefined ? ' ' + JSON.stringify(meta) : ''}`;
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    });
  }

  async connect(sessionId: string, personaInstructions: string): Promise<VoiceSession> {
    const session = new QwenAudioSessionImpl(sessionId, personaInstructions, this.options);
    try {
      await session.connect();
    } catch (e) {
      this.log('error', '连接失败', { sessionId, error: String(e) });
      await session.close();
      throw e;
    }
    this.log('info', '会话就绪', { sessionId });
    return session;
  }
}

/** 工厂：创建 QwenAudioClient（VS-02 gateway 装配入口） */
export function createQwenAudioClient(options: QwenAudioClientOptions = {}): VoiceProvider {
  return new QwenAudioClient(options);
}

export default createQwenAudioClient;

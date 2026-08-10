/**
 * voice-shell/dispatcher.ts —— 双路分发器（VS-03）
 *
 * 职责：把 VoiceSession（VS-01）的事件流按类型分发到「多路消费者」——
 *   音频 → 播放 / 副文本 → 字幕 / 情绪 → 数字人 / function_call → BR-02。
 *   gateway（VS-02）用它实现"浏览器 + deps 回调"双路；前端（CL-04/05/06）与
 *   数字人（AV-04）是下游消费者。
 *
 * 契约对齐：docs/architecture/module-contracts.md §2.9（v1.8）
 * 规格依据：docs/TASKS-CONFIG.md §VS-03（双路分发，验收：音频→播放；副文本→字幕；情绪→数字人）
 *
 * 关键设计：
 *   - 广播顺序 = 订阅顺序；每个消费者按需实现回调，未实现的静默跳过
 *   - 错误隔离（红线安全）：单个消费者回调抛错不影响其他消费者与后续广播
 *   - 幂等：subscribe 返回退订函数（重复调用无副作用）；dispose 可重复调用
 *   - 只透传不执行（红线 6）：function_call 到消费者即止，执行归 BR-02（VS-06 接入）
 *   - VAD 状态（VS-04）：onVadState 广播与其余事件一致，speaking=true 驱动前端 listening 态
 *   - 零持久化（红线 1）：纯内存广播，无状态、无落盘
 *   - 依赖最小化（红线 5）：零第三方依赖（仅复用 voice-shell 公共类型）
 */

import type { Emotion } from '../avatar/clip-matcher.ts';
import type { FunctionCall } from '../brain/function-router.ts';
import type { VoiceSession } from './provider.ts';

/** 单路消费者：只实现关心的回调，其余可选（契约 §2.9 v1.8） */
export interface VoiceConsumer {
  /** 音频流 → 播放（PCM 24kHz 16bit 单声道，每帧 Buffer） */
  onAudio?(chunk: Buffer): void;
  /** 副文本 → 字幕（AI 回答文本增量，上层累积展示） */
  onSubtitle?(text: string): void;
  /** 情绪 → 数字人（驱动 AvatarCanvas 选片） */
  onEmotion?(e: Emotion): void;
  /** VAD 状态 → 前端/数字人（VS-04：true=用户说话中 listening / false=语音结束） */
  onVadState?(speaking: boolean): void;
  /** function_call → BR-02（只透传不执行） */
  onFunctionCall?(call: FunctionCall): void;
  /** 用户语音转写（VS-05，M17：统一走 dispatcher 分发，享受错误隔离）：
   *  delta=true 增量 / false 最终完整转写 */
  onInputTranscript?(text: string, info: { delta: boolean }): void;
}

/** 双路分发器：绑定会话事件源，广播到所有已注册消费者（契约 §2.9） */
export interface VoiceDispatcher {
  /** 绑定事件源（VoiceSession，VS-01）；再次 bind 先解绑旧会话（幂等） */
  bind(session: VoiceSession): void;
  /** 注册消费者，返回退订函数（幂等） */
  subscribe(consumer: VoiceConsumer): () => void;
  /** 清空全部消费者并解绑事件源（幂等，可复用） */
  dispose(): void;
}

/** 分发器日志级别 */
type DispatcherLog = (
  level: 'debug' | 'info' | 'warn' | 'error',
  msg: string,
  meta?: unknown,
) => void;

export interface VoiceDispatcherOptions {
  /** 日志回调（默认 console） */
  log?: DispatcherLog;
}

/** 分发器实现（不对外暴露，统一走 createVoiceDispatcher 工厂） */
class VoiceDispatcherImpl implements VoiceDispatcher {
  private readonly log: DispatcherLog;
  private consumers: VoiceConsumer[] = [];
  private session: VoiceSession | null = null;

  constructor(options: VoiceDispatcherOptions = {}) {
    this.log = options.log ?? ((level, msg, meta) => {
      const line = `[dispatcher] ${msg}${meta !== undefined ? ' ' + JSON.stringify(meta) : ''}`;
      if (level === 'error') console.error(line);
      else if (level === 'warn') console.warn(line);
      else console.log(line);
    });
  }

  bind(session: VoiceSession): void {
    // 重复 bind：先解绑旧会话（置空引用，防事件泄漏到旧会话）
    this.unbindSession();
    this.session = session;
    session.onAudio((chunk) => this.broadcastAudio(chunk));
    session.onSubtitle((text) => this.broadcastSubtitle(text));
    session.onEmotion((e) => this.broadcastEmotion(e));
    session.onVadState((speaking) => this.broadcastVadState(speaking));
    session.onFunctionCall((call) => this.broadcastFunctionCall(call));
    session.onInputTranscript((text, info) => this.broadcastInputTranscript(text, info)); // M17
    this.log('info', '已绑定会话事件源');
  }

  subscribe(consumer: VoiceConsumer): () => void {
    this.consumers.push(consumer);
    this.log('debug', '消费者订阅', { total: this.consumers.length });
    let active = true;
    return () => {
      if (!active) return; // 幂等退订
      active = false;
      const i = this.consumers.indexOf(consumer);
      if (i >= 0) this.consumers.splice(i, 1);
      this.log('debug', '消费者退订', { remaining: this.consumers.length });
    };
  }

  dispose(): void {
    this.unbindSession();
    const count = this.consumers.length;
    this.consumers = [];
    this.log('info', '分发器已清空', { consumers: count });
  }

  /** 解绑会话事件源（幂等）：VoiceSession 回调为覆盖式单槽位，
   *  用空回调覆盖旧会话槽位，断开其到分发器的广播链路（防事件泄漏到旧会话） */
  private unbindSession(): void {
    const s = this.session;
    this.session = null;
    if (!s) return;
    s.onAudio(() => undefined);
    s.onSubtitle(() => undefined);
    s.onEmotion(() => undefined);
    s.onVadState(() => undefined);
    s.onFunctionCall(() => undefined);
    s.onInputTranscript(() => undefined); // M17
    this.log('debug', '已解绑旧会话事件源');
  }

  /** 广播音频帧 → 播放消费者 */
  private broadcastAudio(chunk: Buffer): void {
    for (const c of [...this.consumers]) {
      if (!c.onAudio) continue;
      this.safeCall('onAudio', () => c.onAudio!(chunk));
    }
  }

  /** 广播副文本 → 字幕消费者 */
  private broadcastSubtitle(text: string): void {
    for (const c of [...this.consumers]) {
      if (!c.onSubtitle) continue;
      this.safeCall('onSubtitle', () => c.onSubtitle!(text));
    }
  }

  /** 广播情绪 → 数字人消费者 */
  private broadcastEmotion(e: Emotion): void {
    for (const c of [...this.consumers]) {
      if (!c.onEmotion) continue;
      this.safeCall('onEmotion', () => c.onEmotion!(e));
    }
  }

  /** 广播 VAD 状态 → 前端/数字人消费者（VS-04） */
  private broadcastVadState(speaking: boolean): void {
    for (const c of [...this.consumers]) {
      if (!c.onVadState) continue;
      this.safeCall('onVadState', () => c.onVadState!(speaking));
    }
  }

  /** 广播 function_call → BR-02 消费者（只透传不执行） */
  private broadcastFunctionCall(call: FunctionCall): void {
    for (const c of [...this.consumers]) {
      if (!c.onFunctionCall) continue;
      this.safeCall('onFunctionCall', () => c.onFunctionCall!(call));
    }
  }

  /** 广播用户语音转写（VS-05，M17：统一走 dispatcher，享受错误隔离） */
  private broadcastInputTranscript(text: string, info: { delta: boolean }): void {
    for (const c of [...this.consumers]) {
      if (!c.onInputTranscript) continue;
      this.safeCall('onInputTranscript', () => c.onInputTranscript!(text, info));
    }
  }

  /** 错误隔离：单消费者回调抛错不影响其他消费者与后续广播 */
  private safeCall(method: string, fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.log('error', `消费者回调异常（已隔离）`, {
        method,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

/** 创建双路分发器（VS-03 装配入口；gateway 双路分发用） */
export function createVoiceDispatcher(options: VoiceDispatcherOptions = {}): VoiceDispatcher {
  return new VoiceDispatcherImpl(options);
}

export default createVoiceDispatcher;

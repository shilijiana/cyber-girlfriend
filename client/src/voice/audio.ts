/**
 * client/voice/audio.ts —— 浏览器音频工具（CL-08；CL-06 useVoice 的前置依赖）
 *
 * 职责：
 *  - PCM 编解码与重采样（纯函数，node 可直接自检）
 *  - 麦克风采集：getUserMedia → 采集帧（48k/44.1k）→ 线性插值重采样 16kHz → Int16 PCM 帧
 *  - AI 语音播放：PCM 24kHz 16bit 帧 → AudioBuffer 顺序队列播放（消除帧间间隙），支持打断
 *
 * 链路（CL-06）：
 *   mic ──PCM16k ArrayBuffer──▶ WS(/ws/voice) ──PCM24k ArrayBuffer──▶ player
 *
 * 契约对齐：docs/architecture/module-contracts.md §2.1（上行 16kHz / 下行 24kHz 16bit PCM）
 * 红线：零第三方依赖（仅 Web Audio API）；零持久化（红线 1）。
 */

// ============================================================ 纯函数（可测）

/**
 * Float32 样本（[-1,1]）→ Int16 LE PCM ArrayBuffer。
 * 端点对称：-1 → -32768，+1 → +32768 后 clamp 到 32767，防削波溢出。
 */
export function encodePCM16(samples: Float32Array): ArrayBuffer {
  const out = new ArrayBuffer(samples.length * 2);
  const view = new DataView(out);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    const v = Math.round(s * 32768);
    view.setInt16(i * 2, Math.max(-32768, Math.min(32767, v)), true); // true = little-endian
  }
  return out;
}

/**
 * Int16 LE PCM ArrayBuffer → Float32 样本（[-1,1]）。
 * 字节数不是 2 的倍数时忽略末尾残缺字节。
 */
export function decodePCM16(buf: ArrayBuffer): Float32Array {
  const view = new DataView(buf);
  const n = Math.floor(view.byteLength / 2);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = view.getInt16(i * 2, true) / 32768;
  }
  return out;
}

/**
 * 线性插值重采样（对语音足够；目标采样率可高于/低于源采样率）。
 * 目标样本 j 对应源位置 j * fromRate / toRate，取两侧样本线性插值。
 */
export function resampleLinear(src: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return src;
  if (fromRate <= 0 || toRate <= 0 || src.length === 0) return new Float32Array(0);
  const outLen = Math.max(1, Math.ceil((src.length * toRate) / fromRate));
  const out = new Float32Array(outLen);
  const ratio = fromRate / toRate;
  const last = src.length - 1;
  for (let j = 0; j < outLen; j++) {
    const pos = j * ratio;
    const i0 = Math.min(last, Math.floor(pos)); // 末端越界 clamp（时间轴末尾保持末样本）
    const i1 = Math.min(last, i0 + 1);
    const frac = pos - i0;
    out[j] = src[i0] * (1 - frac) + src[i1] * frac;
  }
  return out;
}

/**
 * RMS 能量（0~1，归一化到 [-1,1] 满幅）：波形/情绪动画的能量驱动（CL-05 用）。
 * 空输入返回 0；对单样本返回其绝对值。
 */
export function computeEnergy(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i] ?? 0;
    sum += s * s;
  }
  return Math.sqrt(sum / samples.length);
}

// ============================================================ 麦克风采集（浏览器）

export interface MicCaptureCallbacks {
  /** 每帧重采样后的 PCM 16kHz 16bit LE（ArrayBuffer），可直接上行发送 */
  onData: (pcm16: ArrayBuffer) => void;
  /** 采集出错（如用户拒绝授权） */
  onError?: (error: Error) => void;
}

export interface MicCapture {
  /** 请求麦克风授权并开始采集；返回实际采集采样率 */
  start(): Promise<number>;
  /** 停止采集并释放麦克风与上下文 */
  stop(): void;
  /** 是否正在采集 */
  readonly active: boolean;
}

/**
 * 创建麦克风采集器：getUserMedia → MediaStreamSource → ScriptProcessor（4096 帧）
 * → 线性插值重采样 16kHz → encodePCM16 → onData 回调。
 * 浏览器默认采集率 48k（部分设备 44.1k），Qwen 上行要求 16kHz（契约 §2.1）。
 */
export function createMicCapture(cb: MicCaptureCallbacks): MicCapture {
  let ctx: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let processor: ScriptProcessorNode | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let active = false;

  const targetRate = 16000;

  const stopAll = (): void => {
    active = false;
    try {
      processor?.disconnect();
    } catch {
      /* 忽略 */
    }
    try {
      source?.disconnect();
    } catch {
      /* 忽略 */
    }
    processor = null;
    source = null;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
      stream = null;
    }
    if (ctx) {
      void ctx.close().catch(() => undefined);
      ctx = null;
    }
  };

  return {
    get active() {
      return active;
    },

    async start(): Promise<number> {
      if (active) return ctx?.sampleRate ?? targetRate;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        ctx = new AudioContext();
        if (ctx.state === 'suspended') await ctx.resume();
        source = ctx.createMediaStreamSource(stream);
        processor = ctx.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (e: AudioProcessingEvent) => {
          const input = e.inputBuffer.getChannelData(0);
          const resampled = resampleLinear(input, ctx?.sampleRate ?? 48000, targetRate);
          cb.onData(encodePCM16(resampled));
        };
        source.connect(processor);
        processor.connect(ctx.destination);
        active = true;
        return ctx.sampleRate;
      } catch (e) {
        cb.onError?.(e instanceof Error ? e : new Error(String(e)));
        stopAll();
        throw e;
      }
    },

    stop(): void {
      stopAll();
    },
  };
}

// ============================================================ 语音播放（浏览器）

export interface AudioPlayer {
  /** 播放一帧 PCM 24kHz 16bit LE（入队顺序播放，消除帧间间隙） */
  play(chunk: ArrayBuffer): void;
  /** 打断：停止当前播放并清空队列 */
  interrupt(): void;
  /** 释放播放上下文 */
  close(): void;
  /** 是否有音频正在播放/排队 */
  readonly isPlaying: boolean;
}

/**
 * 创建 AI 语音播放器：PCM 24kHz 帧 → AudioBuffer（24kHz）→ AudioBufferSourceNode 顺序播放。
 * 浏览器自动把 24kHz AudioBuffer 重采样到输出设备采样率，无需手动处理。
 * 队列 + onended 链式 pump：保证多帧连续播放无间隙；interrupt 立即静音。
 */
export function createAudioPlayer(): AudioPlayer {
  let ctx: AudioContext | null = null;
  let current: AudioBufferSourceNode | null = null;
  let queue: Float32Array[] = [];
  let pumping = false;
  let disposed = false;

  const ensureCtx = (): AudioContext => {
    if (!ctx) {
      ctx = new AudioContext();
    }
    return ctx;
  };

  const pump = (): void => {
    if (pumping || disposed || !ctx) return;
    if (queue.length === 0) {
      current = null;
      return;
    }
    const samples = queue[0];
    queue = queue.slice(1);
    const buffer = ctx.createBuffer(1, samples.length, 24000);
    buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(ctx.destination);
    current = node;
    pumping = true;
    node.onended = () => {
      pumping = false;
      if (current === node) current = null;
      pump(); // 播完接下一帧
    };
    node.start();
  };

  return {
    get isPlaying() {
      return pumping || queue.length > 0;
    },

    play(chunk: ArrayBuffer): void {
      if (disposed || chunk.byteLength === 0) return;
      const c = ensureCtx();
      if (c.state === 'suspended') void c.resume();
      queue.push(decodePCM16(chunk));
      pump();
    },

    interrupt(): void {
      queue = [];
      if (current) {
        try {
          current.onended = null; // 手动停止不触发 pump
          current.stop();
        } catch {
          /* 已停止 */
        }
        current = null;
      }
      pumping = false;
    },

    close(): void {
      disposed = true;
      this.interrupt();
      if (ctx) {
        void ctx.close().catch(() => undefined);
        ctx = null;
      }
    },
  };
}

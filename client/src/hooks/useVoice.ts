/**
 * client/hooks/useVoice.ts —— 语音会话 Hook（CL-06，P0）
 *
 * 职责：把「麦克风采集 + /ws/voice 双向语音 + AI 语音播放 + 打断」封装为
 *   React 状态与命令，供聊天页/数字人画布消费。
 *
 * 链路（对齐契约 §2.1 / VS-02 gateway 实现）：
 *   connect()
 *     ├─ mic.start()：getUserMedia → 重采样 16kHz → Int16 PCM 帧
 *     ├─ ws = new WebSocket(/ws/voice)（vite 代理到后端 3000）
 *     ├─ 上行：二进制 PCM16k 帧直发（gateway 二进制帧 = 上行音频）
 *     ├─ 下行：ready → connected；status → speaking/listening/connected；
 *     │        audio(PCM24k base64) → player 顺序播放
 *     │        subtitle / user_transcript / emotion / brain / error → 回调
 *     └─ 状态机：voice-machine.ts 纯函数归约
 *
 * 生命周期：connect() 创建 mic+player+ws；disconnect() 全量释放；
 *   组件卸载（useEffect cleanup）自动 disconnect —— StrictMode 双调用安全。
 *
 * 红线：零持久化；零第三方依赖（WebSocket/Web Audio API 原生）。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createAudioPlayer, createMicCapture, type AudioPlayer, type MicCapture } from '../voice/audio.ts';
import {
  INITIAL_VOICE_STATUS,
  isVoiceActive,
  mapGatewayState,
  voiceMachineReduce,
  type VoiceStatus,
} from '../voice/voice-machine.ts';
import type { Emotion } from '../../../avatar/clip-matcher.ts';

/** 网关下行事件（契约 §2.1 + VS-05/VS-06 补充，只取 useVoice 关心的字段） */
interface GatewayDownstream {
  type?: string;
  state?: 'connected' | 'speaking' | 'listening' | 'idle';
  data?: string;           // audio: base64 PCM24k
  text?: string;           // subtitle / user_transcript
  delta?: boolean;         // user_transcript 增量标志
  emotion?: Emotion;       // emotion 事件
  status?: 'working' | 'done'; // brain 工作状态
  result?: string;         // brain 结果
  message?: string;        // error 描述
  config?: { sampleRate?: number }; // ready 配置
  speaking?: boolean;      // vad_state: 用户是否正在说话（VAD，字幕清空驱动）
}

export interface UseVoiceOptions {
  /** WS 地址；默认同源 /ws/voice（vite dev 代理 ws://localhost:3000） */
  url?: string;
  /** 字幕（AI 副文本，S2S 增量，供 CaptionBar CL-04） */
  onSubtitle?: (text: string) => void;
  /** 用户语音转写（VS-05：delta=true 增量 / false 最终完整转写） */
  onUserTranscript?: (text: string, delta: boolean) => void;
  /** 情绪事件（驱动数字人 CL-02 / AV-04） */
  onEmotion?: (e: Emotion) => void;
  /** Hermes 工作状态（VS-06：working/done） */
  onBrainStatus?: (status: 'working' | 'done', result?: string) => void;
  /** AI 播放能量回调（0~1，CL-05 波形能量源；经 player AnalyserNode 采样） */
  onEnergy?: (energy: number) => void;
  /** VAD 状态回调（用户开始/结束说话；驱动字幕清空与说话人切换） */
  onVadState?: (speaking: boolean) => void;
  /** 错误回调（网关 error / 连接失败 / 麦克风拒绝） */
  onError?: (message: string) => void;
}

export interface UseVoiceResult {
  /** 当前语音状态（状态机归约结果） */
  status: VoiceStatus;
  /** 最近一次错误描述（无错误为 null） */
  error: string | null;
  /** 会话是否活跃（connected/speaking/listening） */
  active: boolean;
  /** 建立语音会话：申请麦克风授权 + 连接 /ws/voice；失败进入 error 态 */
  connect: () => Promise<void>;
  /** 断开会话并释放麦克风/播放器/WS（幂等） */
  disconnect: () => void;
  /** 打断 AI 当前响应（barge-in；server_vad 下服务端也会自动处理插话） */
  sendInterrupt: () => void;
}

export function useVoice(options: UseVoiceOptions = {}): UseVoiceResult {
  const [status, setStatus] = useState<VoiceStatus>(INITIAL_VOICE_STATUS);
  const [error, setError] = useState<string | null>(null);

  // 回调用 ref 持有最新引用，避免 WS 处理函数随渲染重建
  const optsRef = useRef(options);
  optsRef.current = options;

  const wsRef = useRef<WebSocket | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const playerRef = useRef<AudioPlayer | null>(null);
  const closedByUserRef = useRef(false);
  // H9：连接互斥锁——connect() 是 async，status 是闭包捕获值，快速双击会两次读到
  //   idle 创建双重 mic/player/ws 资源（第二套覆盖 ref，第一套泄漏）。用 ref 锁防重入。
  const connectingRef = useRef(false);

  const dispatch = useCallback((e: Parameters<typeof voiceMachineReduce>[1]) => {
    setStatus((s) => voiceMachineReduce(s, e));
  }, []);

  // ------------------------------------------------------------ 下行事件处理
  const handleMessage = useCallback((raw: MessageEvent) => {
    let ev: GatewayDownstream;
    try {
      ev = JSON.parse(String(raw.data)) as GatewayDownstream;
    } catch {
      return; // 非 JSON（不期望出现，网关下行均为 JSON）
    }
    const opts = optsRef.current;
    switch (ev.type) {
      case 'ready':
        dispatch({ type: 'CONNECTED' });
        break;
      case 'status':
        if (ev.state) dispatch(mapGatewayState(ev.state));
        break;
      case 'audio':
        if (typeof ev.data === 'string' && ev.data.length > 0) {
          // base64 PCM24k → ArrayBuffer → 顺序播放
          const bin = Uint8Array.from(atob(ev.data), (c) => c.charCodeAt(0));
          playerRef.current?.play(bin.buffer);
        }
        break;
      case 'subtitle':
        if (typeof ev.text === 'string') opts.onSubtitle?.(ev.text);
        break;
      case 'user_transcript':
        if (typeof ev.text === 'string') opts.onUserTranscript?.(ev.text, ev.delta === true);
        break;
      case 'vad_state':
        if (typeof ev.speaking === 'boolean') opts.onVadState?.(ev.speaking);
        break;
      case 'emotion':
        if (ev.emotion) opts.onEmotion?.(ev.emotion);
        break;
      case 'brain':
        if (ev.status === 'working' || ev.status === 'done') {
          opts.onBrainStatus?.(ev.status, ev.result);
        }
        break;
      case 'error':
        fail(`语音服务错误：${ev.message ?? '未知错误'}`);
        break;
      default:
        break;
    }
  }, [dispatch]);

  const fail = useCallback((message: string) => {
    setError(message);
    dispatch({ type: 'ERROR' });
    optsRef.current.onError?.(message);
  }, [dispatch]);

  // ------------------------------------------------------------ 资源释放（幂等）
  const teardown = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'close' }));
      } catch {
        /* 忽略 */
      }
    }
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* 忽略 */
      }
    }
    wsRef.current = null;
    micRef.current?.stop();
    micRef.current = null;
    playerRef.current?.close();
    playerRef.current = null;
  }, []);

  // ------------------------------------------------------------ 连接
  const connect = useCallback(async (): Promise<void> => {
    if (isVoiceActive(status)) return;
    if (connectingRef.current) return; // H9：防重入（快速双击/并发调用只建一套资源）
    connectingRef.current = true;
    setError(null);
    dispatch({ type: 'CONNECT' });

    try {
      // ① 播放器（每次会话新建，随 disconnect 释放；可选 onEnergy 供波形）
      const player = createAudioPlayer({ onEnergy: optsRef.current.onEnergy });
      playerRef.current = player;

      // ② 麦克风授权 + 采集（失败 → error 态，不连 WS）
      const mic = createMicCapture({
        onData: (pcm16) => {
          const ws = wsRef.current;
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(pcm16); // 二进制帧 = 上行 PCM16k（gateway 判定）
          }
        },
        onError: (e) => {
          fail(`麦克风不可用：${e.message}`);
        },
      });
      micRef.current = mic;
      try {
        await mic.start();
      } catch {
        // mic.start 内部已调 onError → fail；此处避免重复报错
        return;
      }

      // ③ 连接 /ws/voice（L20：HTTPS 生产环境用 wss://，避免混合内容策略拦截）
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = options.url ?? `${protocol}//${location.host}/ws/voice`;
      closedByUserRef.current = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (e) {
        fail(`无法建立语音连接：${String(e)}`);
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        // 连接即就绪（gateway 会自动下发 ready），显式 start 幂等，无需发送
      };
      ws.onmessage = handleMessage;
      ws.onerror = () => {
        fail('语音连接异常');
      };
      ws.onclose = () => {
        if (wsRef.current !== ws) return; // 已被新会话替换
        if (!closedByUserRef.current) {
          // 非用户主动关闭（服务端断开/异常）→ 释放资源
          dispatch({ type: 'DISCONNECT' });
          micRef.current?.stop();
          micRef.current = null;
          playerRef.current?.close();
          playerRef.current = null;
          wsRef.current = null;
        }
      };
    } finally {
      connectingRef.current = false; // H9：释放互斥锁（所有路径统一出口）
    }
  }, [status, dispatch, fail, handleMessage]);

  // ------------------------------------------------------------ 断开
  const disconnect = useCallback(() => {
    closedByUserRef.current = true;
    teardown();
    dispatch({ type: 'DISCONNECT' });
  }, [teardown, dispatch]);

  // ------------------------------------------------------------ 打断
  const sendInterrupt = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ type: 'interrupt' }));
      } catch {
        /* 忽略 */
      }
    }
    playerRef.current?.interrupt();
  }, []);

  // ------------------------------------------------------------ 卸载清理（StrictMode 安全）
  useEffect(() => {
    return () => {
      closedByUserRef.current = true;
      teardown();
    };
  }, [teardown]);

  return {
    status,
    error,
    active: isVoiceActive(status),
    connect,
    disconnect,
    sendInterrupt,
  };
}

export default useVoice;

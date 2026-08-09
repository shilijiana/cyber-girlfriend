/**
 * voice-shell/provider.ts —— VoiceProvider 契约定义（VS-01）
 *
 * 职责：定义语音壳的统一接入抽象。app/server 编排层（gateway, VS-02）
 *   通过本接口驱动语音会话；实现可替换（Qwen-Audio / Seeduplex / Qwen3-Omni，
 *   按 ADR-001 供应商抽象可替换）。
 *
 * 契约对齐：docs/architecture/module-contracts.md §2.2（v1.8）
 * 复用类型（不重复定义）：
 *   - FunctionCall ← brain/function-router.ts（BR-02，函数调用归一化类型）
 *   - FunctionCallOutput ← brain/function-router.ts（BR-02，写回内容，VS-06）
 *   - Emotion ← avatar/clip-matcher.ts（数字人情绪）
 *
 * 模块边界：纯类型定义，零运行时依赖（ADR-007）。实现见 qwen-audio-client.ts。
 */

import type { FunctionCall, FunctionCallOutput } from '../brain/function-router.ts';
import type { Emotion } from '../avatar/clip-matcher.ts';

/** 语音会话：一次 connect 对应一个会话（内部可断线重连，对外回调不丢） */
export interface VoiceSession {
  /** 上行用户音频（PCM 16kHz 16bit 单声道，按帧切块发送） */
  sendAudio(chunk: Buffer): void;
  /** 下行 AI 语音（PCM 24kHz 16bit 单声道，每帧 Buffer） */
  onAudio(cb: (chunk: Buffer) => void): void;
  /** 字幕（AI 回答文本增量，由上层累积/展示） */
  onSubtitle(cb: (text: string) => void): void;
  /** 情绪（数字人触发；协议无独立事件时可为 neutral 或不触发） */
  onEmotion(cb: (e: Emotion) => void): void;
  /** 函数调用（Hermes 触发，BR-02 的 FunctionCall 类型；透传不执行） */
  onFunctionCall(cb: (call: FunctionCall) => void): void;
  /** 用户语音输入转写（VS-05）：delta=true 增量片段 / delta=false 最终完整转写（item 结束时回调） */
  onInputTranscript(cb: (text: string, info: { delta: boolean }) => void): void;
  /** VAD 状态（VS-04，server_vad 模式）：speech_started → true / speech_stopped → false，前端据此切 listening 态 */
  onVadState(cb: (speaking: boolean) => void): void;
  /** 写回 function_call_output（VS-06）：conversation.item.create + response.create，让 Qwen 组织语音回复 */
  sendFunctionCallOutput(out: FunctionCallOutput): void;
  /** 注入文本让 Qwen 朗读（Hermes 结果）：conversation.item.create + response.create */
  injectAssistantText(text: string): void;
  /** 打断当前响应（response.cancel） */
  interrupt(): void;
  /** 关闭会话（手动关闭，不触发重连） */
  close(): Promise<void>;
}

/** 语音供应商抽象：连接即返回可用的会话 */
export interface VoiceProvider {
  /**
   * @param sessionId 业务侧会话标识（仅用于日志/追踪，服务端 session.id 由服务端生成）
   * @param personaInstructions 人设指令（FilePersonaProvider 组装，注入 session.update）
   */
  connect(sessionId: string, personaInstructions: string): Promise<VoiceSession>;
}

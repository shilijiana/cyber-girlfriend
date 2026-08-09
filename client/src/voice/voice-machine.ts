/**
 * client/voice/voice-machine.ts —— useVoice 语音状态机核心（CL-06）
 *
 * 纯函数状态机：把「本地动作 + 网关 status 事件」归约为稳定的 UI 状态，
 * 与 React 解耦（node 可直接自检，与 avatar-canvas-core 的"纯逻辑核心"惯例一致）。
 *
 * 状态定义：
 *   idle        未连接/空闲
 *   connecting  正在建立 WS 会话
 *   connected   已就绪（网关 ready，可交互）
 *   speaking    AI 说话中（网关 status: speaking）
 *   listening   用户说话中（网关 status: listening，VS-04 server_vad）
 *   closed      已关闭（主动断开 / 连接断开）
 *   error       出错（网关 error / WS 异常）
 *
 * 网关状态映射（VS-02 gateway 下行 {type:'status'}）：
 *   connected/idle → connected（gateway 的 idle 是"AI 说完回到空闲"，本质等价就绪）
 *   speaking       → speaking
 *   listening      → listening
 */

/** 客户端语音状态 */
export type VoiceStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'speaking'
  | 'listening'
  | 'closed'
  | 'error';

/** 状态机事件（本地动作 + 网关事件归约） */
export type VoiceMachineEvent =
  | { type: 'CONNECT' }     // 本地：发起连接
  | { type: 'CONNECTED' }   // 网关：ready / status connected|idle
  | { type: 'SPEAKING' }    // 网关：status speaking（AI 说话）
  | { type: 'LISTENING' }   // 网关：status listening（用户说话，VAD）
  | { type: 'ERROR' }       // 网关：error 事件 / WS 异常 / 连接失败
  | { type: 'DISCONNECT' }; // 本地：主动断开 / WS close

/** 初始状态 */
export const INITIAL_VOICE_STATUS: VoiceStatus = 'idle';

/** 状态机归约：状态转移，非法转移保持原状 */
export function voiceMachineReduce(state: VoiceStatus, event: VoiceMachineEvent): VoiceStatus {
  switch (event.type) {
    case 'CONNECT':
      return state === 'idle' || state === 'closed' || state === 'error' ? 'connecting' : state;
    case 'CONNECTED':
      return state === 'error' || state === 'closed' ? state : 'connected';
    case 'SPEAKING':
      return state === 'error' || state === 'closed' ? state : 'speaking';
    case 'LISTENING':
      return state === 'error' || state === 'closed' ? state : 'listening';
    case 'ERROR':
      return 'error';
    case 'DISCONNECT':
      return 'closed';
    default:
      return state;
  }
}

/** 网关 status 状态 → 状态机事件（VS-02 下行 {type:'status', state}） */
export function mapGatewayState(
  s: 'connected' | 'speaking' | 'listening' | 'idle',
): VoiceMachineEvent {
  switch (s) {
    case 'speaking':
      return { type: 'SPEAKING' };
    case 'listening':
      return { type: 'LISTENING' };
    case 'connected':
    case 'idle':
      return { type: 'CONNECTED' };
  }
}

/** 会话是否活跃（语音链路可用：已就绪/说话中） */
export function isVoiceActive(status: VoiceStatus): boolean {
  return status === 'connected' || status === 'speaking' || status === 'listening';
}

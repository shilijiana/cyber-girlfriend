# VS-04 · VAD 与打断（任务规格）

> **任务编号**：VS-04（voice-shell 模块，P1）
> **目标文件**：`voice-shell/qwen-audio-client.ts`、`voice-shell/gateway.ts`、`voice-shell/dispatcher.ts`、`voice-shell/provider.ts`
> **依赖**：VS-02 ✅（gateway）、VS-01 ✅（client 已默认注入 server_vad）
> **配套**：`docs/TASKS-CONFIG.md` §VS 模块、`docs/architecture/module-contracts.md` §2.1/§2.2/§2.9（v1.8）
> **更新日期**：2026-08-09

---

## 1. 任务目标

让语音链路具备**说话自动打断**能力：server_vad 模式下，用户开口说话时 AI 自动闭嘴（barge-in），前端（数字人/UI）同步切到 listening 态。

## 2. 协议依据（官方文档实测 ✅，2026-08-09）

| 项 | 值 |
|----|-----|
| **轮次检测** | `session.update` 配 `turn_detection: {type:'server_vad', threshold, silence_duration_ms}` |
| **模式对比** | `server_vad`：服务端 VAD 检测语音起止自动触发推理；`smart_turn`：融合语义，过滤"嗯/啊"；`null`（push-to-talk）：客户端手动提交 |
| **VAD 事件** | 下行 `input_audio_buffer.speech_started`（语音开始）/ `input_audio_buffer.speech_stopped`（语音结束） |
| **打断语义** | **模型播报期间 VAD 检测到用户开始说话 → 服务端自动取消当前响应**（`response.done` status=cancelled，reason=turn_detected），客户端**无需主动 response.cancel** |
| **转写联动** | speech_started 后服务端流式返回 `conversation.item.input_audio_transcription.delta`（VS-05 已接） |

## 3. 接口契约（契约 v1.8 新增）

```ts
// voice-shell/provider.ts（§2.2）
onVadState(cb: (speaking: boolean) => void): void;
// speech_started → true / speech_stopped → false

// voice-shell/dispatcher.ts（§2.9 VoiceConsumer）
onVadState?(speaking: boolean): void;
// 广播顺序 = 订阅顺序，与其余事件一致

// §2.1 WS 协议（网关 → 浏览器）
{ type: 'status', state: 'connected' | 'speaking' | 'listening' | 'idle' }
// listening = 用户说话中（VAD 触发），前端数字人/UI 据此切换
```

## 4. 实现要点

1. **client（qwen-audio-client.ts）**：`dispatch` 处理 `input_audio_buffer.speech_started/stopped` → 归一化 `onVadState(speaking:boolean)`；`turn_detection` 默认已配 server_vad（threshold 0.5 / silence 800ms，官方推荐 400-800ms），`turnDetection:null` 可切 push-to-talk
2. **dispatcher（VS-03 基础上）**：`VoiceConsumer` 加 `onVadState`，`bind` 注册 + `broadcastVadState` 广播，错误隔离同其余事件
3. **gateway（VS-02 基础上）**：状态机 `connected/speaking/listening/idle` 四态；VAD true → `listening`（并清 idle 回退定时器），VAD false → 回 `connected`（等 AI 响应，audio 事件自然切 speaking）
4. **打断职责边界**：用户插话打断 AI 由**服务端 server_vad 自动完成**，客户端只透传状态，不做多余 response.cancel（防与官方机制打架）

## 5. 验收标准（自检）

| # | 验收点 | 自检方法 |
|---|--------|----------|
| 1 | server_vad 注入 | session.update 载荷含 `turn_detection:{type:'server_vad', threshold, silence_duration_ms}`（mock 断言） |
| 2 | 开始说话回调 | `speech_started` 事件 → `onVadState(true)`（vad-unit-test ②） |
| 3 | 语音结束回调 | `speech_stopped` 事件 → `onVadState(false)`（vad-unit-test ③） |
| 4 | listening 状态 | gateway 收到 VAD true → 浏览器 `status:listening`；false → `connected`（gateway-unit-test ⑦） |
| 5 | push-to-talk 兼容 | `turnDetection:null` → `turn_detection:null`（vad-unit-test ④） |
| 6 | 清理 | close 后 VAD 回调不再触发（vad-unit-test ⑤） |
| 7 | 无回归 | tsc 零错误；gateway 26/26、transcript 7/7、vad 8/8 全过 |

## 6. 边界与红线

- ✅ 只改 voice-shell 四文件（provider/dispatcher/client/gateway）+ 契约 v1.8，不碰 app/brain/avatar
- ✅ 无状态、无持久化（红线 1）；接口变更先改契约（红线 4，v1.8）
- ✅ 依赖最小化（红线 5）：零新增依赖
- ⚠️ 不主动 response.cancel：server_vad 下打断由服务端处理，客户端只透传状态（契约 v1.8 语义）

---

*VS-04 任务规格 v1.0 · 2026-08-09 · 官方文档核实（server_vad 打断由服务端自动取消）+ mock 单测 8/8 + gateway 回归 26/26*

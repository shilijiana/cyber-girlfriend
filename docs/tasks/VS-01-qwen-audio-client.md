# VS-01 · Qwen-Audio Realtime WS 客户端（任务规格）

> **任务编号**：VS-01（voice-shell 模块，P0）
> **目标文件**：`voice-shell/qwen-audio-client.ts`
> **依赖**：PS-02 ✅（人设 FilePersonaProvider）、DASHSCOPE_API_KEY ✅（已配置+实测通过）
> **配套**：`docs/TASKS-CONFIG.md` §VS 模块、`docs/architecture/module-contracts.md` §2.2
> 更新日期：2026-08-09

---

## 1. 任务目标

实现 Qwen-Audio-3.0-Realtime-Flash 的 WebSocket 客户端，让赛博女友具备"听和说"能力：
- 连接实时语音服务（WS）
- 注入人设（session.update instructions）
- 收发音频（上行 16kHz / 下行 24kHz）
- 回调事件（字幕/情绪/function_call）

## 2. 连接信息（实测验证 ✅，2026-08-09）

| 项 | 值 |
|----|-----|
| **WS URL** | `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen-audio-3.0-realtime-flash` |
| **鉴权** | Header `Authorization: Bearer <DASHSCOPE_API_KEY>`（握手阶段验证） |
| **API Key 位置** | `config/apikeys.json` → `dashscope.apiKey`（gitignore，代码用 `config/loader.ts` 读） |
| **实测结果** | ✅ 连接成功 → `session.created`（session_id）→ `session.update` 被接受 |
| **可选升级** | `wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime`（业务空间域名，需 Workspace ID） |
| **音频格式** | 上行 PCM 16kHz 16bit · 下行 PCM 24kHz 16bit |

## 3. 接口契约（对齐 module-contracts.md §2.2）

```ts
// voice-shell/provider.ts（契约定义）
export interface VoiceSession {
  sendAudio(chunk: Buffer): void;                          // 上行用户音频
  onAudio(cb: (chunk: Buffer) => void): void;              // 下行 AI 语音
  onSubtitle(cb: (text: string) => void): void;            // 字幕
  onEmotion(cb: (e: Emotion) => void): void;               // 情绪
  onFunctionCall(cb: (call: FunctionCall) => void): void;  // Hermes 触发（BR-02 类型）
  injectAssistantText(text: string): void;                 // 注入 Hermes 结果朗读
  interrupt(): void;
  close(): Promise<void>;
}
export interface VoiceProvider {
  connect(sessionId: string, personaInstructions: string): Promise<VoiceSession>;
}
```

**复用类型**（不要重复定义，直接 import）：
- `FunctionCall` ← `brain/function-router.ts`（BR-02 已交付）
- `Emotion` ← `avatar/clip-matcher.ts`（'happy'|'gentle'|'serious'|'surprise'|'neutral'）
- `config` ← `config/loader.ts`

## 4. 协议要点（Qwen-Audio Realtime 事件）

**客户端 → 服务端**：
```jsonc
// ① 人设注入（连接后立即发）
{ "type": "session.update", "session": {
    "instructions": "<personaInstructions>",   // 来自 FilePersonaProvider
    "modalities": ["audio", "text"],
    "voice": "longanqian",  // 默认官方音色；小呆活泼人设可配 longanhuan_v3.6
    "input_audio_transcription": { "enabled": true }  // VS-05 转写开关
} }
// ② 上行音频（二进制或 base64 事件）
{ "type": "input_audio_buffer.append", "audio": "<base64>" }
```

> ⚠️ **音色修正（2026-08-09 实测）**：旧音色 `zh_female_roumeinvyou_uranus_bigtts` 在 flash 模型**已不支持**（实测 Unsupported voice 错误），默认改为官方 `longanqian`。官方支持音色：longanqian / longanlingxin / longanlufeng / longanlingxi / longanxiaoxin / longanfengyue / longanyuanfei / longanhuan_v3.6 / longjielidou_v3.6 / longpaopao_v3.6 / longhuohuo_v3.6 / longchuanshu_v3.6 / loongmary / loongeva_v3.6 / loongjohn。客户端已加"音色不支持自动降级重发 session.update"容错。

**服务端 → 客户端**（回调事件）：
```jsonc
// 会话建立
{ "type": "session.created", "session": { "id": "..." } }
// 会话更新确认
{ "type": "session.updated" }
// AI 语音（下行音频，base64 PCM24k）
{ "type": "response.audio.delta", "delta": "<base64>" }
// 字幕（副文本）
{ "type": "response.text.delta", "delta": "<文本片段>" }
// 情绪
{ "type": "emotion", "emotion": "happy" }   // 具体事件名以实测为准
// function_call（BR-02 的 extractFunctionCall 兼容三形态）
{ "type": "conversation.item.created", "item": { "type": "function_call", "name": "hermes_brain", "arguments": "{}", "call_id": "..." } }
```

> ⚠️ 事件类型以官方文档 + 实测为准：`https://help.aliyun.com/zh/model-studio/qwen-audio-realtime-websocket-api`。实现时先抓包确认实际事件名。

## 5. 实现要点

1. **依赖最小化**（红线 5）：优先用 Node 22 原生 `WebSocket`（全局可用，零依赖）；如浏览器侧需要再考虑 `ws` 包
2. **连接管理**：断线重连（指数退避）、心跳、超时清理
3. **音频缓冲**：上行按帧切块发送；下行累积完整块后回调（防卡顿）
4. **事件分发**：统一 message handler → 按 type 分发到各回调（onAudio/onSubtitle/onEmotion/onFunctionCall）
5. **注入 Hermes 结果**：`injectAssistantText(text)` → 发送文本输入事件让 Qwen 朗读
6. **打断**：`interrupt()` → 发送打断事件（或关闭当前 response）

## 6. 验收标准（自检）

| # | 验收点 | 自检方法 |
|---|--------|----------|
| 1 | WS 连接成功 | 用已配置 Key 连接，`session.created` 返回 session_id |
| 2 | 人设注入 | `session.update` 后收到 `session.updated` |
| 3 | 音频上行 | `sendAudio` 发送 PCM 16k 数据无报错 |
| 4 | 事件回调 | 触发一次文本对话，能收到 subtitle 事件 |
| 5 | 断线重连 | 断开后自动重连（模拟网络中断） |
| 6 | 环境可跑 | 可执行 `node --experimental-strip-types` 试跑连接（参考 TASKS-CONFIG §0 环境说明） |

## 7. 边界与红线

- ✅ 只做 `voice-shell/qwen-audio-client.ts`（+ provider.ts 类型），不写 gateway（VS-02）
- ✅ 不碰 function_call 执行逻辑（那是 BR-02），只负责把事件透传给回调
- ✅ 无状态、无持久化（红线 1）；Key 走 config（红线 8）
- ✅ 依赖最小化：优先 Node 原生 WebSocket（红线 5）
- ⚠️ 语音壳不碰业务（红线 6）：instructions 只装人设，调度在 function-router

---

*VS-01 任务规格 v1.0 · 2026-08-09 · 连接实测通过（session_id + session.update）*

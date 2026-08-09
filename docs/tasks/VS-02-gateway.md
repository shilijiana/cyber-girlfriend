# VS-02 · 语音网关 gateway.ts（任务规格）

> **任务编号**：VS-02（voice-shell 模块，P0）
> **目标文件**：`voice-shell/gateway.ts`
> **依赖**：VS-01 ✅（qwen-audio-client.ts）
> **配套**：`docs/TASKS-CONFIG.md` §VS 模块、`docs/architecture/module-contracts.md` §2.2
> 更新日期：2026-08-09

---

## 1. 任务目标

实现语音网关 `gateway.ts`：把**浏览器（客户端 WS）**与**Qwen-Audio（服务端 WS）**之间的音频流双向中继，是"语音壳"的桥梁层。

```
浏览器 ──WS(/ws/voice)──▶ gateway.ts ◀──WS(服务端 realtime)── Qwen-Audio
   上行 PCM 16kHz  ▶──────中继──────▶ 上行 PCM 16kHz
   下行 PCM 24kHz  ◀──────中继──────◀ 下行 PCM 24kHz
```

## 2. 职责边界

**做**：
- 接收浏览器 `/ws/voice` 连接（AP-05 挂载点，gateway 提供处理逻辑）
- 浏览器上行音频 → 转发给 Qwen-Audio（`session.sendAudio`）
- Qwen-Audio 下行音频 → 转发给浏览器
- 副文本/情绪/function_call 事件 → 转发给对应消费者（字幕/数字人/BR-02）

**不做**：
- 不写 WS Server 挂载逻辑（那是 AP-05 `app/server` 的活）
- 不直接调用 Hermes（那是 BR-02 function-router 的活）
- 不做业务判断（红线 6：语音壳不碰业务）

## 3. 接口设计（建议）

```ts
// voice-shell/gateway.ts
export interface VoiceGatewayDeps {
  provider: VoiceProvider;            // VS-01 的 VoiceProvider
  onSubtitle?: (text: string) => void;
  onEmotion?: (e: Emotion) => void;
  onFunctionCall?: (call: FunctionCall) => void;  // → BR-02
}

export interface VoiceGateway {
  /** 浏览器 WS 连入时调用，建立中继 */
  handleConnection(browserWs: WebSocket, personaInstructions: string): Promise<void>;
}

export function createVoiceGateway(deps: VoiceGatewayDeps): VoiceGateway;
```

## 4. 消息协议（浏览器 ↔ 网关）

**浏览器 → 网关**：
```jsonc
{ "type": "audio", "data": "<base64 PCM16k>" }        // 上行音频
{ "type": "interrupt" }                                // 打断
{ "type": "close" }                                    // 结束
```

**网关 → 浏览器**：
```jsonc
{ "type": "audio", "data": "<base64 PCM24k>" }        // 下行 AI 语音
{ "type": "subtitle", "text": "..." }                 // 字幕
{ "type": "emotion", "emotion": "happy" }             // 情绪
{ "type": "status", "state": "connected|speaking|idle" }
```

## 5. 实现要点

1. **双向转发**：浏览器 WS 与 Qwen session 之间建双向管道，各自 onmessage 转发
2. **状态管理**：connected / speaking / idle 三态；AI 说话时不再转上行（或按打断规则）
3. **缓冲策略**：下行音频按帧转发，避免积压卡顿；上行按浏览器到达速率直通
4. **生命周期**：浏览器断开 → 关闭 Qwen session；会话结束清理
5. **错误处理**：任一侧 WS 异常 → 通知另一侧并清理资源
6. **依赖最小化**（红线 5）：`ws` 包（浏览器端 WS 服务）+ VS-01 客户端，不引第三方

## 6. 验收标准（自检）

| # | 验收点 | 自检方法 |
|---|--------|----------|
| 1 | 中继连通 | 浏览器 WS 连入 → Qwen session 建立（session.created） |
| 2 | 上行转发 | 发模拟 PCM16k → Qwen 收到（无报错） |
| 3 | 下行转发 | Qwen 回复 → 浏览器收到 PCM24k 音频事件 |
| 4 | 事件透传 | 触发文本回复 → subtitle 事件到达 onSubtitle |
| 5 | 断开清理 | 浏览器断开 → Qwen session.close()，无残留进程 |
| 6 | 环境可跑 | 可 `node --experimental-strip-types` 试跑（参考 TASKS-CONFIG §0） |

## 7. 边界与红线

- ✅ 只做 `voice-shell/gateway.ts`；WS Server 挂载归 AP-05
- ✅ 无状态、无持久化（红线 1）；Key 走 config（红线 8）
- ✅ 依赖最小化（红线 5）；语音壳不碰业务（红线 6）
- ⚠️ function_call 事件透传给 BR-02 回调即可，不在此执行

---

*VS-02 网关规格 v1.0 · 2026-08-09 · 依赖 VS-01 交付后执行*

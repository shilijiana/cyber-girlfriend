# voice-shell · 语音壳 🎙️

**职责**：赛博女友的"嘴和耳朵"——所有语音进出都在这。

## 核心功能

| 文件 | 说明 |
|------|------|
| `provider.ts` | VoiceProvider / VoiceSession 契约定义（对齐 module-contracts §2.2，VS-01） |
| `qwen-audio-client.ts` | Qwen-Audio-3.0-Realtime-Flash WebSocket 客户端（会话管理、instructions 注入、事件转发、断线重连；VS-01 已交付，实测 7/7 通过） |
| `gateway.ts` | `/ws/voice` 中继：浏览器 ↔ Qwen 双向音频流 + 双路分发（播放/字幕/数字人触发） |
| `smoke-test.ts` | VS-01 验收脚本：`node --experimental-strip-types voice-shell/smoke-test.ts`（真实调用，消耗 API 额度） |

## 关键约束

- 人设只通过 `instructions` 注入（由 persona 模块提供），**本模块不做业务调度**
- 简单对话由 Qwen 直接答（<1s），复杂任务触发 `function_call` → 交给 brain 模块
- 支持打断（barge-in）、VAD（server_vad）、输入转写（qwen3-asr-flash-realtime）、语音+文字双输出

## 供应商抽象

当前实现：Qwen-Audio-3.0-Realtime-Flash（阿里 DashScope）。
预留：Seeduplex（字节，邀测中）、Qwen3-Omni 自托管（本地化场景）——通过统一接口替换。

## 接入

```bash
VOICE_PROVIDER=qwen_audio   # .env
DASHSCOPE_API_KEY=xxx
```

## 相关

- 调研依据：`docs/research/Qwen-Audio-3.0-Realtime-调研报告.md`、`docs/research/豆包Seeduplex-调研报告.md`
- 架构总纲：`docs/architecture/overall-architecture.md`

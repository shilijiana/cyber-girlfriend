# 模块接口契约（Module Contracts）

> **文档定位**：赛博女友各任务模块之间的**开发契约**——定义每个模块暴露的接口、依赖的接口、消息格式与协议，确保各模块并行开发互不冲突。
> **文档日期**：2026-08-09 · 版本 v1.1
> **配套**：`docs/architecture/overall-architecture.md`（架构总纲）、`docs/adr/`（决策记录）
> **v1.1 变更**（老板 2026-08-09）：**删除 MemoryStore 与 Db 接口**——赛博女友无记忆、无数据库，事务与记忆由 Hermes 负责。

---

## 1. 契约总览

```
client/  ──WS──▶  app/server（Core Orchestrator）  ──调用──▶  voice-shell / brain / persona / avatar
```

| 模块 | 对外暴露 | 依赖他人 |
|------|----------|----------|
| client | WS/REST 消费方 | app/server 全部接口 |
| app/server | REST API + WS + SSE | voice-shell / brain / persona / avatar |
| voice-shell | `VoiceProvider` 接口 | persona（instructions 组装） |
| brain | `BrainRunner` 接口 | 无（本机 Hermes） |
| persona | `PersonaBuilder` 接口 | 无 |
| avatar | `ClipMatcher` 接口 | assets（素材） |

**依赖方向规则**：箭头只从上层指向下层，**禁止反向依赖与循环依赖**。各模块只通过接口交互，内部实现可自由替换。

**无持久化契约**：本系统**不定义任何数据存储接口**（无 Db、无 MemoryStore）——事务与记忆由 Hermes 负责（Hermes 自带记忆系统），赛博女友是纯交互界面。

---

## 2. 接口定义

### 2.1 client ↔ app/server（网络契约）

**REST API**

| 方法 | 路径 | 请求 | 响应 | 说明 |
|------|------|------|------|------|
| GET | /api/health | - | `{status:"ok"}` | 健康检查 |
| POST | /api/chat | `{message}` | `{reply}` | 文本聊天（调试/降级） |
| GET | /api/brain/status | - | `{available, version}` | Hermes 可用性 |
| GET | /api/avatar/status | - | `{engine, clipCount}` | 数字人引擎状态 |

**WebSocket `/ws/voice`**（语音主链路，JSON 控制 + 二进制音频）

```ts
// 客户端 → 服务端
{ type: 'start' }                          // 开启语音会话
{ type: 'audio', data: ArrayBuffer }       // 上行 PCM 16kHz 16bit
{ type: 'interrupt' }                      // 打断

// 服务端 → 客户端
{ type: 'ready', config: { sampleRate: 24000 } }
{ type: 'audio', data: ArrayBuffer }       // 下行 PCM 24kHz 16bit
{ type: 'subtitle', text: string }         // 字幕副文本
{ type: 'emotion', emotion: 'happy' }      // 情绪事件（驱动数字人）
{ type: 'brain', status: 'working' | 'done', result?: string }  // Hermes 工作状态
{ type: 'error', message: string }
```

### 2.2 app/server → voice-shell（VoiceProvider）

```ts
// voice-shell/provider.ts
export interface VoiceSession {
  sendAudio(chunk: Buffer): void;                 // 上行用户音频
  onAudio(cb: (chunk: Buffer) => void): void;     // 下行 AI 语音
  onSubtitle(cb: (text: string) => void): void;   // 字幕
  onEmotion(cb: (e: Emotion) => void): void;      // 情绪
  onFunctionCall(cb: (call: FunctionCall) => void): void; // Hermes 触发
  injectAssistantText(text: string): void;        // 注入 Hermes 结果朗读
  interrupt(): void;
  close(): Promise<void>;
}
export interface VoiceProvider {
  connect(sessionId: string, personaInstructions: string): Promise<VoiceSession>;
}
```

**实现**：`qwen-audio-client.ts`（Qwen-Audio-3.0-Realtime-Flash，默认）
**预留**：SeeduplexProvider / Qwen3OmniProvider（按 ADR-001 可替换）

### 2.3 app/server → brain（BrainRunner）

```ts
// brain/runner.ts
export interface BrainRunner {
  /** 执行一次任务，返回结果文本；超时/失败抛错 */
  run(task: BrainTask): Promise<BrainResult>;
}
export interface BrainTask {
  instruction: string;      // 纯文本任务描述（Qwen function_call 的入参）
  context?: string;         // 可选：对话上下文摘要
  timeoutMs?: number;       // 默认 120_000
}
export interface BrainResult {
  ok: boolean;
  output: string;           // Hermes stdout 纯文本
  durationMs: number;
  error?: string;
}
```

**实现**：`hermes-runner.ts`（子进程 `hermes -z`）
**预留**：`hermes mcp serve` 常驻模式（复杂多轮场景）
**记忆说明**：任务的记忆/状态由 Hermes 自身管理，本接口只做一次性执行与结果返回。

### 2.4 app/server → persona（PersonaProvider）

> **v1.2 变更**：人设由 Hermes 统一维护，赛博女友只保留接口定义、切换方式和加载抽象。不再本地存储角色卡文件。

```ts
// persona/provider.ts
export interface PersonaProvider {
  /** 获取可用人设列表 */
  listPersonas(): Promise<PersonaInfo[]>;
  /** 加载指定人设（含 Hermes 预组装的 instructions） */
  getPersona(id: string): Promise<Persona>;
  /** 人设 → Qwen instructions 文本（Hermes 已预组装，此处只做透传/格式化） */
  buildInstructions(persona: Persona): string;
  /** 切换当前活跃人设 */
  switchPersona(id: string): Promise<void>;
}

export interface PersonaInfo {
  id: string;
  name: string;
  description: string;
}

export interface Persona {
  id: string;
  name: string;
  instructions: string;              // Hermes 预组装好的 instructions 文本
  voiceConfig?: {
    voiceId?: string;                // Qwen-Audio 音色 ID
    emotion?: string;                // 默认情绪
  };
  postHistoryInstructions?: string;  // 对话后指令（function_call 引导）
}
```

**实现**：`HermesPersonaProvider`（通过 `hermes -z` 子进程获取人设数据）
**预留**：`FilePersonaProvider`（读 Hermes 写的人设 JSON 文件）、`HttpPersonaProvider`（Hermes MCP serve 常驻模式）
**删除**：~~`character-silly.json`~~（角色卡数据归 Hermes）、~~`prompt-builder.ts` 组装逻辑~~（instructions 由 Hermes 预组装）

### 2.5 app/server → avatar（ClipMatcher）

```ts
// avatar/clip-matcher.ts（已实现，M1 预置）
export interface ClipMatcher {
  pickClip(emotion: Emotion, recentlyPlayed: string[]): Clip | null;
  buildQueue(targetDurationMs: number, emotion: Emotion): Clip[];
}
```

### 2.6 已删除接口（v1.1）

| 接口 | 删除原因 |
|------|----------|
| `MemoryStore`（memory/store.ts） | 记忆由 Hermes 负责，赛博女友不持有 |
| `Db`（data/db.ts） | 无本地数据库，零持久化 |
| `PersonaBuilder` + `CharacterCard` | v1.2：人设归 Hermes 维护，改为 `PersonaProvider` 抽象接口 |

---

## 3. 开发约束（各模块必须遵守）

1. **只依赖接口，不依赖实现**：模块间通过上述 TS 接口交互，禁止 import 其他模块内部文件
2. **文本中转不漂移**：voice-shell 与 brain 之间只传纯文本（任务描述 / 结果），不传音频、不传内部状态
3. **错误处理统一**：所有接口方法错误都 reject/抛错，由 app/server 编排层统一转成 WS `{type:'error'}` 或 HTTP 4xx/5xx
4. **零持久化**：任何模块**不得**新增本地存储（数据库/文件/缓存），需要持久化的能力一律走 Hermes
5. **无状态**：应用壳与各模块保持无状态，记忆/会话上下文由 Hermes 管理
6. **类型共享**：`Persona / Emotion / FunctionCall` 等公共类型格式必须一致（放各模块自持但保证兼容）
7. **新增接口需更新本文档**：任何模块新增对外能力，先改契约再实现，防止接口漂移
8. **配置集中管理**：所有 API 密钥与运行参数通过 `config/loader.ts` 统一加载，不散落在源码中

---

*模块契约 v1.2 · 2026-08-09 · 人设归 Hermes（PersonaProvider）+ 配置集中管理*

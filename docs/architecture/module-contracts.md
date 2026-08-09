# 模块接口契约（Module Contracts）

> **文档定位**：赛博女友各任务模块之间的**开发契约**——定义每个模块暴露的接口、依赖的接口、消息格式与协议，确保各模块并行开发互不冲突。
> **文档日期**：2026-08-09 · 版本 v1.4
> **配套**：`docs/architecture/overall-architecture.md`（架构总纲）、`docs/adr/`（决策记录）
> **v1.1 变更**（老板 2026-08-09）：**删除 MemoryStore 与 Db 接口**——赛博女友无记忆、无数据库，事务与记忆由 Hermes 负责。
> **v1.2 变更**（2026-08-09）：新增 §2.7 Core Orchestrator（AP-02 编排层）与 `/api/chat` 契约细化。
> **v1.3 变更**（2026-08-09）：**人设文件化落地**——PersonaProvider 实现改为 FilePersonaProvider（直读 `~/.hermes/personas/`），人设分区记忆 + 专用 profile `cyber-girlfriend`（详见 `docs/research/hermes-capabilities-review.md` §3.1）。
> **v1.4 变更**（2026-08-09）：新增 §2.8 FunctionRouter（BR-02）——Qwen Realtime function_call 中转契约，补齐 §2.2 引用的 `FunctionCall` 公共类型。

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
| POST | /api/chat | `{message, personaId?}` | `{reply, personaId, ok, durationMs}` | 文本聊天（调试/降级），走 Core Orchestrator（§2.7） |
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

> **v1.3 变更**：人设**文件化落地**——数据权威在 Hermes 侧 `~/.hermes/personas/`，由 Hermes 统一维护（红线 3 不破）。赛博女友 PersonaProvider 实现改为 **FilePersonaProvider**（fs.readFile 直读，毫秒级，不再走 LLM 临场编 JSON）。方案详见 `docs/research/hermes-capabilities-review.md` §3.1（老板 2026-08-09 拍板）。

```ts
// persona/provider.ts（接口不变，v1.2 契约）
export interface PersonaProvider {
  /** 获取可用人设列表 */
  listPersonas(): Promise<PersonaInfo[]>;
  /** 加载指定人设（直读 personas.json + card.md + memory.md 组装） */
  getPersona(id: string): Promise<Persona>;
  /** 人设 → Qwen instructions 文本（角色卡 + 记忆区拼接，纯文本） */
  buildInstructions(persona: Persona): string;
  /** 切换当前活跃人设（写 active.txt，毫秒级） */
  switchPersona(id: string): Promise<void>;
}

export interface PersonaInfo {
  id: string;
  name: string;
  description: string;
  cardFile?: string;    // v1.3：角色卡路径（相对 personas/）
  memoryFile?: string;  // v1.3：记忆区路径（相对 personas/）
  voiceId?: string;     // v1.3：Qwen-Audio 音色 ID
  emotion?: string;     // v1.3：默认情绪
}

export interface Persona {
  id: string;
  name: string;
  instructions: string;              // 角色卡 + 记忆区 + 收尾指令（FilePersonaProvider 组装）
  voiceConfig?: {
    voiceId?: string;                // Qwen-Audio 音色 ID
    emotion?: string;                // 默认情绪
  };
  postHistoryInstructions?: string;  // 对话后指令（function_call 引导）
}
```

**数据文件约定**（权威源，Hermes 维护，赛博女友只读）：

```
~/AppData/Local/hermes/profiles/cyber-girlfriend/
├── personas/
│   ├── personas.json      # 注册表（元数据：id/name/description/cardFile/memoryFile/voiceId/emotion）
│   ├── active.txt         # 当前活跃人设 id（仅一行）
│   ├── README.md          # 数据模型说明
│   ├── xiaodai/
│   │   ├── card.md        # 角色卡（静态：身份/性格/说话风格/世界观）
│   │   └── memory.md      # 记忆区（动态：该人设视角的对话记忆，LLM 维护）
│   └── .../（其他人设同构）
└── config.yaml / .env     # 专用 profile：model=deepseek-chat，无 MEM0_API_KEY（记忆双向隔离）
```

**实现**：`FilePersonaProvider`（fs.readFile 直读，替换原 HermesPersonaProvider 的 LLM 临场编 JSON 方式）
**删除**：~~`HermesPersonaProvider` 指令通道方案~~（LLM 临场编 JSON → 结果漂移 + 切换超时，已废弃）
**记忆隔离**：专用 profile `cyber-girlfriend`（无 MEM0 key、memories/ 空）→ 与主 profile / mem0 **双向隔离**（实测验证，见评估报告 §3.2）

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

### 2.7 app/server 内部编排层（Core Orchestrator，AP-02 新增）

> **v1.2 补充（AP-02）**：文本聊天链路的编排核心，把 persona（取 instructions）+ brain（执行）串成一条可验证的链路。仅存在于 app/server 内部，不对 client 暴露（client 只走 REST/WS）。

```ts
// app/server/orchestrator.ts
export interface ChatRequest {
  message: string;       // 用户文本消息（必填）
  personaId?: string;    // 可选：指定人设，缺省用当前活跃人设
}

export interface ChatResult {
  reply: string;         // 最终回复文本（Hermes 结果或降级提示）
  personaId: string;     // 实际使用的人设 id
  ok: boolean;           // 链路是否成功（brain 执行失败为 false）
  durationMs: number;    // 总耗时
  brain?: BrainResult;   // brain 原始结果（§2.3），失败时带 error
}

export interface SwitchResult {
  ok: boolean;
  persona?: PersonaInfo; // 切换成功时返回新活跃人设摘要
  error?: string;
}

export interface CoreOrchestrator {
  /** 文本聊天主流程：取人设 instructions → brain 执行 → 返回结果 */
  chat(req: ChatRequest): Promise<ChatResult>;
  /** 切换活跃人设（先校验存在性，仅内存状态，无持久化） */
  switchPersona(id: string): Promise<SwitchResult>;
  /** 当前活跃人设 id（初始为默认人设） */
  getActivePersonaId(): string;
}
```

**依赖注入**：`createOrchestrator({ personaProvider, brainRunner })` 只依赖 §2.3 `BrainRunner` 与 §2.4 `PersonaProvider` 抽象接口；PersonaProvider 的具体实现由装配处提供（当前为 app 内嵌 `DefaultPersonaProvider` 占位，PS-02 交付后替换，zero 代码改动）。

**错误处理**：brain 执行失败（超时/不可用）不抛错——`ChatResult.ok = false`，`reply` 为友好降级提示，由 REST 层转 HTTP 200（业务失败）而非 5xx（契约 §3.3 的上层统一转换）。

### 2.8 voice-shell ↔ brain（FunctionRouter，BR-02 新增）

> **v1.4 补充（BR-02）**：Qwen-Audio Realtime 的 Function Calling 中转器——拦截下行 `function_call`（OpenAI Realtime 兼容协议）→ 调 `BrainRunner`（§2.3）→ 构造上行 `function_call_output` 写回。位于 voice-shell（协议收发）与 brain（任务执行）之间，只做**文本中转**（红线 4 不漂移）。

```ts
// brain/function-router.ts
export const HERMES_TOOL_NAME = 'hermes_brain';   // 工具注册名（VS-06 注册用）

/** 归一化函数调用（协议无关，从 Qwen Realtime 事件提取） */
export interface FunctionCall {
  callId: string;                        // 回写时原样带回（call_id）
  name: string;                          // 工具名（如 hermes_brain）
  arguments: Record<string, unknown>;    // 已解析的参数对象
  rawArguments?: string;                 // 原始 arguments（JSON 解析失败时兜底为 instruction）
}

/** 函数调用输出（写回 Qwen 的内容） */
export interface FunctionCallOutput {
  callId: string;
  output: string;                        // JSON 文本：{ok, output, durationMs, error?}
  status: 'completed' | 'failed';        // failed = 参数非法 / runner 失败 / 未知工具
}

/** 中转器契约：拦截 → 调 runner → 写回 */
export interface FunctionRouter {
  handle(call: FunctionCall): Promise<FunctionCallOutput>;
}

/** 工具 schema（VS-06 注册到 Qwen session 用，小而严格，只传 instruction/context/timeoutMs） */
export const hermesBrainTool: object;

/** 从 Qwen Realtime 下行事件提取 function_call（非 function_call 事件返回 null） */
export function extractFunctionCall(event: unknown): FunctionCall | null;

/** 构造上行 function_call_output 事件（conversation.item.create） */
export function buildFunctionCallOutputEvent(out: FunctionCallOutput): unknown;
```

**事件协议**（Qwen-Audio-3.0-Realtime-Flash，OpenAI Realtime 兼容）：

```
Qwen 下行 →  { type: 'conversation.item.created', item: { type: 'function_call',
                name: 'hermes_brain', arguments: '{"instruction":"..."}', call_id: 'call_xxx' } }
                （也兼容 response.output_item.done / 顶层 function_call 形态）
客户端执行 →  extractFunctionCall(event) → router.handle(call)
客户端上行 →  { type: 'conversation.item.create', item: { type: 'function_call_output',
                call_id: 'call_xxx', output: '{"ok":true,"output":"...","durationMs":1234}' } }
                → 再发 { type: 'response.create' } 让模型组织语音回复
```

**错误语义**：router 不抛错——所有失败（未知工具 / 参数非法 / runner 超时失败）都以 `status:'failed'` 写回，output 含 `error` 描述，由 Qwen 转述为友好语音。`callId` 缺失时无法写回，返回 `status:'failed'` 且 `callId` 为空。

---

## 3. 开发约束（各模块必须遵守）

1. **只依赖接口，不依赖实现**：模块间通过上述 TS 接口交互，禁止 import 其他模块内部文件
2. **文本中转不漂移**：voice-shell 与 brain 之间只传纯文本（任务描述 / 结果），不传音频、不传内部状态
3. **错误处理统一**：所有接口方法错误都 reject/抛错，由 app/server 编排层统一转成 WS `{type:'error'}` 或 HTTP 4xx/5xx
4. **零持久化**：任何模块**不得**新增本地存储（数据库/文件/缓存），需要持久化的能力一律走 Hermes
5. **无状态**：应用壳与各模块保持无状态，记忆/会话上下文由 Hermes 管理
6. **类型共享**：`Persona / Emotion / FunctionCall` 等公共类型格式必须一致（放各模块自持但保证兼容）
7. **新增接口需更新本文档**：任何模块新增对外能力，先改契约再实现，防止接口漂移
8. **配置集中管理**：所有 API 密钥与运行参数通过 `config/loader.ts` 统一加载，不散落在源码中。加载优先级：`config/apikeys.json` > 系统环境变量 > `.env.local` > `.env` > 默认值（AP-06 支持根目录 `.env` / `.env.local`，模板见 `.env.example`，均 gitignore；系统环境变量优先，.env 不覆盖已存在的键）

---

*模块契约 v1.2 · 2026-08-09 · 人设归 Hermes（PersonaProvider）+ 配置集中管理（AP-06 补充 .env 支持）+ Core Orchestrator 编排层（AP-02）*

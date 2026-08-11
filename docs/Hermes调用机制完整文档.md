# 赛博女友 · Hermes 调用机制完整文档

> **版本**：v1.0 · 2026-08-11
> **定位**：完整记录赛博女友项目如何调用 Hermes 大脑，涵盖语音会话、文字聊天两条路径，以及降级、配置、安全隔离等全部细节。
> **适用读者**：架构维护者、模块开发者、测试人员

---

## 1. 概述

赛博女友是 AI 语音陪伴应用，架构为**双层大脑**：

| 层 | 角色 | 实现 |
|----|------|------|
| **语音壳** | 实时语音对话 + 情绪 + 数字人 | Qwen-Audio-3.0-Realtime-Flash（云端） |
| **事务大脑** | 查资料/算东西/读写文件/回顾记忆 | Hermes Agent（本机子进程） |

**核心原则**：Qwen 负责语音交互和情绪判断，Hermes 负责真正"办事"。两者通过 **Function Calling** 机制协作——Qwen 判断需要办事时，调用 `hermes_brain` 工具，赛博女友拦截该调用、启动 Hermes 子进程执行、把结果写回 Qwen，Qwen 再用语音说出来。

---

## 2. 两条调用路径

赛博女友有**两条路径**调用 Hermes，对应两种使用场景：

### 路径 A：语音会话（WS /ws/voice）

```
用户说话
  ↓
Qwen-Audio 实时转写 + 判断意图
  ↓
需要办事？→ 下发 function_call("hermes_brain", {instruction, context})
  ↓
function-calling.ts 拦截 → broadcastStatus('working')
  ↓                          （前端显示"小呆正在思考…"）
function-router.ts handle() → 解析参数 → 校验工具名
  ↓
hermes-runner.ts runHermes() → spawn 子进程
  ↓
hermes --profile cyber-girlfriend -z "任务" -t terminal,file,web
  ↓                                    （记忆隔离 + 工具白名单）
Hermes 执行（6~40s）→ stdout 纯文本结果
  ↓
function-router 构造 FunctionCallOutput（JSON: {ok, output, durationMs}）
  ↓
session.sendFunctionCallOutput(out) → 写回 Qwen + response.create
  ↓
Qwen 基于 Hermes 结果 → 语音 + 字幕"说出"回答
  ↓
broadcastStatus('done') （前端恢复正常）
```

**特点**：
- Qwen 决定何时调 Hermes（通过 function_call）
- Hermes 结果由 Qwen"翻译"成自然语音说出来
- 调用前 Qwen 会先说一句即时应答（"好的，我看看"），填充等待时间

### 路径 B：文字聊天（REST /api/chat）

```
用户发文字消息
  ↓
POST /api/chat {message, personaId}
  ↓
orchestrator.chat()
  ↓
① 取人设 → buildInstructions(persona) → 人设指令文本
  ↓
② brainRunner.run({instruction: 用户消息, context: 人设指令})
  ↓
hermes-runner.ts runHermes() → spawn 子进程（同路径 A）
  ↓
hermes --profile cyber-girlfriend -z "消息\n\n[上下文] 人设指令" -t terminal,file,web
  ↓
Hermes 执行 → stdout 纯文本
  ↓
③ Hermes 成功？→ 返回 {reply, ok:true}
   Hermes 失败？→ 降级 qwen-fallback（见 §5）
  ↓
HTTP 200 {reply, personaId, ok, durationMs, degraded?}
```

**特点**：
- 所有文字消息都走 Hermes（不经过 Qwen-Audio）
- 人设指令作为 context 传入 Hermes
- Hermes 失败自动降级纯 Qwen 文本对话

---

## 3. 核心模块与代码文件

### 3.1 文件清单

| 文件 | 职责 | 行数 |
|------|------|------|
| `brain/hermes-runner.ts` | Hermes 子进程调用器（BR-01） | ~150 |
| `brain/function-router.ts` | Function Calling 中转器（BR-02） | ~210 |
| `brain/qwen-fallback.ts` | Hermes 不可用时的降级通道（M5-02） | ~90 |
| `voice-shell/function-calling.ts` | FC 装配层，串联 Qwen ↔ Hermes（VS-06） | ~130 |
| `voice-shell/qwen-audio-client.ts` | Qwen-Audio WS 客户端，注册工具+提取 function_call | ~510 |
| `voice-shell/gateway.ts` | 语音网关，事件分发 | ~240 |
| `voice-shell/dispatcher.ts` | 双路分发器（浏览器 + deps） | ~130 |
| `app/server/orchestrator.ts` | 文字聊天编排层 | ~170 |
| `app/server/ws.ts` | WS 挂载，FC 装配接线 | ~100 |
| `app/server/index.ts` | 服务装配 + 冷启动预热 | ~140 |
| `config/loader.ts` | 配置加载（binPath/profile/toolsets） | ~150 |

### 3.2 模块关系图

```
┌─────────────────────────────────────────────────────────────┐
│                         前端浏览器                            │
│  AvatarCanvas / CaptionBar / ChatUI / VoiceWaveform         │
└──────┬──────────────────────────────────┬───────────────────┘
       │ WS /ws/voice（语音）              │ REST /api/chat（文字）
       ↓                                  ↓
┌──────────────────┐              ┌──────────────────┐
│  voice-shell     │              │  app/server      │
│  gateway         │              │  orchestrator    │
│  dispatcher      │              │                  │
│  function-calling│              │  brainRunner.run │
│  qwen-audio-cli  │              │                  │
└────┬──────┬──────┘              └────────┬─────────┘
     │      │                              │
     │      │ function_call                │ instruction
     │      ↓                              ↓
     │  ┌────────────────┐    ┌──────────────────┐
     │  │ function-router│    │ hermes-runner    │
     │  │ (BR-02)        │───→│ (BR-01)          │
     │  │ handle()       │    │ runHermes()      │
     │  └────────────────┘    │ spawn 子进程     │
     │                        └────────┬─────────┘
     │                                 │
     │    ┌────────────────────────────┐
     │    │  Hermes Agent 子进程        │
     │    │  hermes --profile cyber-   │
     │    │  girlfriend -z "任务"      │
     │    │  -t terminal,file,web      │
     │    │                            │
     │    │  DeepSeek LLM 推理         │
     │    │  工具执行（终端/文件/网络） │
     │    │  记忆系统（mem0）           │
     │    └────────────────────────────┘
     │
     │  Hermes 失败时降级
     └──→ qwen-fallback（DashScope qwen-plus 文本模型）
```

---

## 4. 路径 A 详解：语音会话调用 Hermes

### 4.1 工具注册（会话建立时）

**文件**：`voice-shell/qwen-audio-client.ts` + `voice-shell/function-calling.ts`

WS 连接建立后，`session.update` 携带工具 schema 注册到 Qwen：

```json
{
  "type": "session.update",
  "session": {
    "tools": [{
      "type": "function",
      "name": "hermes_brain",
      "description": "执行具体事务…【重要】调用前先用一句话简短回应用户…",
      "parameters": {
        "type": "object",
        "properties": {
          "instruction": { "type": "string", "description": "任务描述（必填）" },
          "context": { "type": "string", "description": "可选：上下文" },
          "timeoutMs": { "type": "number", "description": "可选：超时" }
        },
        "required": ["instruction"]
      }
    }],
    "tool_choice": "auto"
  }
}
```

> **即时应答机制**：工具 description 中包含"调用前先用一句话简短回应用户"的提示，Qwen-Audio 会在下发 function_call 前先说一句"好的，我看看"等即时反馈，填充 Hermes 执行期间的沉默。

### 4.2 function_call 提取（Qwen 下发时）

**文件**：`brain/function-router.ts` → `extractFunctionCall()`

Qwen-Audio 决定调用 `hermes_brain` 后，下发 function_call 事件。`extractFunctionCall()` 兼容三种事件形态：

| 形态 | 事件结构 |
|------|----------|
| ① | `{type:'conversation.item.created', item:{type:'function_call', name, arguments, call_id}}` |
| ② | `{type:'response.output_item.done', item:{type:'function_call', ...}}` |
| ③ | `{type:'function_call', name, arguments, call_id}`（顶层直接下发） |

提取后归一化为：
```ts
interface FunctionCall {
  callId: string;          // 回写时原样带回
  name: string;            // 工具名（须为 'hermes_brain'）
  arguments: Record<string, unknown>;  // 已解析的参数对象
  rawArguments?: string;   // 原始 JSON 文本（解析失败兜底）
}
```

### 4.3 拦截与执行（function-calling.ts）

**文件**：`voice-shell/function-calling.ts` → `onFunctionCall()`

```
拦截 function_call
  ↓
① broadcastStatus('working') → 前端显示"小呆正在思考…"
  ↓
② router.handle(call) → 调 Hermes（异步，不阻塞）
  ↓
③ Hermes 完成 → session.sendFunctionCallOutput(out)
   发送 function_call_output + response.create → Qwen 语音回复
  ↓
④ broadcastStatus('done'/'failed') → 前端恢复
```

**关键设计**：
- `router.handle()` 不抛错——所有失败都以 `status:'failed'` 写回
- 防御性 `.catch()` 兜底——即使 router 异常也构造 failed 写回，防会话卡死

### 4.4 中转与校验（function-router.ts）

**文件**：`brain/function-router.ts` → `HermesFunctionRouter.handle()`

```
handle(call)
  ↓
① 校验工具名：call.name !== 'hermes_brain' → fail("未知工具")
  ↓
② 解析参数 → BrainTask：
   instruction（必填，空则用 rawArguments 兜底，仍空则 fail）
   context（可选）
   timeoutMs（可选，下限 5s，上限 120s）
  ↓
③ runner.run(task) → 调 hermes-runner
  ↓
④ 构造 FunctionCallOutput：
   { callId, status:'completed'/'failed', output: JSON.stringify(BrainResult) }
```

### 4.5 子进程调用（hermes-runner.ts）

**文件**：`brain/hermes-runner.ts` → `runHermes()`

**命令组装**：
```bash
hermes --profile cyber-girlfriend -z "任务描述\n\n[上下文] 人设指令" -t terminal,file,web
```

| 参数 | 值 | 作用 |
|------|-----|------|
| `--profile` | `cyber-girlfriend` | 专用 profile，记忆与主 profile 隔离 |
| `-z` | `"任务文本"` | one-shot 模式，执行后退出 |
| `-t` | `terminal,file,web` | 工具白名单，只允许这三类工具 |

**执行保护**：

| 保护项 | 实现 |
|--------|------|
| 超时 | 默认 120s，到点 `taskkill /T /F` 杀进程树（Windows） |
| 输出上限 | stdout/stderr 各 1MB（H5：互不挤占） |
| 并发限制 | 串行队列，一次最多 1 个子进程（L13） |
| 超时下限 | timeoutMs < 1s 兜底为 1s（L12） |
| 错误判定 | 退出码 ≠ 0 或 stderr 匹配 `^(error:\|traceback\|unhandled exception)` |
| 进程清理 | Windows 用 taskkill 杀进程树，其他平台 SIGKILL |

**结果**：
```ts
interface BrainResult {
  ok: boolean;          // 成功/失败
  output: string;       // Hermes stdout 纯文本
  durationMs: number;   // 执行耗时
  error?: string;       // 失败原因
}
```

### 4.6 结果写回 Qwen

**文件**：`voice-shell/qwen-audio-client.ts` → `sendFunctionCallOutput()`

```ts
sendFunctionCallOutput(out: FunctionCallOutput): void {
  // ① 写回 function_call_output（Hermes 结果）
  this.sendJson({
    type: 'conversation.item.create',
    item: {
      type: 'function_call_output',
      call_id: out.callId,
      output: out.output,  // JSON: {ok, output, durationMs}
    },
  });
  // ② 触发 Qwen 生成回复
  this.sendJson({ type: 'response.create', response: { modalities: ['audio', 'text'] } });
}
```

Qwen 收到 function_call_output 后，基于 Hermes 的结果文本生成自然语音回复（带人设语气），同时下发字幕和情绪事件。

---

## 5. 路径 B 详解：文字聊天调用 Hermes

### 5.1 编排流程（orchestrator.ts）

**文件**：`app/server/orchestrator.ts` → `chat()`

```
POST /api/chat {message, personaId}
  ↓
① 并发保护：串行队列（一次一个 chat）
② 超时保护：Promise.race（总超时，防永久挂起）
  ↓
doChat():
  ① getPersona(personaId) → 取人设（角色卡 + 记忆）
  ② buildInstructions(persona) → 人设指令文本
  ③ brainRunner.run({instruction: message, context: instructions, timeoutMs: 60s})
  ↓
Hermes 成功 → {reply: result.output, ok: true}
Hermes 失败 → 降级 qwen-fallback（§5.2）
  ↓
HTTP 200 {reply, personaId, ok, durationMs, degraded?, brain?}
```

**与路径 A 的区别**：
- 文字聊天**不走 Qwen-Audio WS**，直接调 hermes-runner
- 人设指令作为 `context` 参数传入（路径 A 由 Qwen-Audio 的 instructions 注入）
- 文字聊天的超时是 60s（路径 A 是 120s，因为语音场景容忍更长等待）

### 5.2 降级机制（qwen-fallback.ts）

**文件**：`brain/qwen-fallback.ts`

当 Hermes 不可用（子进程启动失败/超时/执行出错）时，自动降级到纯 Qwen 文本对话：

```
Hermes 失败
  ↓
fallbackRunner.run({instruction: message, context: instructions})
  ↓
POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
Header: Authorization: Bearer <DASHSCOPE_API_KEY>
Body: {
  model: 'qwen-plus',
  messages: [
    {role: 'system', content: 人设指令},
    {role: 'user', content: 用户消息}
  ]
}
  ↓
Qwen 文本回复（无人设记忆、无事务能力，但能保持角色语气）
  ↓
返回 {reply, ok: true, degraded: true}
```

**降级特点**：
- 接口同构：实现与 hermes-runner 完全一致的 `BrainRunner` 契约
- 零依赖：Node 22 全局 fetch + AbortController，无第三方
- 不抛错：所有失败返回 `ok:false`，由 orchestrator 决定最终文案
- 双重失败（Hermes + Qwen 都挂）→ 返回友好提示"大脑开小差了"

> **注意**：降级只在**路径 B（文字聊天）**中生效。路径 A（语音会话）中 Hermes 失败时，function-router 以 `status:'failed'` 写回 Qwen，Qwen 会基于失败信息自行组织回复。

---

## 6. 冷启动预热

**文件**：`app/server/index.ts` → `prewarmHermes()`

后端启动时自动触发一次 Hermes 预热调用（fire-and-forget），让系统级缓存（Python 模块加载/依赖导入）提前完成：

```ts
// server.listen 回调中
void prewarmHermes();

async function prewarmHermes(): Promise<void> {
  const instructions = await resolveInstructions();  // 走完整链路
  const r = await brainRunner.run({
    instruction: '你好，这是一次启动预热测试…',
    context: instructions,
    timeoutMs: 90_000,
  });
  // 失败静默（Hermes 不可用自动降级，不影响服务）
}
```

**效果**：
- 预热前首次对话：20~39s（含 Python 冷启动）
- 预热后首次对话：~11s（省去模块加载缓存）
- 预热本身耗时：~8.5s（后台执行，不阻塞服务启动）

---

## 7. 配置项

**文件**：`config/apikeys.json` → `hermes` 段

```json
{
  "hermes": {
    "binPath": "C:/Users/.../hermes",
    "modelProvider": "deepseek",
    "apiKey": "",
    "baseUrl": "",
    "profile": "cyber-girlfriend",
    "personasDir": "C:/Users/.../personas",
    "toolsets": "terminal,file,web"
  }
}
```

| 配置项 | 说明 | 默认/兜底 |
|--------|------|-----------|
| `binPath` | Hermes 可执行文件路径 | `process.env.HERMES_BIN` ?? `'hermes'` |
| `modelProvider` | LLM 供应商 | `deepseek` |
| `apiKey` | Hermes 的 LLM Key（空则走 profile/.env） | `process.env.DEEPSEEK_API_KEY` |
| `profile` | 专用 profile 名（记忆隔离） | `cyber-girlfriend` |
| `personasDir` | 人设文件目录 | Hermes profile 下的 personas/ |
| `toolsets` | 工具白名单 | `terminal,file,web` |

> **密钥安全（红线 8）**：apiKey 在 config/apikeys.json（gitignore），apiKey.example.json 入库；loader.ts 文件优先、环境变量兜底，不硬编码。

---

## 8. 安全与隔离

### 8.1 记忆隔离（红线 10）

| 层 | 机制 |
|----|------|
| Profile 隔离 | 专用 profile `cyber-girlfriend`，与主 profile 互不干扰 |
| MEM0 隔离 | 专用 profile 无 MEM0 key + memories/ 为空 |
| 工具白名单 | `-t terminal,file,web`，只允许这三类工具（堵免审批风险） |

### 8.2 文本中转不漂移（红线 4）

- Qwen ↔ Hermes 之间**只传纯文本**
- instruction（任务描述）和 output（执行结果）都是 string
- 不传结构化对象、不传音频、不传图片

### 8.3 无持久化（红线 1）

- 赛博女友侧零持久化：每次 Hermes 调用独立，不落盘、不缓存
- 记忆/事务状态全归 Hermes 自身管理

### 8.4 语音壳不碰业务（红线 6）

- voice-shell 只透传 function_call，不执行
- 执行归 BR-02 function-router → BR-01 hermes-runner
- gateway/dispatcher 只做事件分发

### 8.5 路径安全

- hermes-runner 对 instruction 做纯文本传递（不做命令拼接，防注入）
- function-router 校验工具名（只处理 `hermes_brain`，未知工具 fail）
- 参数校验（instruction 必填、timeoutMs 范围限制）

---

## 9. 关键设计决策

| 决策 | 理由 |
|------|------|
| **one-shot 模式**（`hermes -z`）而非常驻 | 简单可靠；ACP 常驻方案已评估但 Windows 稳定性待验证（ADR-007/008） |
| **串行队列**（一次一个子进程） | 冷启动 12~23s，并发 spawn 互相拖慢；串行更可控 |
| **function_call 只透传不执行** | 红线 6：语音壳不碰业务，执行归 brain 层 |
| **BrainRunner 契约接口** | hermes-runner 和 qwen-fallback 实现同一接口，orchestrator 无缝切换 |
| **失败不抛错** | 所有层都不向上抛——超时/失败都以结构化结果返回，保证会话不卡死 |
| **即时应答用工具描述** | 改 description 字符串让 Qwen 自然先说一句，零代码逻辑改动（2026-08-11 验证通过） |
| **预热走完整链路** | 不只预热 brain，还走 persona instructions，预热效果等同真实请求 |

---

## 10. 性能数据（2026-08-11 实测）

| 场景 | 耗时 | 说明 |
|------|------|------|
| Hermes 冷启动（首次） | 12~23s | Python 启动 + 模块加载 + DeepSeek 客户端初始化 |
| Hermes 热调用（预热后） | 7~11s | 省去模块加载缓存，仍有进程启动 + LLM 推理 |
| 简单问答（1+1=?） | ~2s | Hermes -z 直接返回 |
| 复杂事务（查资料/算东西） | 6~40s | 取决于事务复杂度 |
| Qwen 降级（qwen-plus） | 2~5s | 纯文本对话，无事务能力 |
| 预热耗时 | ~8.5s | 后台执行，不阻塞服务 |

**已知瓶颈**：one-shot 模式每次 spawn 新进程，冷热差异不大。ACP 常驻方案预计可降到 2~5s（待 Windows 稳定性验证后启用）。

---

## 11. 调试与排查

### 11.1 日志关键字

| 日志 | 来源 | 含义 |
|------|------|------|
| `[fc] 拦截 function_call → 调 Hermes` | function-calling.ts | 语音路径拦截到工具调用 |
| `[fc] Hermes 执行完成，写回 Qwen` | function-calling.ts | Hermes 完成，结果已写回 |
| `[fc] brain 状态：working/done/failed` | function-calling.ts | brain 状态变化 |
| `[app] Hermes 预热完成（XXXms）` | index.ts | 启动预热完成 |
| `Hermes 任务超时` | hermes-runner.ts | 子进程超时被杀 |

### 11.2 手动测试 Hermes

```bash
# 简单问答
hermes -z "1+1=?"

# 指定 profile + 工具白名单（与赛博女友一致）
hermes --profile cyber-girlfriend -z "今天几号？" -t terminal,file,web

# 测速
time hermes --profile cyber-girlfriend -z "回答：你好" -t terminal,file,web
```

### 11.3 常见问题

| 问题 | 排查方向 |
|------|----------|
| 语音对话无 Hermes 回复 | 检查 Qwen 是否下发了 function_call（看后端日志 `[fc]` 行） |
| 文字聊天超时 | 检查 Hermes binPath 是否存在、DeepSeek key 是否有效 |
| 人设没生效 | 检查 personasDir 路径、profile 是否正确（CC-04 路径校验 bug） |
| Hermes 每次都很慢 | one-shot 模式固有成本；预热已缓解，ACP 常驻是治本方案 |

---

## 12. 相关文档索引

| 文档 | 路径 |
|------|------|
| 架构总纲 | `docs/architecture/overall-architecture.md` |
| 模块契约 | `docs/architecture/module-contracts.md` |
| Hermes 能力评估 | `docs/research/hermes-capabilities-review.md` |
| 架构决策记录 | `docs/adr/README.md` |
| CC-01 代码审查报告 | `docs/reviews/code-review-2026-08-11.md` |

---

*Hermes 调用机制文档 v1.0 · 2026-08-11 · 赛博女友项目*

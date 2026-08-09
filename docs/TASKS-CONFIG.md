# 赛博女友 · 模块任务配置（TASKS-CONFIG）

> **新聊天框唯一入口**：只读这一个文件，即可明确所有任务并开始执行。
> 项目根目录：`D:/其他资料/赛博女友` · 更新日期：2026-08-09 · 版本 v1.0

---

## 0. 使用说明（新聊天框必读）

**怎么用：只需说"执行模块 X"（如"执行模块 BR"），即可按本文件自动读取该模块的定义并执行，无需翻阅其他文档。**

### 执行流程（自动）

```
你说："执行模块 BR-01"
  │
  ▼
① 读本文件 §4 中「模块 BR · brain」的定义
② 按「执行入口」定位代码文件
③ 按「输入参数」确认入参
④ 对照「预期输出」与「验收标准」实现
⑤ 完成后更新 docs/TASKS.md 状态 → ✅ DONE
⑥ 在 docs/DEVLOG.md 最上方追加记录
⑦ 汇报：产出文件 + 验收满足情况 + 遗留问题（200 字内）
```

### 红线速查（必须遵守）

| # | 红线 |
|---|------|
| 1 | 🚫 无数据库、无持久化、无本地记忆（事务/记忆归 Hermes） |
| 2 | 🚫 不在本模块外写代码，只做指派模块 |
| 3 | 🔧 密钥统一走 `config/loader.ts`，不硬编码 |
| 4 | 🔧 接口变更必须先改 `docs/architecture/module-contracts.md` 再写代码 |
| 5 | 🔧 依赖最小化：运行时 5-6 个纯 JS 依赖，零原生编译（ADR-007） |

**环境说明（2026-08-09 老板撤销暂停）**：✅ 环境搭建**已恢复**——子任务可按需执行 `npm install` / `pnpm install`、依赖安装、工具链配置，并**跑起来验证代码**（tsc 校验、启动测试）。ADR-005 已标记 Deprecated。交付标准：**可运行的代码**，不只是语法级审查。

---

## 1. 模块列表

| 模块 | 前缀 | 一句话职责 | 状态 |
|------|------|-----------|------|
| **config** | CF | 配置中心：密钥集中管理（文件优先、环境变量兜底） | ✅ 完成 |
| **app** | AP | Express 应用壳：路由/WS/SSE/编排 | 🔄 AP-01/02/03/04/06 完成 |
| **persona** | PS | 人设文件化（v1.3）：PersonaProvider + FilePersonaProvider + 分区记忆 | 🔄 PS-01/02/03 完成 |
| **brain** | BR | Hermes 大脑：子进程调用 + function 路由 | ✅ BR-01~05 完成 |
| **voice-shell** | VS | 语音壳：Qwen-Audio WS 客户端 + 网关 | 📋 待执行 |
| **avatar** | AV | 数字人：素材匹配引擎（AV-01 完成） | 🔄 AV-01 完成 |
| **client** | CL | React 前端：聊天 UI / 画布 / 字幕 / 波形 | 📋 待执行 |
| **docs** | DC | 文档体系：三文档工作流（本文件属于此模块） | ✅ 完成 |
| **Hermes 执行者** | HM | Hermes 作为子任务执行者承接的任务（守则/角色卡/记忆模板，审查类已转 CC） | 🔄 HM-01/02/03 完成 |
| **Claude Code 执行者** | CC | 深度分析类任务（代码审查/依赖审计），只诊断不改码 | 📋 待执行 |

---

## 2. 模块职责说明

| 模块 | 职责详述 |
|------|----------|
| **config** | 所有 API 密钥与运行参数集中管理。`config/apikeys.json`（gitignore）+ `apikeys.example.json`（模板）+ `loader.ts`（文件优先、环境变量兜底）。对外导出 `AppConfig` / `loadConfig()` / `config` / `maskKey()` |
| **app** | Express 装配、REST 路由、SSE 事件通道、WS 服务端。Core Orchestrator 编排层在此：接收请求 → persona 取人设 → brain 执行 → 返回结果。代码 `app/server/index.ts` + `routes.ts` |
| **persona** | 只定义 `PersonaProvider` 抽象接口 + 类型（不存角色卡，人设数据归 Hermes）。实现 `HermesPersonaProvider`（hermes -z 子进程获取） |
| **brain** | `hermes-runner.ts`：`hermes -z "任务"` 子进程调用（120s 超时、stdout 捕获、错误兜底）。`function-router.ts`：拦截 function_call → 调 runner → 写回 output |
| **voice-shell** | `qwen-audio-client.ts`：Qwen-Audio-3.0-Realtime-Flash WS 客户端（session.update 注入 instructions、VAD、转写）。`gateway.ts`：/ws/voice 双向中继 + 双路分发（音频/字幕/情绪） |
| **avatar** | `clip-matcher.ts`（已实现，纯函数）：情绪 → 选片 → 队列，避免重复、无素材降级。`manifest.json`：素材清单。前端 `AvatarCanvas` 播放 |
| **client** | React 单页面：ChatUI / AvatarCanvas / CaptionBar / VoiceWaveform；hooks：useVoice/useChat/useAvatar/useTheme；`voice/audio.ts` 采集播放 |
| **docs** | BLUEPRINT（是什么）/ TASKS（干什么）/ DEVLOG（干了什么）/ WORKFLOW（怎么干）/ 本文件（任务配置） |

---

## 3. 模块依赖关系

```
config（地基，无依赖）
  │
  ▼
app（宿主，依赖 config）
  │
  ├──▶ persona（依赖 config；app 的 Orchestrator 依赖它取人设）
  ├──▶ brain（无依赖，纯子进程；app 依赖它执行任务）
  │
  ▼
voice-shell（依赖 persona 注入 instructions + brain 的 function-router）
  │
  ▼
avatar（依赖 voice-shell 的情绪事件；clip-matcher 本身无依赖）
  │
  ▼
client（依赖 app 全部 REST/WS/SSE 能力）
```

**关键依赖链（开发顺序）**：
```
M1:  config → app(AP-01) + persona(PS-01) + brain(BR-01) → app(AP-02 Orchestrator)
M2:  voice-shell(VS-01~06) + app(AP-05 WS)
M3:  avatar(AV-01~04) + client(CL-01~02)
M4:  client(CL-03~09)
M5:  联调收尾
```

---

## 4. 模块任务定义（执行入口 / 输入 / 输出）

### 模块 CF · config（✅ 完成，仅参考）

| 项 | 内容 |
|----|------|
| **执行入口** | `config/loader.ts`、`config/apikeys.example.json` |
| **输入参数** | `config/apikeys.json`（或环境变量 DASHSCOPE_API_KEY 等） |
| **预期输出** | `AppConfig` 对象（dashscope/hermes/server/avatar 四组配置），`maskKey()` 脱敏 |
| **验收标准** | CF-01 ✅：文件优先、环境变量兜底；CF-02 ✅：apikeys.json 入 gitignore |
| **状态** | ✅ DONE（已交付，无需再执行） |

---

### 模块 AP · app 应用壳

| 项 | 内容 |
|----|------|
| **执行入口** | `app/server/index.ts`（Express 装配）、`app/server/routes.ts`（路由工厂） |
| **输入参数** | `AppConfig`（来自 `config/loader.ts`）；REST 请求体 / WS 消息 |
| **预期输出** | REST API（health/chat/brain/status/avatar/status）+ SSE `/api/events` + WS `/ws/voice` |

**任务清单**：

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| AP-01 | Express 装配与路由骨架 | P0 | ✅ | CF-01 | `/api/health` 返回 `{status:"ok"}`；SSE 骨架就绪；config 集成 |
| AP-02 | Core Orchestrator 编排层 | P0 | ✅ | AP-01, PS-01, BR-01 | 文本聊天请求 → persona 取 instructions → brain 执行 → 返回结果（chat 链路实测通过） |
| AP-03 | REST API 实现 | P1 | ✅ | AP-01 | `/api/chat`、`/api/brain/status`、`/api/avatar/status` 可用（实测通过） |
| AP-04 | 旧脚手架迁移重构 | P1 | ✅ | AP-01 | cybergirlfriend/server → app/server 完成；SDK/DB/TDesign 全移除（运行时依赖 13→1）；旧 server 目录清理；tsc 零错误（2026-08-09 验收） |
| AP-05 | WS 服务端实现 | P0 | 📋 | VS-02 | WebSocket Server 挂载 `/ws/voice` |
| AP-06 | 环境变量管理 | P1 | ✅ | - | `.env` 读取 DASHSCOPE_API_KEY 等（parseDotEnv + .env.example 已交付） |

---

### 模块 PS · persona 人设（v1.3：人设文件化，老板拍板）

| 项 | 内容 |
|----|------|
| **执行入口** | `persona/provider.ts`（FilePersonaProvider 实现） |
| **输入参数** | 人设 id；`~/.hermes/personas/` 下文件（personas.json / active.txt / card.md / memory.md） |
| **预期输出** | `PersonaProvider` 接口实现：listPersonas 读 personas.json、getPersona 组装 card+memory、switchPersona 写 active.txt（毫秒级） |
| **方案依据** | `docs/research/hermes-capabilities-review.md` §3.1（老板 2026-08-09 拍板：人设文件化 + 人设分区记忆 + 专用 profile cyber-girlfriend） |

**数据文件约定**（权威源在 Hermes 侧，赛博女友只读）：
```
~/AppData/Local/hermes/profiles/cyber-girlfriend/personas/
├── personas.json   # 注册表（id/name/description/cardFile/memoryFile/voiceId/emotion）
├── active.txt      # 当前活跃人设 id（一行）
├── xiaodai/card.md + memory.md   # 角色卡（静态）+ 记忆区（动态，LLM 维护）
└── README.md       # 数据模型说明
```

**任务清单**：

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| PS-01 | PersonaProvider 接口定义 | P0 | ✅ | - | `PersonaProvider` + `Persona`/`PersonaInfo` 类型定义完成 |
| PS-02 | FilePersonaProvider 实现 | P0 | ✅ | PS-01 | 直读 personas 文件：毫秒级切换（写 active.txt），人设确定性 100%（`persona/file-persona-provider.ts` 已交付） |
| PS-03 | 人设切换 API | P2 | 📋 | PS-02 | `POST /api/persona/switch` 切换活跃人设，无需重启 |
| PS-04 | 人设分区记忆维护 | P1 | ✅ | PS-02 | memory.md 收尾指令模板：新事实追加 + 超限压缩；全局事实写 MEMORY.md（产出 `docs/hm-03-memory-template.md`） |

---

### 模块 BR · brain 大脑

| 项 | 内容 |
|----|------|
| **执行入口** | `brain/hermes-runner.ts`（子进程调用）+ `brain/function-router.ts`（function 路由中转） |
| **输入参数** | 任务文本（Qwen function_call 入参）`{instruction, context?, timeoutMs?}` |
| **预期输出** | `BrainResult`：`{ok, output, durationMs, error?}`；function 链路：`FunctionCall → FunctionCallOutput`（契约 v1.4 §2.8） |

**接口定义（契约 v1.2）**：
```ts
export interface BrainRunner {
  run(task: BrainTask): Promise<BrainResult>;
}
export interface BrainTask { instruction: string; context?: string; timeoutMs?: number; }
export interface BrainResult { ok: boolean; output: string; durationMs: number; error?: string; }
```

**任务清单**：

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| BR-01 | hermes-runner.ts 实现 | P0 | ✅ | - | `hermes -z "任务"` 子进程调用，120s 超时，stdout 捕获，错误兜底（优化：加 `--profile cyber-girlfriend -t terminal,file,web`） |
| BR-02 | function-router.ts 实现 | P0 | ✅ | BR-01, AP-02 | 拦截 function_call → 调 runner → function_call_output 写回（`brain/function-router.ts` 已交付，2026-08-09 实测 12/12 通过，真实 Hermes 8.1s 出结果） |
| BR-03 | Hermes 可用性探测 | P1 | ✅ | BR-01 | `/api/brain/status` 返回版本与可用性（routes.ts 已实现，实测 `{available:true, version:"Hermes Agent v0.20.0"}`） |
| BR-04 | 超时与错误处理 | P1 | ✅ | BR-01 | 超时友好提示；Hermes 不可用降级纯 Qwen（orchestrator 已实现降级） |
| BR-05 | 工具集白名单 + AGENTS.md 安全层 | P0 | ✅ | BR-01 | runner 已加 `--profile cyber-girlfriend -t terminal,file,web`；AGENTS.md 已产出（HM-01） |

> 📌 **BR-01 实现规格**：`brain/hermes-runner-spec.md`（接口定义 + 实测 Hermes 参数 + 参考骨架 + 验收自检表，实测 `hermes -z "1+1=?"` → `2。`）
> 📌 **BR-02 已交付**：`brain/function-router.ts`（契约 v1.4 §2.8）——`extractFunctionCall(event)` 提取 3 形态 function_call / `handle()` 拦截 hermes_brain → 调 runner / `buildFunctionCallOutputEvent()` 构造写回事件 / `hermesBrainTool` 工具 schema（VS-06 直接用）。实测 12/12 通过，真实 Hermes `1+1=?` → `2` 耗时 8.1s。

---

### 模块 VS · voice-shell 语音壳

| 项 | 内容 |
|----|------|
| **执行入口** | `voice-shell/qwen-audio-client.ts`、`voice-shell/gateway.ts` |
| **输入参数** | WS 消息 `{type:'start'/'audio'/'interrupt'}`；PCM 16kHz 上行音频 |
| **预期输出** | WS 下行 `{type:'audio'/'subtitle'/'emotion'/'brain'/'error'}`；PCM 24kHz 音频 |
| **📌 连接实测（2026-08-09）** | WS URL `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen-audio-3.0-realtime-flash`，Header `Authorization: Bearer <Key>` 鉴权；实测连接成功 → `session.created`（session_id 返回）→ `session.update`（人设注入）被接受；API Key 已写入 `config/apikeys.json`（gitignore） |

**任务清单**：

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| VS-01 | Qwen-Audio WS 客户端 | P0 | 📋 | PS-02, Key | 连接 realtime WS，session.update 注入 instructions（详细规格见 `docs/tasks/VS-01-qwen-audio-client.md`） |
| VS-02 | 语音网关 gateway.ts | P0 | 📋 | VS-01 | `/ws/voice` 中继：上行 PCM16k → Qwen，下行 PCM24k → 浏览器 |
| VS-03 | 双路分发 | P1 | 📋 | VS-02 | 音频→播放；副文本→字幕；情绪→数字人 |
| VS-04 | VAD 与打断 | P1 | 📋 | VS-02 | server_vad 模式，说话自动打断 |
| VS-05 | 输入转写 | P2 | 📋 | VS-01 | enableInputAudioTranscription 开启 |
| VS-06 | Function Calling 注册 | P0 | 📋 | BR-02, VS-01 | hermes_brain 工具注册（用 BR-02 `hermesBrainTool` schema），function_call → router |

---

### 模块 AV · avatar 数字人（方案已确认 ✅）

| 项 | 内容 |
|----|------|
| **执行入口** | `avatar/clip-matcher.ts`（已实现，M1 预置）、`avatar/manifest.json` |
| **输入参数** | 情绪事件 `emotion`；最近播过片段列表 `recentlyPlayed` |
| **预期输出** | `ClipMatcher`：pickClip → Clip/null；buildQueue → Clip[]（素材清单） |

**核心逻辑**（已实现）：按情绪筛选 → 优先新鲜池随机 → 全播过回退全池轮换 → 无素材返回 null（降级 Live2D）。

**任务清单**：

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| AV-01 | clip-matcher 迁移与适配 | P0 | ✅ | - | 从 cybergirlfriend/ 迁移，适配新架构（方案已确认，自检 16/16 ✅） |
| AV-02 | manifest.json 设计 | P0 | 📋 | - | 路径/情绪标签/时长/嘴型活跃度，结构完整 |
| AV-03 | 素材占位方案 | P1 | 📋 | AV-02 | 开源样片 + 卡通兜底 |
| AV-04 | 情绪匹配与轮换 | P1 | 📋 | AV-01 | 情绪事件 → 选片，避免连续重复 |

---

### 模块 CL · client 前端

| 项 | 内容 |
|----|------|
| **执行入口** | `client/App.tsx`、`client/components/`、`client/hooks/`、`client/voice/audio.ts` |
| **输入参数** | WS/REST 数据（服务端推送） |
| **预期输出** | 聊天 UI + 数字人画布 + 字幕条 + 情绪波形 |

**任务清单**：

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| CL-01 | AvatarCanvas 组件 | P0 | 📋 | AV-01 | `<video>` 播放 + idle/speaking/listening 切换 |
| CL-02 | useAvatar Hook | P1 | 📋 | CL-01 | 播放控制 + 情绪对齐 + 轮换 |
| CL-03 | ChatUI 组件 | P1 | 📋 | AP-03 | 聊天界面，单一人设 |
| CL-04 | CaptionBar 组件 | P1 | 📋 | VS-03 | 字幕显示 |
| CL-05 | VoiceWaveform 组件 | P2 | 📋 | VS-02 | 情绪波形动画 |
| CL-06 | useVoice Hook | P0 | 📋 | VS-02 | 语音状态机：采集/播放/打断 |
| CL-07 | useChat Hook | P2 | 📋 | AP-03 | 文本聊天（调试/降级） |
| CL-08 | audio.ts 工具 | P1 | 📋 | - | getUserMedia 采集、播放、能量分析 |
| CL-09 | 旧脚手架迁移 | P1 | 📋 | CL-03 | cybergirlfriend/src → client/ |

---

### 模块 DC · docs 文档体系（✅ 核心完成）

| 项 | 内容 |
|----|------|
| **执行入口** | `docs/BLUEPRINT.md`（蓝图）/ `TASKS.md`（看板）/ `DEVLOG.md`（日志）/ `WORKFLOW.md`（规则）/ **本文件**（任务配置） |
| **输入参数** | 开发过程中的进度、决策、变更 |
| **预期输出** | 文档实时同步，新聊天框可自举 |

---

### 模块 HM · Hermes 执行者（交给自己完成的任务）

| 项 | 内容 |
|----|------|
| **执行入口** | Hermes 本机（`hermes -z` 或 `hermes kanban` 派活）；产物写入 Hermes 侧 profile 或项目内 |
| **输入参数** | 小呆派的指令（任务背景 + 要求 + 输出位置） |
| **预期输出** | 守则/角色卡/模板/审查报告等（按任务验收标准） |
| **📌 任务看板** | `docs/TASKS.md` §HM 模块表（Hermes 的任务清单与完成情况） |
| **状态跟踪** | Hermes 完成 → 回报产出路径 + 完成情况 → 小呆核对 → 更新 HM 表 |
| **派活模式** | ①同步（小任务）：`hermes -z` 直接派，阻塞等结果；②异步（长任务）：`hermes kanban create` 派活（不阻塞）→ 稍后 `hermes kanban show <id>` 查询 |
| **文档即状态（老板规则）** | Hermes **每次完成任务必须更新文档**（`docs/DEVLOG.md` 追加记录 + 必要时更新 `docs/TASKS.md` HM 表）。小呆**通过查文档判断 Hermes 是否完成**（grep DEVLOG 最新条目 / HM 表状态），不阻塞等待 |
| **派活模板** | 指令必须包含：①任务编号 ②任务要求 ③输出位置 ④「**完成后更新 docs/DEVLOG.md 追加一条记录，并更新 docs/TASKS.md HM 表状态**」 |

**任务清单**：

| ID | 任务 | 优先级 | 状态 | 验收标准 |
|----|------|--------|------|----------|
| HM-01 | AGENTS.md 行为守则起草 | P0 | ✅ | 白名单路径/禁删规则/危险命令先说明（产出 `AGENTS.md`） |
| HM-02 | 人设角色卡 card.md 起草 | P0 | ✅ | 小呆/知心姐姐/助手三份：身份/性格/说话风格/世界观 |
| HM-03 | 记忆维护收尾指令模板 | P1 | ✅ | 新事实追加 memory.md + 超限压缩 + 全局事实写 MEMORY.md（产出 `docs/hm-03-memory-template.md`） |
| HM-04 | 已交付代码审查 | P1 | ➡️ 转 CC | 老板定：转 **Claude Code**（`docs/tasks/CC-01-code-review.md`） |
| HM-05 | 依赖与安全审计 | P1 | ➡️ 转 CC | 老板定：转 **Claude Code**（`docs/tasks/CC-02-dependency-audit.md`） |
| HM-06 | 文档一致性检查 | P2 | 📋 | 三文档与 TASKS-CONFIG 同步性检查 |

> 📌 **HM-04/05 转 Claude Code**（老板 2026-08-09）：深度分析类任务非 Hermes 长处，转 CC 执行。

---

### 模块 CC · Claude Code 执行者（深度分析类任务）

| 项 | 内容 |
|----|------|
| **执行入口** | 老板把任务文档交给 Claude Code（`docs/tasks/CC-XX-*.md`，自包含可直接执行） |
| **任务文档** | `docs/tasks/CC-01-code-review.md`（代码审查）、`docs/tasks/CC-02-dependency-audit.md`（依赖审计） |
| **职责边界** | 深度分析（审查/审计），只诊断不改码；产出报告到 `docs/reviews/` |

**任务清单**：

| ID | 任务 | 优先级 | 状态 | 验收标准 |
|----|------|--------|------|----------|
| CC-01 | 已交付代码审查 | P1 | 📋 | 覆盖 8 个核心文件，报告含分级问题+合规检查，输出 `docs/reviews/code-review-2026-08-09.md` |
| CC-02 | 依赖与安全审计 | P1 | 📋 | 依赖清单分析 + npm audit + 配置/密钥检查，输出 `docs/reviews/dependency-audit-2026-08-09.md` |

---

## 5. 常见任务速查（新聊天框）

| 老板说 | 执行 |
|--------|------|
| "执行模块 BR-01" | 读 §4 BR-01 → 写 `brain/hermes-runner.ts` → 验收 → 更新看板/日志 |
| "执行模块 PS-01" | 读 §4 PS-01 → 写 `persona/provider.ts` → 验收 → 更新看板/日志 |
| "执行模块 AP-02" | 读 §4 AP-02 → 写 Orchestrator → 验收 → 更新看板/日志 |
| "执行模块 VS-01" | 读 §4 VS-01 → 写 `voice-shell/qwen-audio-client.ts` → 验收 → 更新看板/日志 |
| "派 Hermes 做 HM-XX" | 小呆调 `hermes -z` 派活 → Hermes 完成 → 更新 HM 表状态 |
| "查进度" | 汇总 TASKS.md 状态给老板 |
| "重构/迁移" | 按 AP-04 / CL-09 定义执行 |

---

*TASKS-CONFIG v1.0 · 2026-08-09 · 新聊天框唯一入口：一个文件明确所有任务*

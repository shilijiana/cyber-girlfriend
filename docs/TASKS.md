# 赛博女友 · 任务看板（TASKS）

> **所有模块的任务清单与进度跟踪。接任务、查进度、看依赖，全在这。**
> 更新日期：2026-08-09 · 版本 v1.1
> **💡 新聊天框请直接读 `docs/TASKS-CONFIG.md`（整合版唯一入口），本文件为看板存档。**

---

## 看板规则

### 状态标记

| 标记 | 含义 |
|------|------|
| 📋 | TODO — 待开工 |
| 🔄 | IN PROGRESS — 开发中 |
| ✅ | DONE — 已完成 |
| 🚫 | BLOCKED — 被阻塞（注明原因） |
| ⏸ | PAUSED — 暂停（注明恢复条件） |

### 优先级

| 标记 | 含义 |
|------|------|
| P0 | 阻塞其他模块，必须先做 |
| P1 | 当前里程碑核心任务 |
| P2 | 增强功能，不阻塞主线 |
| P3 | 后续里程碑 / 可延后 |

### 任务 ID 规则

`{模块}-{序号}`，如 `VS-01`（voice-shell 第 1 个任务）、`BR-02`（brain 第 2 个任务）。

---

## 里程碑总览

| 里程碑 | 目标 | 状态 | 说明 |
|--------|------|------|------|
| **M0** 架构定稿 | 架构总纲 + 契约 + ADR + 目录 + 三文档工作流 | ✅ 完成 | 架构设计阶段产出 |
| **M1** 核心骨架 | app 装配 + persona + brain + function-router | 🔄 进行中 | 文字链路已通（AP-02/03 ✅），旧脚手架迁移完成（AP-04 ✅），BR-02 待做 |
| **M2** 语音链路 | voice-shell Qwen WS + voice-gateway | 📋 待开工 | 语音链路打通 |
| **M3** 数字人 | avatar clip-matcher + 前端画布 | 🔄 进行中 | AV-01 完成，AV-02~04 待执行 |
| **M4** 前端集成 | React UI 全量 + 字幕 + 波形 | 📋 待开工 | 完整前端体验 |
| **M5** 联调收尾 | 端到端 + 优化 + 文档 | 📋 待开工 | 交付级完成 |

---

## 模块优先级排名（2026-08-09 老板确认）

> **排名依据**：依赖拓扑位置 + 核心体验贡献度（语音+人设+数字人）+ 风险先行。数字越小越先做。

| 排名 | 模块 | 优先级 | 理由 | 当前状态 |
|------|------|--------|------|----------|
| 🥇 1 | **config** 配置中心 | P0 | 一切的地基，无依赖，所有模块都要用它 | ✅ CF-01 完成 |
| 🥈 2 | **app** 应用壳 | P0 | Express 宿主，所有 API 的载体，挡住所有上层模块 | 🔄 AP-01/02/03/04/06 完成 |
| 🥉 3 | **persona** 人设 | P0 | 赛博女友的"灵魂"，Orchestrator 依赖它注入人设 | 🔄 PS-01/02 完成 |
| 4 | **brain** 大脑 | P0 | 复杂事务执行（Hermes 子进程），HermesPersonaProvider 依赖它 | 🔄 BR-01/03 完成 |
| 5 | **voice-shell** 语音壳 | P1 | 核心交互方式（语音问答），依赖 persona+brain 的 M1 链路 | 📋 待开工 |
| 6 | **avatar** 数字人 | P1 | 差异化亮点（视觉形象），方案已确认（clip-matcher），依赖语音情绪事件 | 🔄 AV-01 完成 |
| 7 | **client** 前端 | P2 | 所有能力的最终呈现，依赖 M1-M3 全部后端能力 | 📋 待开工 |
| 8 | **docs** 文档体系 | P3 | 支撑性工作，M0 已基本完成，随开发持续维护 | ✅ 主线完成 |

**排名背后的依赖链**：

```
config → app → persona → brain → voice-shell → avatar → client
（地基） （宿主） （灵魂）  （大脑）  （听/说）    （形象）   （呈现）
```

**为什么 persona 排在 brain 前面**：Orchestrator（AP-02）依赖 persona 注入 instructions 才能跑通文字链路；brain 的 hermes-runner（BR-01）无依赖可并行开发，但 PS-02（HermesPersonaProvider）依赖 BR-01——所以 persona 接口先行、brain 实现并行，M1 两条线同时铺。

---

## M0 · 架构定稿（✅ 完成）

| ID | 任务 | 模块 | 状态 | 说明 |
|----|------|------|------|------|
| M0-01 | 整体架构设计 | docs | ✅ | `overall-architecture.md` v1.1 |
| M0-02 | 模块接口契约 | docs | ✅ | `module-contracts.md` v1.1 |
| M0-03 | 架构决策记录 | docs | ✅ | 6 条 ADR |
| M0-04 | 按模块建目录 + README | 全部 | ✅ | voice-shell/brain/persona/avatar/app/client |
| M0-05 | 删除记忆系统与数据库 | - | ✅ | memory/ data/ 已删（ADR-006） |
| M0-06 | 三文档工作流 | docs | ✅ | BLUEPRINT + TASKS + DEVLOG + WORKFLOW |

---

## M1 · 核心骨架（📋 待开工）

> **目标**：文字链路先跑通——人设注入 + Hermes 调用 + 文本聊天 API，不碰语音。
> **前置条件**：老板拍板剩余决策（见下方阻塞项）

### 阻塞项（待老板拍板）

| 决策 | 选项 | 默认建议 |
|------|------|----------|
| 中转路径 | A. Function Calling（推荐） / B. 手动文本注入 | A |
| Hermes 后端模型 | DeepSeek / OpenAI / 本地 Ollama | DeepSeek |
| 小呆人设内容 | 角色卡具体字段值 | 老板定 |
| 走 Hermes 的判定规则 | 哪些请求触发 function_call | 人设 post_history_instructions 引导 |

---

### app · 应用壳

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| AP-01 | Express 装配与路由骨架 | P0 | ✅ | CF-01 | `/api/health` 返回 `{status:"ok"}`；SSE 骨架就绪；config 加载器集成 |
| AP-02 | Core Orchestrator 编排层 | P0 | ✅ | AP-01, PS-01, BR-01 | 文本聊天请求 → persona 获取 instructions → brain 执行 → 返回结果（代码已就位，AP-03 实测 chat 链路通过） |
| AP-03 | REST API 实现 | P1 | ✅ | AP-01 | `/api/chat`、`/api/brain/status`、`/api/avatar/status` 可用（2026-08-09 实测通过） |
| AP-04 | 旧脚手架迁移重构 | P1 | ✅ | AP-01 | cybergirlfriend/server → app/server 完成，SDK/DB/TDesign 全移除（运行时依赖 13→1），旧 server 目录已清理，tsc 零错误（2026-08-09 验收） |

### config · 配置中心（新增）

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| CF-01 | APIKEY 配置文件 + 加载器 | P0 | ✅ | - | `config/apikeys.example.json` + `config/loader.ts` 就绪；文件优先、环境变量兜底 |
| CF-02 | .gitignore 更新 | P0 | 📋 | CF-01 | `config/apikeys.json` 被忽略，`apikeys.example.json` 入库 |

### persona · 人设（v1.3：人设文件化，老板拍板）

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| PS-01 | PersonaProvider 接口定义 | P0 | ✅ | - | `PersonaProvider` 接口 + `Persona`/`PersonaInfo` 类型定义完成 |
| PS-02 | FilePersonaProvider 实现（人设文件化） | P0 | ✅ | PS-01 | 直读 `~/.hermes/personas/`：listPersonas 读 personas.json、getPersona 组装 card.md+memory.md、switchPersona 写 active.txt（毫秒级；`persona/file-persona-provider.ts` 已交付，2026-08-09 实测通过） |
| PS-03 | 人设切换 API | P2 | ✅ | PS-02 | `POST /api/persona/switch` + `GET /api/personas` 已实现：FilePersonaProvider 读 personas/ 目录，切换写 active.txt（毫秒级、重启保持）；2026-08-09 实测通过 |
| PS-04 | 人设分区记忆维护 | P1 | 📋 | PS-02 | memory.md 收尾指令模板：新事实追加 + >20 条/3KB 压缩为长期记忆；全局事实写 MEMORY.md |

### brain · 大脑

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| BR-01 | hermes-runner.ts 实现 | P0 | ✅ | - | `hermes -z "任务"` 子进程调用，120s 超时，stdout 捕获，错误兜底（优化：加 `--profile cyber-girlfriend -t terminal,file,web`） |
| BR-02 | function-router.ts 实现 | P0 | 📋 | BR-01, AP-02 | 拦截 function_call → 调 hermes-runner → function_call_output 写回 |
| BR-03 | Hermes 可用性探测 | P1 | ✅ | BR-01 | `/api/brain/status` 返回 Hermes 版本与可用性（app/server/routes.ts 已实现，2026-08-09 实测 `{available:true, version:"Hermes Agent v0.20.0"}`） |
| BR-04 | 超时与错误处理 | P1 | 📋 | BR-01 | 超时返回友好提示，Hermes 不可用时降级为纯 Qwen 答复（brain 失败降级已在 orchestrator 实现，剩余部分待评估） |
| BR-05 | 工具集白名单 + AGENTS.md 安全层 | P0 | 📋 | BR-01 | runner 固定 `-t terminal,file,web`（或含 memory 按需）；后端工作目录放 AGENTS.md 行为守则（Hermes 评估报告 §3.4，老板拍板） |

### Hermes 执行者（HM）—— 交给 Hermes 自己完成的任务

> **模块说明**：HM = Hermes Agent 作为独立"子任务执行者"承接的任务（老板 2026-08-09 拍板，同其他子任务一样建立清单跟踪）。
> **执行方式**：架构负责人（小呆）把任务派给 Hermes（`hermes -z` 指令），Hermes 完成后回报，小呆核对并更新本表。
> **注意**：Hermes 是"执行者"，不是赛博女友代码模块——本模块任务多为 Hermes 侧配置/文档/审查类，不写赛博女友代码。

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| HM-01 | AGENTS.md 行为守则起草 | P0 | ✅ | - | Hermes 自拟安全守则：白名单路径/禁删规则/危险命令先说明（产出 `AGENTS.md`，2026-08-09 已落盘） |
| HM-02 | 人设角色卡 card.md 起草 | P0 | ✅ | - | 小呆/知心姐姐/助手 三份卡：身份/性格/说话风格/世界观（Hermes 侧 personas/ 已落盘，2026-08-09） |
| HM-03 | 记忆维护收尾指令模板 | P1 | 📋 | HM-02 | 设计指令模板：新事实追加 memory.md + >20 条/3KB 压缩 + 全局事实写 MEMORY.md |
| HM-04 | 已交付代码审查 | P1 | 📋 | - | 审查 BR-01/PS-02/AV-01/AP-02 代码：找 bug/边界问题/改进建议 |
| HM-05 | 依赖与安全审计 | P1 | 📋 | - | 审查 package.json 依赖最小化 + tsconfig 合理性 + 潜在安全问题 |
| HM-06 | 文档一致性检查 | P2 | 📋 | - | 对照 TASKS-CONFIG 检查三文档（TASKS/BLUEPRINT/DEVLOG）是否同步 |

---

## M2 · 语音链路（📋 待开工）

> **目标**：语音链路打通——浏览器麦克风 → Qwen-Audio Realtime WS → 语音播放 + 字幕。
> **前置条件**：M1 完成 + DASHSCOPE_API_KEY 就绪

### voice-shell · 语音壳

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| VS-01 | Qwen-Audio Realtime WS 客户端 | P0 | 📋 | PS-02, API Key | 连接 `wss://...realtime?model=qwen-audio-3.0-realtime-flash`，session.update 注入 instructions |
| VS-02 | 语音网关 gateway.ts | P0 | 📋 | VS-01 | `/ws/voice` 中继：上行 PCM 16k → Qwen，下行 PCM 24k → 浏览器 |
| VS-03 | 双路分发 | P1 | 📋 | VS-02 | 音频流 → 播放；副文本 → 字幕；情绪事件 → 数字人触发 |
| VS-04 | VAD 与打断 | P1 | 📋 | VS-02 | server_vad 模式，用户说话时自动打断 AI |
| VS-05 | 输入转写 | P2 | 📋 | VS-01 | `enableInputAudioTranscription` 开启，用户语音转文字 |
| VS-06 | Function Calling 注册 | P0 | 📋 | BR-02, VS-01 | `hermes_brain` 工具注册到 Qwen session，function_call → function-router |

### app · 应用壳（M2 补充）

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| AP-05 | WS 服务端实现 | P0 | 📋 | VS-02 | WebSocket Server 挂载 `/ws/voice`，连接/断开/消息处理 |
| AP-06 | 环境变量管理 | P1 | ✅ | - | `.env` 读取 `DASHSCOPE_API_KEY` / `VOICE_PROVIDER` / `HERMES_PATH`（loader.ts 已实现 parseDotEnv + .env.local 覆盖，`.env.example` 已交付） |

---

## M3 · 数字人（📋 待开工）

> **目标**：数字人可视化上线——素材库 + 匹配引擎 + 前端画布播放。
> **前置条件**：M2 完成（有情绪事件驱动）+ 素材就位（老板负责）

### avatar · 数字人

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| AV-01 | clip-matcher.ts 迁移与适配 | P0 | ✅ | - | 从 cybergirlfriend/server/avatar/ 迁移，适配新架构接口（方案已确认 ✅） |
| AV-02 | manifest.json 设计与实现 | P0 | 📋 | - | 素材清单：路径/情绪标签/时长/嘴型活跃度，结构完整（方案已确认 ✅） |
| AV-03 | 素材占位方案 | P1 | 📋 | AV-02 | 开源授权样片 + 内置卡通形象兜底（老板负责素材后补） |
| AV-04 | 情绪匹配与轮换策略 | P1 | 📋 | AV-01 | 情绪事件 → 选片，避免连续重复，随机+轮换 |

### client · 前端（M3 补充）

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| CL-01 | AvatarCanvas 组件 | P0 | 📋 | AV-01 | `<video>` 素材播放 + 状态切换（idle/speaking/listening） |
| CL-02 | useAvatar Hook | P1 | 📋 | CL-01 | 素材播放控制 + 情绪对齐 + 轮换逻辑 |

---

## M4 · 前端集成（📋 待开工）

> **目标**：完整前端体验——聊天 UI + 字幕 + 波形 + 语音会话状态机。

### client · 前端

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| CL-03 | ChatUI 组件 | P1 | 📋 | AP-03 | 聊天界面，收敛单一人设，文字聊天可用 |
| CL-04 | CaptionBar 组件 | P1 | 📋 | VS-03 | 字幕显示，S2S 副文本驱动 |
| CL-05 | VoiceWaveform 组件 | P2 | 📋 | VS-02 | 情绪波形动画，AudioAnalyser 能量驱动 |
| CL-06 | useVoice Hook | P0 | 📋 | VS-02 | 语音会话状态机：采集/播放/打断/状态 |
| CL-07 | useChat Hook | P2 | 📋 | AP-03 | 文本聊天（调试/降级） |
| CL-08 | audio.ts 工具 | P1 | 📋 | - | getUserMedia 采集、播放、音频能量分析 |
| CL-09 | 旧脚手架前端迁移 | P1 | 📋 | CL-03 | cybergirlfriend/src → client/，多 Agent → 单一人设 |

---

## M5 · 联调收尾（📋 待开工）

> **目标**：端到端联调 + 体验优化 + 文档完善。

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| M5-01 | 端到端联调 | P0 | 📋 | M1-M4 | 快问快答 <1s / 复杂事务 1.5-6s / 数字人联动 |
| M5-02 | 错误处理与降级 | P1 | 📋 | M5-01 | Hermes 不可用→纯 Qwen / 素材缺失→Live2D 兜底 |
| M5-03 | Git 初始化与首次提交 | P1 | 📋 | M5-01 | git init + .gitignore + Conventional Commits + Tag |
| M5-04 | README 完善 | P2 | 📋 | M5-01 | 项目 README：启动/配置/架构概览 |
| M5-05 | .env.example 完善 | P1 | 📋 | AP-06 | 所有环境变量有示例与说明 |

---

## 已暂停 / 已废弃任务

| 任务 | 状态 | 说明 |
|------|------|------|
| 测试框架与 CI（Vitest/Playwright/GitHub Actions） | ⏸ 暂停 | 新架构落地后按新结构重写 |
| better-sqlite3 → node:sqlite 切换 | 🗑 废弃 | 无数据库（ADR-006 取代 ADR-003） |
| CodeBuddy Agent SDK 集成 | 🗑 废弃 | 改为自研 Core（ADR-002） |
| 记忆系统（memory/）与数据库（data/） | 🗑 废弃 | 事务与记忆归 Hermes（ADR-006） |

---

## 任务依赖关系图

```
M1 核心骨架（文字链路先跑通）
├── PS-01 PersonaProvider 接口 ← （无依赖）
├── PS-02 HermesPersonaProvider ← PS-01 + BR-01
├── BR-01 hermes-runner ← （无依赖）
├── AP-01 Express 骨架 ← （无依赖）
├── AP-02 Core Orchestrator ← AP-01 + PS-01 + BR-01
├── BR-02 function-router ← BR-01 + AP-02
└── AP-03 REST API ← AP-01

M2 语音链路（M1 完成后）
├── VS-01 Qwen WS 客户端 ← PS-02 + API Key
├── VS-02 语音网关 ← VS-01
├── VS-06 Function Calling 注册 ← BR-02 + VS-01
├── AP-05 WS 服务端 ← VS-02
└── AP-06 环境变量 ← （无依赖）

M3 数字人（M2 完成后，有情绪事件驱动；方案已确认）
├── AV-01 clip-matcher 迁移 ← （无依赖）
├── AV-02 manifest.json ← （无依赖）
├── AV-04 情绪匹配与轮换 ← AV-01
├── CL-01 AvatarCanvas ← AV-01
└── CL-02 useAvatar ← CL-01

M4 前端集成（M2+M3 完成后）
├── CL-06 useVoice ← VS-02
├── CL-03 ChatUI ← AP-03
├── CL-04 CaptionBar ← VS-03
└── CL-05 VoiceWaveform ← VS-02

M5 联调收尾（M1-M4 完成后）
├── M5-01 端到端联调 ← M1+M2+M3+M4
├── M5-03 Git 初始化 ← M5-01
└── M5-04 README ← M5-01
```

---

*任务看板 v1.1 · 2026-08-09 · 三文档工作流之二：让子模块自主执行*

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
| **M1** 核心骨架 | app 装配 + persona + brain + function-router | ✅ 完成 | 文字链路全通（AP-01~06 ✅ + BR-01~05 ✅ + PS-01~04 ✅） |
| **M2** 语音链路 | voice-shell Qwen WS + voice-gateway | ✅ 完成 | **VS-01~06 ✅ + AP-05 ✅ + AP-06 ✅** —— 语音链路全通（/ws/voice 真实 Qwen 连接实测通过） |
| **M3** 数字人 | avatar clip-matcher + 前端画布 | ✅ 完成 | AV-01~04 ✅ + CL-01/02 ✅（画布 + useAvatar + 素材 + 匹配引擎全通） |
| **M4** 前端集成 | React UI 全量 + 字幕 + 波形 | ✅ 完成 | CL-01~09 全部 ✅（ChatUI/useChat/迁移 + CaptionBar + VoiceWaveform + useVoice + audio.ts；tsc 零错误 + vite build 通过） |
| **M5** 联调收尾 | 端到端 + 优化 + 文档 | 🔄 进行中 | M5-01 联调实测：链路全通（REST/chat/人设切换/WS 语音 6/6/前端 build/数字人联动全 ✅），性能未达标（快问快答 20-39s vs <1s，瓶颈 Hermes 冷启动，ACP 常驻治本）；M5-02~04 待 M5-01 达标后推进；CC-01/02 审查审计 M5 末做 |

---

## 模块优先级排名（2026-08-09 老板确认）

> **排名依据**：依赖拓扑位置 + 核心体验贡献度（语音+人设+数字人）+ 风险先行。数字越小越先做。

| 排名 | 模块 | 优先级 | 理由 | 当前状态 |
|------|------|--------|------|----------|
| 🥇 1 | **config** 配置中心 | P0 | 一切的地基，无依赖，所有模块都要用它 | ✅ CF-01/02 完成 |
| 🥈 2 | **app** 应用壳 | P0 | Express 宿主，所有 API 的载体，挡住所有上层模块 | 🔄 AP-01~06 完成 |
| 🥉 3 | **persona** 人设 | P0 | 赛博女友的"灵魂"，Orchestrator 依赖它注入人设 | 🔄 PS-01~04 完成 |
| 4 | **brain** 大脑 | P0 | 复杂事务执行（Hermes 子进程），HermesPersonaProvider 依赖它 | ✅ BR-01~05 完成 |
| 5 | **voice-shell** 语音壳 | P1 | 核心交互方式（语音问答），依赖 persona+brain 的 M1 链路 | 📋 待开工 |
| 6 | **avatar** 数字人 | P1 | 差异化亮点（视觉形象），方案已确认（clip-matcher），依赖语音情绪事件 | 🔄 AV-01/02/04 完成 |
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

## M1 · 核心骨架（✅ 完成）

> **目标**：文字链路先跑通——人设注入 + Hermes 调用 + 文本聊天 API，不碰语音。
> **前置条件**：老板拍板剩余决策（见下方阻塞项）

### 阻塞项（✅ 已全部拍板）

| 决策 | 选项 | 最终拍板 |
|------|------|----------|
| 中转路径 | A. Function Calling（推荐） / B. 手动文本注入 | A（BR-02 function-router 已交付） |
| Hermes 后端模型 | DeepSeek / OpenAI / 本地 Ollama | DeepSeek（deepseek-v4-flash） |
| 小呆人设内容 | 角色卡具体字段值 | 老板定（HM-02 角色卡已落盘） |
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
| CF-02 | .gitignore 更新 | P0 | ✅ | CF-01 | `config/apikeys.json` 被忽略，`apikeys.example.json` 入库（2026-08-09 已确认） |

### persona · 人设（v1.3：人设文件化，老板拍板）

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| PS-01 | PersonaProvider 接口定义 | P0 | ✅ | - | `PersonaProvider` 接口 + `Persona`/`PersonaInfo` 类型定义完成 |
| PS-02 | FilePersonaProvider 实现（人设文件化） | P0 | ✅ | PS-01 | 直读 `~/.hermes/personas/`：listPersonas 读 personas.json、getPersona 组装 card.md+memory.md、switchPersona 写 active.txt（毫秒级；`persona/file-persona-provider.ts` 已交付，2026-08-09 实测通过） |
| PS-03 | 人设切换 API | P2 | ✅ | PS-02 | `POST /api/persona/switch` + `GET /api/personas` 已实现：FilePersonaProvider 读 personas/ 目录，切换写 active.txt（毫秒级、重启保持）；2026-08-09 实测通过 |
| PS-04 | 人设分区记忆维护 | P1 | ✅ | PS-02 | memory.md 收尾指令模板：新事实追加 + >20 条/3KB 压缩为长期记忆；全局事实写 MEMORY.md（产出 `docs/hm-03-memory-template.md`，HM-03 完成） |

### brain · 大脑

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| BR-01 | hermes-runner.ts 实现 | P0 | ✅ | - | `hermes -z "任务"` 子进程调用，120s 超时，stdout 捕获，错误兜底（优化：加 `--profile cyber-girlfriend -t terminal,file,web`） |
| BR-02 | function-router.ts 实现 | P0 | ✅ | BR-01, AP-02 | 拦截 function_call → 调 hermes-runner → function_call_output 写回（`brain/function-router.ts` 已交付：tsc 零错误，冒烟 12/12 通过，真实 Hermes `1+1=?` → `2` 耗时 8.1s，2026-08-09 实测） |
| BR-03 | Hermes 可用性探测 | P1 | ✅ | BR-01 | `/api/brain/status` 返回 Hermes 版本与可用性（app/server/routes.ts 已实现，2026-08-09 实测 `{available:true, version:"Hermes Agent v0.20.0"}`） |
| BR-04 | 超时与错误处理 | P1 | ✅ | BR-01 | 超时返回友好提示，Hermes 不可用时降级为纯 Qwen 答复（orchestrator 已实现降级：`（大脑开小差了：...稍后再试试？）`） |
| BR-05 | 工具集白名单 + AGENTS.md 安全层 | P0 | ✅ | BR-01 | runner 已加 `--profile cyber-girlfriend -t terminal,file,web`（config.hermes.profile/toolsets）；AGENTS.md 行为守则已产出（HM-01，2026-08-09） |

### Hermes 执行者（HM）—— 交给 Hermes 自己完成的任务

> **模块说明**：HM = Hermes Agent 作为独立"子任务执行者"承接的任务（老板 2026-08-09 拍板，同其他子任务一样建立清单跟踪）。
> **执行方式**：架构负责人（小呆）把任务派给 Hermes（`hermes -z` 指令），Hermes 完成后回报，小呆核对并更新本表。
> **注意**：Hermes 是"执行者"，不是赛博女友代码模块——本模块任务多为 Hermes 侧配置/文档/审查类，不写赛博女友代码。

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| HM-01 | AGENTS.md 行为守则起草 | P0 | ✅ | - | Hermes 自拟安全守则：白名单路径/禁删规则/危险命令先说明（产出 `AGENTS.md`，2026-08-09 已落盘） |
| HM-02 | 人设角色卡 card.md 起草 | P0 | ✅ | - | 小呆/知心姐姐/助手 三份卡：身份/性格/说话风格/世界观（Hermes 侧 personas/ 已落盘，2026-08-09） |
| HM-03 | 记忆维护收尾指令模板 | P1 | ✅ | HM-02 | 设计指令模板：新事实追加 memory.md + >20 条/3KB 压缩 + 全局事实写 MEMORY.md（产出 `docs/hm-03-memory-template.md`，对齐 Hermes 记忆机制，2026-08-09） |
| HM-04 | 已交付代码审查 | P1 | ➡️ 转 CC | - | 老板定：代码审查非 Hermes 长处，转 **Claude Code** 执行（任务文档 `docs/tasks/CC-01-code-review.md`） |
| HM-05 | 依赖与安全审计 | P1 | ➡️ 转 CC | - | 老板定：依赖审计非 Hermes 长处，转 **Claude Code** 执行（任务文档 `docs/tasks/CC-02-dependency-audit.md`） |
| HM-06 | 文档一致性检查 | P2 | 📋 | - | 对照 TASKS-CONFIG 检查三文档（TASKS/BLUEPRINT/DEVLOG）是否同步 |

> 📌 **HM-04/05 已转 Claude Code**（老板 2026-08-09）：Hermes 擅长的执行型任务（守则/角色卡/记忆模板）已完成；代码审查与依赖审计这类深度分析交给 Claude Code，任务卡见 `docs/tasks/`。

### Claude Code 执行者（CC）—— 深度分析类任务

> **模块说明**：CC = Claude Code 作为独立执行者承接的**深度分析类任务**（代码审查/依赖审计），老板 2026-08-09 明确：这类任务非 Hermes 长处，由 Claude Code 执行。
> **执行方式**：老板把任务文档（`docs/tasks/CC-XX-*.md`）交给 Claude Code，它直接按文档执行（自包含，无需翻阅其他文档）。
> **任务文档**：`docs/tasks/CC-01-code-review.md`（代码审查）、`docs/tasks/CC-02-dependency-audit.md`（依赖审计）
> **⏰ 执行时机**：老板 2026-08-09 拍板——**最后再做**（M5 联调收尾阶段执行，此时代码量完整、审查价值最大化）

| ID | 任务 | 优先级 | 状态 | 验收标准 | 任务文档 |
|----|------|--------|------|----------|----------|
| CC-01 | 已交付代码审查 | P1 | ⏸ 延后 | 审查 BR-01/PS-02/AV-01/AP-02/AP-03 代码，输出审查报告（bug/边界/安全/规范/建议）（M5 阶段执行） | `docs/tasks/CC-01-code-review.md` |
| CC-02 | 依赖与安全审计 | P1 | ⏸ 延后 | 审查 package.json 最小化 + tsconfig + npm audit 漏洞 + 建议，输出审计报告（M5 阶段执行） | `docs/tasks/CC-02-dependency-audit.md` |

---

## M2 · 语音链路（✅ 完成）

> **目标**：语音链路打通——浏览器麦克风 → Qwen-Audio Realtime WS → 语音播放 + 字幕。
> **前置条件**：M1 完成 + DASHSCOPE_API_KEY 就绪

### voice-shell · 语音壳

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| VS-01 | Qwen-Audio Realtime WS 客户端 | P0 | ✅ | PS-02, API Key | 连接 `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen-audio-3.0-realtime-flash`，session.update 注入 instructions（`voice-shell/qwen-audio-client.ts` + `provider.ts` 已交付，实测 7/7 通过：连接/注入/音频上下行/字幕/断线重连） |
| VS-02 | 语音网关 gateway.ts | P0 | ✅ | VS-01 | `/ws/voice` 中继：上行 PCM 16k → Qwen，下行 PCM 24k → 浏览器（`voice-shell/gateway.ts` 已交付，mock 单测 21/21 + 真实端到端 5/5 通过，含 ready/audio/subtitle/emotion/function_call 透传/状态机/断开清理） |
| VS-03 | 双路分发 | P1 | ✅ | VS-02 | 音频流 → 播放；副文本 → 字幕；情绪事件 → 数字人触发（`voice-shell/dispatcher.ts` 双路分发器已交付：bind 绑定会话事件源 → 多路消费者广播（audio/subtitle/emotion/vadState/functionCall），错误隔离 + 退订幂等 + dispose 可复用 + 重绑防泄漏；gateway 双路（浏览器+deps）统一走分发器；契约 v1.6 §2.9；单测 17/17，gateway 回归 26/26，tsc 零错误） |
| VS-04 | VAD 与打断 | P1 | ✅ | VS-02 | server_vad 模式，用户说话自动打断 AI（session 配 `turn_detection:{type:'server_vad'}`；`voice-shell` 已交付：`onVadState` 回调（speech_started/stopped 归一化）+ dispatcher 广播 + gateway 状态机 `listening` 态（VAD true → 浏览器 status listening，false → connected）；打断由服务端自动取消响应，客户端只透传状态；契约 v1.8；规格 `docs/tasks/VS-04-vad-interrupt.md`；单测 8/8 + gateway 回归 26/26，tsc 零错误） |
| VS-05 | 输入转写 | P2 | ✅ | VS-01 | `input_audio_transcription:{enabled:true,model:'fun-asr'}`（VS-01 已默认开启），用户语音转文字回调透传（`voice-shell/provider.ts` + `qwen-audio-client.ts` + `gateway.ts` 已交付：onInputTranscript 回调 + delta/completed 双事件 + 浏览器 `user_transcript` 透传；单测 7/7 + gateway 24/24，tsc 零错误） |
| VS-06 | Function Calling 注册 | P0 | ✅ | BR-02, VS-01 | 用 BR-02 `hermesBrainTool` schema 注册 `hermes_brain`；function_call → `extractFunctionCall` → router.handle → `buildFunctionCallOutputEvent` 写回（`voice-shell/function-calling.ts` 装配层已交付：tools 注册 + onFunctionCall 拦截 + sendFunctionCallOutput 写回 + brain working/done/failed 状态上报；契约 v1.7 §2.8；单测 15/15 含 gateway 全链路，tsc 零错误） |

### app · 应用壳（M2 补充）

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| AP-05 | WS 服务端实现 | P0 | ✅ | VS-02 | WebSocket Server 挂载 `/ws/voice`，连接/断开/消息处理（`app/server/ws.ts` 已交付：WS 挂载 + 生命周期 + gateway/fc 装配；`index.ts` 改 http server 共享端口 + SIGINT/SIGTERM 优雅关闭；自检 9/9 + voice-shell 回归全绿 + 真实端到端 6/6（真实 Qwen 连接 → session.updated 人设注入 → ready）；tsc 零错误；附带修复 gateway 帧类型判断 bug（ws 文本帧以 Buffer 交付）） |
| AP-06 | 环境变量管理 | P1 | ✅ | - | `.env` 读取 `DASHSCOPE_API_KEY` / `VOICE_PROVIDER` / `HERMES_PATH`（loader.ts 已实现 parseDotEnv + .env.local 覆盖，`.env.example` 已交付） |

---

## M3 · 数字人（📋 待开工）

> **目标**：数字人可视化上线——素材库 + 匹配引擎 + 前端画布播放。
> **前置条件**：M2 完成（有情绪事件驱动）+ 素材就位（老板负责）

### avatar · 数字人

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| AV-01 | clip-matcher.ts 迁移与适配 | P0 | ✅ | - | 从 cybergirlfriend/server/avatar/ 迁移，适配新架构接口（方案已确认 ✅） |
| AV-02 | manifest.json 设计与实现 | P0 | ✅ | - | 素材清单：路径/情绪标签/时长/嘴型活跃度，结构完整（`avatar/manifest.json` 已交付：version:1 + 10 条占位片段 5 情绪全覆盖，四必填字段对齐 Clip 接口，时长 3~8s；.gitignore 加 `!assets/avatars/manifest.json` 例外入 git，运行时副本同步；临时校验脚本 11/11 通过后已删，2026-08-09 验收） |
| AV-03 | 素材占位方案 | P1 | ✅ | AV-02 | 开源授权样片 + 卡通兜底（Pexels 6 视频 + 8 图已下载就位，`assets/avatars/clips/`；`avatar/manifest.json` 登记 6 条真实片段（五情绪全覆盖，时长实测 7.12~13.01s）；`manifest.example.json` 模板含 downloadUrl/license；README 同步占位方案；临时校验 11/11 通过后已删，2026-08-09 验收） |
| AV-04 | 情绪匹配与轮换策略 | P1 | ✅ | AV-01 | 情绪事件 → 选片，避免连续重复，随机+轮换（`avatar/emotion-matcher.ts` 已交付：有状态封装 pick/markPlayed/reset/getRecent，窗口滑动默认 5 自动避重，复用 AV-01；自检 12/12 + tsc 零错误，2026-08-09 验收） |

### client · 前端（M3 补充）

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| CL-01 | AvatarCanvas 组件 | P0 | ✅ | AV-01 | `<video>` 素材播放 + 状态切换（idle/speaking/listening）（`client/src/components/AvatarCanvas.tsx` 已交付：状态/情绪 → 选片决策抽纯函数 `avatar-canvas-core.ts`（复用 AV-04 EmotionMatcher 避重），video 播放 + listening 暂停 + 播完轮换 + 无素材/加载失败降级卡通占位；配套最小初始化 Vite+React 前端工程（client/）；自检 13/13 + tsc 零错误 + vite build 通过 + dev server 可跑，2026-08-09 验收） |
| CL-02 | useAvatar Hook | P1 | ✅ | CL-01 | 素材播放控制 + 情绪对齐 + 轮换逻辑（`client/src/hooks/use-avatar.ts` 已交付：素材加载 manifest→ClipLibrary 归一化、状态机 idle/speaking/listening（play/stop/listen/setState）、情绪对齐 setEmotion、轮换 next/reset（AV-04 matcher 避重 + rotationTick 强制重算）；配套修复 CL-01 测试过期断言（AV-03 后 10→6 条）与 test:avatar 脚本 bug（.tsx→.ts）；自检 14/14 + tsc 零错误（非 voice 模块）+ vite build 通过 + 契约 v1.10，2026-08-09 验收） |

---

## M4 · 前端集成（🔄 进行中）

> **目标**：完整前端体验——聊天 UI + 字幕 + 波形 + 语音会话状态机。

### client · 前端

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| CL-03 | ChatUI 组件 | P1 | ✅ | AP-03 | 聊天界面，收敛单一人设，文字聊天可用（`client/src/components/chat-core.ts` 已交付：消息模型 ChatMessage（id/role/text/ts/pending/error）+ 消息流纯函数 addUserMessage/addPending/resolvePending/markError + sendChatMessage（POST §2.1 /api/chat，可注入 fetch，网络/HTTP/结构异常全兜底 ok:false 不抛错）；自检 17/17 + tsc 零错误 + vite build；ChatUI 面板由 CL-07/09 组合交付（useChat 复用 chat-core + ChatMessages/ChatInput），2026-08-09 验收） |
| CL-04 | CaptionBar 组件 | P1 | ✅ | VS-03 | 字幕显示，S2S 副文本驱动（订阅 subtitle 事件）（`client/src/components/caption-core.ts` + `CaptionBar.tsx` 已交付：增量缓冲 createCaptionBuffer（append 累积 / replace 整段 / reset 清空，超长截断保留尾部 + 省略号）+ 受控展示组件（text/visible/tone，aria-live）；自检 13/13 + tsc 零错误 + vite build，2026-08-09 验收） |
| CL-05 | VoiceWaveform 组件 | P2 | ✅ | VS-02 | 情绪波形动画，AudioAnalyser 能量驱动（`client/src/components/waveform-core.ts` + `VoiceWaveform.tsx` 已交付：clampEnergy/emaSmooth/isSilent/energyToBars（余弦包络中间高两端低 + LCG 确定性抖动，可测）+ 受控 energy / source 自驱动双模式（rAF 平滑渲染，卸载取消）；配套 createAudioPlayer 可选 onEnergy 回调（AnalyserNode + computeEnergy，未传零开销）+ useVoice onEnergy 透传，向后兼容（契约 v1.11）；自检 30/30 + tsc 零错误 + vite build，2026-08-09 验收） |
| CL-06 | useVoice Hook | P0 | ✅ | VS-02 | 语音会话状态机：采集/播放/打断/状态（`client/src/hooks/useVoice.ts` 已交付：连接 /ws/voice（二进制 PCM16k 上行 / base64 PCM24k 下行）、状态机抽纯函数 `voice-machine.ts`（idle/connecting/connected/speaking/listening/closed/error + gateway 状态映射）、audio→顺序播放 / subtitle / user_transcript / emotion / brain / error 全事件分发、sendInterrupt 打断、StrictMode 安全生命周期；自检 67/67 + tsc 零错误 + vite build 通过，2026-08-09 验收） |
| CL-07 | useChat Hook | P2 | ✅ | AP-03 | 文本聊天（调试/降级）（`client/src/hooks/use-chat.ts` 已交付：**复用 CL-03 chat-core 纯函数核心**的 React Hook——messages/isLoading/error/inputValue/sendMessage/clear；options 支持 url（默认 /api/chat）/personaId/onError/onReply（App 集成字幕）；消息流 user+pending 占位 → sendChatMessage → resolvePending，网络/HTTP/结构异常全兜底 ok:false 不抛错；零持久化零第三方；自检 21/21 + tsc 零错误 + vite build，2026-08-09 验收） |
| CL-08 | audio.ts 工具 | P1 | ✅ | - | getUserMedia 采集、播放、音频能量分析（`client/src/voice/audio.ts` 已随 CL-06 前置交付：encodePCM16/decodePCM16（Int16 LE 对称端点）/resampleLinear（时间轴语义 + 末端 clamp）/computeEnergy（RMS，供 CL-05）+ createMicCapture（getUserMedia→48k→重采样 16k→Int16 帧）/createAudioPlayer（PCM24k 顺序队列无间隙播放 + interrupt 打断），零第三方，2026-08-09 验收） |
| CL-09 | 旧脚手架前端迁移 | P1 | ✅ | CL-03 | cybergirlfriend/src → client/，多 Agent → 单一人设（`ChatInput.tsx`/`ChatMessages.tsx` 零依赖重写交付：textarea 自适应（1~6 行）+ Enter 发送 / 气泡（user 右 assistant 左）+ 打字三点占位 + 时间戳 + 自动滚动 + 空态引导，类名对齐 CL-03/04/05 index.css（.chat-list/.chat-msg/.chat-bubble/.chat-typing/.chat-input-row）；ChatUI 组合 ChatMessages+ChatInput+useChat（CL-07）；**不迁移**多 Agent/会话/权限体系组件（Sidebar/NewChatDialog/PermissionDialog/AgentConfigDialog/SettingsPage/ToolCallsCollapse/useAgents/useModels/useSessions 等——新架构单一人设零持久化无对应需求，旧目录 cybergirlfriend/ 保留归档待老板确认清理）；自检 21/21（CL-07 集成）+ tsc 零错误 + vite build，2026-08-09 验收） |

---

## M5 · 联调收尾（🔄 进行中）

> **目标**：端到端联调 + 体验优化 + 文档完善。

| ID | 任务 | 优先级 | 状态 | 依赖 | 验收标准 |
|----|------|--------|------|------|----------|
| M5-01 | 端到端联调 | P0 | 🔄 | M1-M4 | 快问快答 <1s / 复杂事务 1.5-6s / 数字人联动（2026-08-09 联调实测：链路全通，**性能未达标**——快问快答 20.6-39.4s、复杂事务 28.5s，瓶颈 Hermes 冷启动（hermes -z 子进程 12-23s）；数字人联动 ✅。**老板 2026-08-09 拍板：ACP 常驻方案暂缓**（P1 延后），性能优化路线待定；详见 DEVLOG） |
| M5-02 | 错误处理与降级 | P1 | ✅ | M5-01 | Hermes 不可用→纯 Qwen / 素材缺失→Live2D 兜底 |
| M5-03 | Git 初始化与首次提交 | P1 | 📋 | M5-01 | git init + .gitignore + Conventional Commits + Tag |
| M5-04 | README 完善 | P2 | ✅ | M5-01 | 项目 README：启动/配置/架构概览（`README.md` 已交付：项目简介 + 核心特性 + 架构概览（两条核心路径）+ 快速开始（环境要求/安装/配置/启动/快速验证 curl）+ 项目结构 + 自检测试命令 + 设计红线 + 文档索引；命令与自检脚本逐一实测通过） |
| M5-05 | .env.example 完善 | P1 | ✅ | AP-06 | 所有环境变量有示例与说明（14 个变量全注释，含用途/默认值；补齐 HERMES_PROFILE/PERSONAS_DIR/TOOLSETS；loader 补 DASHSCOPE_REGION/MODEL 透传；交叉校验通过 + tsc 零错误） |

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

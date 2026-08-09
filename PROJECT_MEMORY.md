# PROJECT_MEMORY.md — 赛博女友（Cyber Girlfriend）

> 本文件记录项目的核心信息与决策，随需求变更持续更新。

## 项目概述

- **名称**：赛博女友（Cyber Girlfriend）—— AI 数字人语音陪伴应用
- **创建时间**：2026-08-09
- **简短描述**：**纯交互界面** Web 应用：云端 **Qwen-Audio-3.0-Realtime-Flash** 当"嘴和耳朵"（语音交互 + 人设快问快答），本地 **Hermes agent** 当"大脑"（具体事务执行 + 记忆，50+ 工具），中间用文本衔接（Function Calling 中转）。配套 **数字人素材库可视化**（情绪匹配引擎，运行时零 GPU）。**无记忆系统、无数据库**——记忆与事务全部归 Hermes 负责（老板 2026-08-09 明确）。
- **架构总纲**：`docs/architecture/overall-architecture.md`（v1.1，任务模块目录：voice-shell/brain/persona/avatar + app/client + docs/assets/scripts/tests）
- **当前任务定位（老板 2026-08-09 指示）**：核心架构设计任务已完成；**M1 核心骨架 ✅ 完成**——AP-01~06 ✅、PS-01~04 ✅、BR-01~05 ✅（2026-08-09 实测：`hermes -z "1+1=?"` → `2`；`/api/chat` 走 persona→brain 完整链路返回小呆口吻答案、`/api/brain/status` 探测到 Hermes v0.20.0；BR-02 function-router 交付后冒烟 12/12 通过，真实 Hermes 8.1s 出结果）。**M2 语音链路 ✅ 完成（2026-08-09 收官）**：VS-01 ✅（实测 7/7）、VS-02 ✅（21/21 + 5/5）、VS-03 ✅（双路分发 17/17）、VS-04 ✅（VAD 与打断 8/8）、VS-05 ✅（输入转写 7/7 + 24/24）、VS-06 ✅（Function Calling 注册 15/15）、**AP-05 ✅（WS 服务端挂载：`app/server/ws.ts`——WebSocketServer attach `/ws/voice` + gateway/fc 装配 + 生命周期；自检 9/9 + 真实端到端 6/6：真实 Qwen 连接 `session.created` → `session.updated` 人设注入 → ready；附带修复 gateway 帧类型判断 bug）**、AP-06 ✅（环境变量）。**M3 数字人 ✅ 完成（2026-08-09）**：AV-01~04 ✅ + CL-01（AvatarCanvas）✅ + CL-02（useAvatar）✅。**M4 前端集成 🔄 进行中（2026-08-09 开工）**：CL-06（useVoice 语音会话 Hook）✅ + CL-08（audio.ts 采集/播放/能量分析）✅；CL-03（ChatUI）/CL-04（CaptionBar）待派。
- **🔧 环境搭建已恢复（2026-08-09 撤销）**：~~环境搭建永久暂停~~（ADR-005）已撤销，子任务可按需执行 npm/pnpm install、Python 依赖安装、素材下载（fetch-avatars.sh）、工具链配置等环境类操作，交付可运行代码；仍遵守轻量化约束（运行时 5-6 纯 JS 依赖，ADR-007）。

## 目标

1. **S2S 语音链路**：语音 → 大模型直接产出语音，中间不经过文本转录，实现低延迟实时对话（目标端到端 < 800ms，含数字人渲染）。
2. **数字人可视化**：虚拟形象渲染 + 面部表情动画 + 口型同步（lip-sync），与语音输出实时联动。
3. **MCP 工具集成**：接入 4 个 MCP —— Work Buddy（办公协同）、Hermes agent（智能体扩展）、VSCODE（开发辅助）、CODEX（代码生成），让女友能"动手做事"。
4. **工程完备**：完整初始化代码、配置文件、使用说明、测试与运行文档。

## 技术选型

| 模块 | 选型 | 说明 |
|------|------|------|
| 脚手架 | `codebuddy-chat-web` 技能（init-cbc-sdk-web） | React 18 + Vite 5 + TypeScript + TDesign + Tailwind + Express 4 + SQLite，已集成 CodeBuddy Agent SDK 与 SSE 流式 |
| Agent 内核 | CodeBuddy Agent SDK（TypeScript，`@tencent-ai/agent-sdk`） | query / session / 权限控制，支持 mcpServers 配置 |
| S2S 语音 | 待确认：云 API（MiniMax Speech 2.6 / GLM-Realtime / Qwen 端到端 / 豆包 Seeduplex）或自托管开源（Qwen3-Omni / MiniCPM-o） | 详见"关键设计决策" |
| 数字人 | 待确认：Live2D（pixi-live2d-display，推荐）/ VRM 3D（three-vrm）/ 视频级口型（Wav2Lip·LatentSync） | 详见"关键设计决策" |
| 口型同步 | 音频能量驱动（AnalyserNode）兜底 + rhubarb-lip-sync（viseme 精确版可选） | 实时性优先 |
| 实时传输 | WebSocket / WebRTC（前端 ↔ 后端语音网关） | |
| MCP | `mcpServers` 配置：stdio（Hermes/VSCODE/CODEX）+ http（Work Buddy） | 官方 SDK 文档 sdk-mcp |

## 初始结构（AP-04 迁移重构后的实际目录，2026-08-09）

```
赛博女友/
├── config/                  # 配置中心（CF ✅）：密钥集中管理
│   ├── apikeys.json         # 实际密钥（gitignore，不入库）
│   ├── apikeys.example.json # 模板（入库）
│   └── loader.ts            # 文件优先、环境变量兜底（+ .env/.env.local 解析）
├── app/                     # 应用壳（AP-01~06 ✅ 全齐）
│   └── server/
│       ├── index.ts         # Express 装配 + SSE 骨架 + http server + WS 挂载 + 优雅关闭
│       ├── ws.ts            # WS 服务端（AP-05）：WebSocketServer attach /ws/voice + gateway/fc 装配 + 生命周期
│       ├── routes.ts        # REST API（health/chat/brain/avatar/persona）
│       ├── orchestrator.ts  # Core Orchestrator 编排层（persona→brain）
│       ├── ws-test.ts       # AP-05 自检（mock，9/9）
│       ├── ws-smoke-test.ts # AP-05 端到端冒烟（真实 Qwen，6/6）
│       └── default-persona-provider.ts  # 占位人设（已由 FilePersonaProvider 替代注入）
├── brain/                   # Hermes 大脑（BR-01~05 ✅）
│   ├── hermes-runner.ts     # hermes -z 子进程调用（120s 超时、错误兜底）
│   ├── function-router.ts   # Function Calling 中转（BR-02）：拦截 function_call → 调 runner → 写回
│   └── hermes-runner-spec.md
├── persona/                 # 人设接口（PS-01/02 ✅）
│   ├── provider.ts          # PersonaProvider 抽象 + 类型守卫
│   └── hermes-persona-provider.ts  # HermesPersonaProvider（hermes -z 获取）
├── avatar/                  # 数字人素材匹配（AV-01 ✅）
│   └── clip-matcher.ts      # 情绪→选片→队列，纯函数零依赖
├── client/                  # React 前端（CL-01/02/06/08 ✅）
│   ├── src/App.tsx           # 前端壳（CL-01：AvatarCanvas 演示页）
│   ├── src/components/       # AvatarCanvas.tsx + avatar-canvas-core.ts（纯逻辑核心）
│   ├── src/hooks/            # useAvatar.ts（CL-02）+ useVoice.ts（CL-06：连 /ws/voice 语音状态机）
│   └── src/voice/            # audio.ts（CL-08：PCM 编解码/重采样/能量 + 采集/播放）+ voice-machine.ts（状态机纯函数）+ voice-test.ts（自检 67/67）
├── voice-shell/             # 语音壳（VS-01~06 ✅ 全齐）
│   ├── provider.ts          # VoiceProvider/VoiceSession 契约（§2.2 v1.8，含 onInputTranscript/onVadState/sendFunctionCallOutput）
│   ├── qwen-audio-client.ts # Qwen-Audio Realtime WS 客户端（VS-01，实测 7/7；默认 server_vad + VAD 事件归一化）
│   ├── gateway.ts           # /ws/voice 双向中继 + 双路分发（VS-02，21/21+5/5；状态机含 listening 态；AP-05 修复帧类型判断：ws 文本帧以 Buffer+isBinary 交付）
│   ├── dispatcher.ts        # 双路分发器（VS-03，17/17）：audio/subtitle/emotion/vadState/functionCall 五路广播
│   ├── function-calling.ts  # Function Calling 装配层（VS-06，15/15）：注册 hermes_brain → router.handle → 写回 + brain 状态
│   ├── vad-unit-test.ts     # VS-04 VAD 单测（8/8）
│   └── README.md
├── assets/avatars/          # 素材库（gitignore，fetch-avatars.sh 下载）
├── docs/                    # 文档中心（BLUEPRINT/TASKS/DEVLOG/WORKFLOW/架构/ADR）
├── cybergirlfriend/         # 旧脚手架（server 已清空删除，src/ 待 CL-09 迁移后整体删除）
├── package.json             # 运行时依赖仅 express；devDeps: @types/node/typescript/@types/express
├── tsconfig.json            # strict + NodeNext + allowImportingTsExtensions + noEmit
├── .env.example             # 环境变量模板（入库）
├── .gitignore
└── PROJECT_MEMORY.md
```

## 关键设计决策

0. **老板已拍板（2026-08-09，四次更新）**：① **S2S 默认 Qwen 端到端**（阿里 DashScope，其余厂商预留接口按需再加，GLM-Realtime 作备选）② **数字人走素材库模仿说话**：预生成短视频 + 情绪匹配引擎，口型"大致对"，**运行时零 GPU**；③ **素材先占位后补**；④ 先出设计文档（DESIGN.md v0.4）评审后再动手。功能增删评审结论见 DESIGN §15：新增长期记忆/字幕/情绪波形，删除 WebRTC 推流与 Provider 收敛，VSCODE/CODEX、MuseTalk sidecar、PWA 等延后。
1. **S2S 优先、真·端到端**：主链路用语音到语音大模型（不做 STT→LLM→TTS 级联），符合"无需中间文本转换"的硬要求；数字人口型用**音频能量驱动**兜底，保证低延迟。
   - 注意：MiniMax Speech 2.6 已确认是**流式 TTS（T2A）**而非纯 S2S，只作 TTS 音色库备选。
2. **调研结论（2026-08-09 GitHub/网络调研）**：
   - S2S 云 API 第一梯队：MiniMax Speech 2.6（端到端延迟 <250ms，40+ 语言，被 LiveKit/Pipecat 采用，中文体验佳）、GLM-Realtime / GLM-4-Voice、Qwen 端到端（80ms）、豆包 Seeduplex（火山引擎）。
   - 开源自托管：Qwen3-Omni（3.9k⭐，需 GPU）、MiniCPM-o 4.5（9B，int4 仅 11GB 显存，端侧首选）、Step-Audio、GLM-4-Voice。
   - 参考项目：SillyTavern（31.8k⭐，角色扮演前端但无原生数字人/S2S）、Pipecat（14k⭐，语音 Agent 框架）、LiveKit Agents + agent-starter-react（915⭐）、talking-avatar-with-ai（457⭐，ASR+LLM+TTS+Rhubarb 口型链路）、Wav2Lip（13k⭐）/ LatentSync（6k⭐，视频口型，非实时）、rhubarb-lip-sync（2.6k⭐，2D viseme 口型）。
   - 结论：**不引入 Pipecat/LiveKit 双语言框架**（保持 TS 单栈），直接用云 S2S API + Express 语音网关。
3. **数字人走素材库模仿说话（老板指定 v0.2）**：默认 `clip_library` 方案——离线一次性生成 idle/speaking(情绪分类)/listening 短视频素材，运行时匹配引擎选片播放、起点对齐、口型大致同步，**零 GPU**；MuseTalk（MIT）/LatentSync 1.5（Apache-2.0）仅作可选实时增强或离线素材生成；无素材时降级 Live2D。
4. **MCP 统一走 SDK `mcpServers`**：Hermes/VSCODE/CODEX 用 stdio 本地进程；Work Buddy 按平台提供的 endpoint 走 http。工具调用结果通过 SSE 回传给前端展示。
5. **Git 工作流（老板要求 2026-08-09）**：初始化 `git init` + main 主干；.gitignore 忽略依赖/构建/.env/数据库/大视频素材（素材走 scripts/fetch-avatars.sh 下载，不入库）；提交用 **Conventional Commits**（feat/fix/docs/... + scope）；分支用轻量 Git Flow（feature/、fix/、chore/ 从 main 拉出，--no-ff 合并，里程碑打 Tag）。详见 DESIGN §14。
6. **尊重用户习惯**：方案先确认再动手；代码风格口语化注释，README 中文。

## 关键设计决策（追加）

7. **架构变更评估（2026-08-09）**：老板认为 CodeBuddy Agent SDK 太重，要求评估 **SillyTavern 式轻量核心对话+角色卡 + Hermes agent 工作执行** 方案。调研结论：**技术上完全可行**（详见 DESIGN §17）。待老板确认方向后，M1 范围将大幅调整：去掉 @tencent-ai/agent-sdk + better-sqlite3，改为自研 Chat Core + node:sqlite + Hermes runner。
8. **测试框架与 CI 暂停（2026-08-09）**：老板指示测试框架（Vitest/Playwright）和 CI 配置（GitHub Actions）暂时搁置，等新架构落地后再重新搭建。

## 新需求（2026-08-09 老板提出，调研中）

**Qwen3-Omni 语音角色卡模式**：类似 SillyTavern 的角色卡 → 发给 Qwen3-Omni → 发语音 → 实时返回语音+文字。不需要太高的智商（轻量即可）。
- 调研结论（见 DESIGN §18）：
  - **关键坑**：Qwen-Omni-Turbo 明确**不支持 system message 角色设定**；Qwen3-Omni-Flash / Qwen3.5-Omni 未禁止（需实测）。角色卡本质 = system prompt 组装，模型支持是前提。
  - **社区已有雏形**：SGLang-Omni Realtime WebSocket 接口、Qwen3-Omni-Simple-WebUI（FastAPI+DashScope）、run-qwen3-omni（Node+Vite，多供应商+VAD）、gouzi（Rust 单文件，prompts 字段注入角色）、OpenAvatarChat（数字人+Qwen-Omni handler）。
  - **SillyTavern 本身是 TTS 后处理**（LLM→文本→TTS），非 S2S；我们的场景用 Qwen3-Omni 原生 S2S 更合适，不需要 ST 的 TTS 管线。
  - **两条路线**：① 云端 DashScope `qwen3-omni-flash`（免 GPU、便宜，OpenAI 兼容）② 本地 vLLM 部署 30B-A3B（40GB+ 显存，211ms 低延迟、离线）。"不高智商"→ flash 足够。
- **待老板确认**：云端 vs 本地、Web 形态、角色卡格式（复刻 chara_card_v2 兼容社区 vs 自定义）。

## 新需求追加（2026-08-09 老板转向 Qwen-Audio-3.0-Realtime-Flash）

**老板判断 Qwen-Audio-3.0-Realtime-Flash 更合适，调研确认正确（见 Qwen3-Omni-调研笔记.md §9）**：
- 2026-07-15 发布的**专为实时语音对话**设计的模型（非全模态），时延 **<120ms**、**全双工可打断**（边说边听、抗噪、多人锁定）、**情感化语音**（情绪/副语言/音色克隆/风格切换，官方场景含"情感陪伴"）、**instructions 字段直接支持角色设定**（官方示例即设定角色）、**原生 FunctionCall + MCP 接入**。
- 价格：Flash 输入 ¥3 / 输出 ¥30 每百万 token（Plus ¥5/¥40）。
- 权衡：仅 API（数据过云）不开源；Qwen3-Omni 开源可本地部署，降为备选。
- **结论：S2S 主选改为 Qwen-Audio-3.0-Realtime-Flash**；待老板确认 + 申请 DASHSCOPE_API_KEY 实测（角色注入/打断体验/音色选择 Vivian/Emma/Ryan/Jack 或自定义克隆）。

## 新需求追加（2026-08-09 老板要求调研豆包 Seeduplex）

**豆包实时语音模型 3.0（Seeduplex）调研完成（见 豆包Seeduplex-调研报告.md）**：
- 2026-06-18 火山引擎上线，**原生全双工端到端**语音大模型，API 邀测制。
- 三大优势：精准遵循 / 抗干扰（误回复误打断双降）/ 动态判停（判停 -250ms、打断 -300ms、抢话 -40%）。
- 全双工最彻底（语义级守听、多人对话主动加入）；原生 FunctionCall + MCP + 自定义工具（边听边说边办事）；WebRTC 接入；火山豆包语音生态有 SystemMessages/HistoryLength 上下文管理、Prefill 降延迟、IgnoreBracketText 情绪指令下发（可驱动数字人）。
- 风险：**邀测制开通不确定**、文档零散、定价第三方 $0.008/分钟待官方确认、情感陪伴侧重弱于 Qwen、角色设定待实测。
- **结论：三方对比（Seeduplex / Qwen-Audio-3.0-Realtime / Qwen3-Omni）—— Qwen-Audio-3.0-Realtime-Flash 仍是当前最稳主选（官方角色注入背书 + 情感陪伴定位 + 已上线非邀测）；Seeduplex 建议并行申请邀测试验，达标则升级。Qwen3-Omni 保留本地化备选。**

## 新需求追加（2026-08-09 老板拍板核心架构：云端语音壳 + Hermes 大脑）

**老板核心思想（定稿）**：Qwen-Audio-3.0-Realtime-Flash 加载**简单人物背景** → 与老板**快问快答**；复杂问题 → Qwen-Audio 输入文本给 **Hermes** → Hermes 处理 → 文本反馈给 Qwen-Audio → 让 Qwen-Audio "说出来"。
- **技术可行性已核实（混合架构方案-云端语音壳+本地大脑.md v2）**：
  - Qwen-Audio Realtime 原生支持文本注入（`conversation.item.create` + `input_text`）、Function Calling（`function_call` → `function_call_output` → `response.create`）、用户语音转写（`enableInputAudioTranscription`）、`instructions` 人设注入 —— **文本中转链路全部有 API 支撑** ✅
  - **Hermes v0.20.0 已在本机安装**（C:\Users\chipsine\AppData\Local\hermes\hermes-agent，Python 3.13.14），`hermes -z "任务"` one-shot 立即可用；50+ 工具、200+ 模型后端、MCP serve 可选（详见 DESIGN §17.3）
  - 两条路径：A. **Function Calling 中转（推荐）**——Hermes 注册为工具，模型自动分流简单/复杂；B. 手动文本注入（自己控制分流）
- 延迟估算：简单对话 <1s（模型直接答）；复杂任务 1.5-6s（Hermes 处理为主，可加"稍等"过渡语）。
- **待老板拍板**：路径 A/B、Hermes 后端模型（DeepSeek/OpenAI/本地 Ollama）、人物背景内容（小呆人设）、走 Hermes 的判定规则、字幕存库。

## 下一步计划

- [x] **设计评审完成**（v0.5）→ 多次迭代至 v0.7
- [x] **架构变更评估**（DESIGN §17）：ST 式核心 + Hermes 可行性分析 ✅
- [x] **核心架构定稿**（2026-08-09 老板拍板）：云端 Qwen-Audio 语音壳 + **Hermes 大脑**（混合架构，方案 v2 已出，Hermes 已装 v0.20.0）
- [x] **整体架构设计任务**（2026-08-09）：产出 `docs/architecture/overall-architecture.md`（架构总纲）+ 按任务模块建目录 + ADR（6 条）+ 模块契约（module-contracts.md）
- [x] **🔧 环境搭建恢复**（2026-08-09 老板撤销暂停）：~~环境搭建永久暂停~~已撤销（ADR-005 Deprecated），子任务可按需执行依赖安装与工具链配置，交付可运行代码
- [x] **🔧 纯交互界面收敛**（2026-08-09 老板明确）：**删除记忆系统与数据库**（memory/ data/ 目录已删）——记忆由 Hermes 负责，赛博女友只做交互界面与简单问答，具体事务全部交给 Hermes（ADR-006；ADR-003 作废）
- [ ] **S2S 模型选型定稿**：Qwen-Audio-3.0-Realtime-Flash 主选（调研✅，待老板确认 + API Key 实测）
- [ ] **Seeduplex 邀测申请**（并行，seed.bytedance.com，达标则升级主选）
- [ ] **老板拍板剩余决策**：路径 A/B（默认 A Function Calling 中转）、Hermes 后端模型（DeepSeek/OpenAI/本地 Ollama）、小呆人设内容、走 Hermes 判定规则
- [ ] **方向确认后的 M1 重构**（~~测试框架/CI 暂停~~，~~环境搭建永久暂停~~已撤销，~~数据库切换取消~~）：
  - [ ] 去掉 @tencent-ai/agent-sdk，实现自研角色卡 + Prompt 组装器 + LLM 客户端
  - [ ] **无本地数据库**（原 better-sqlite3/node:sqlite 切换取消）
  - [x] **Hermes Runner（BR-01）完成**（2026-08-09）：`brain/hermes-runner.ts` 交付并实测通过（`hermes -z "1+1=?"` → `2` / 超时兜底 / 错误兜底）
  - [x] **PersonaProvider 接口（PS-01）完成**（2026-08-09）：`persona/provider.ts` 交付——`PersonaProvider` 接口（listPersonas/getPersona/buildInstructions/switchPersona）+ `Persona`/`PersonaInfo` 类型 + `isPersona`/`isPersonaInfo` 类型守卫，契约 v1.2 对齐，tsc strict 零报错
  - [x] **Core Orchestrator（AP-02）代码就位 + REST API（AP-03）完成**（2026-08-09）：`app/server/orchestrator.ts`（persona→brain 编排层）+ `default-persona-provider.ts`（占位人设）+ `routes.ts` 三接口（/api/chat /api/brain/status /api/avatar/status）实测全通过；根目录新建 package.json（express ^4.18.2）
  - [x] **旧脚手架迁移重构（AP-04）完成**（2026-08-09）：根 `package.json` 规范化（name=cyber-girlfriend + typecheck 脚本）、新建 `tsconfig.json`（strict/NodeNext/allowImportingTsExtensions）；删除 `cybergirlfriend/server/` 全部废弃文件（db.ts/mcp-servers.ts/index.ts/index.d.ts/avatar/clip-matcher.ts）；安装 typescript+@types/express 开发依赖；运行时依赖 13→1（仅 express）；`npm run typecheck` 零错误、`/api/health`+`/api/chat` 实测通过
  - [x] **Function Router（BR-02）完成**（2026-08-09）：`brain/function-router.ts` 交付——extractFunctionCall 兼容 3 种下行事件形态 / handle 拦截 hermes_brain → 调 runner / buildFunctionCallOutputEvent 构造写回 / hermesBrainTool 工具 schema（VS-06 直接用）；契约 v1.4 §2.8 登记；tsc 零错误 + 冒烟 12/12 + 真实 Hermes `1+1=?` → `2`（8.1s）
  - [x] **HermesPersonaProvider 实现（PS-02）完成**（2026-08-09）：`persona/hermes-persona-provider.ts` 交付（hermes -z 获取人设，JSON 容错 + 类型守卫）
  - [ ] Git init + 首次提交
- [ ] P2 工作集成增强（Hermes 常驻 + 多轮）
- [ ] P3 S2S 语音回归（Qwen 端到端网关）
- [x] **素材库数字人启动（AV-01）完成**（2026-08-09）：`avatar/clip-matcher.ts` 从 cybergirlfriend 迁移并适配契约 v1.2 §2.5——素材库构造注入（`createClipMatcher`）、buildQueue 毫秒单位、`AvatarEmotion/AvatarClip` 改公共类型 `Emotion/Clip`；自检 16/16 通过（node 原生 TS，未引入测试框架）
- [x] **M2 语音链路 6/6 完成（VS-01~06）**（2026-08-09）：VS-01 客户端（实测 7/7）→ VS-02 网关（21/21+5/5）→ VS-03 双路分发（17/17）→ **VS-04 VAD 与打断（8/8：onVadState + gateway listening 态 + server_vad 自动打断，契约 v1.8，规格 `docs/tasks/VS-04-vad-interrupt.md`）** → VS-05 输入转写（7/7+24/24）→ VS-06 Function Calling 注册（15/15）；**待 AP-05 WS 挂载**
- [x] **AP-05 WS 服务端挂载完成（2026-08-09，M2 收官）**：`app/server/ws.ts` 交付——WebSocketServer attach `/ws/voice`（path 过滤）+ gateway/fc/provider 装配（契约 §2.8 用法落地）+ 生命周期（错误兜底/人设失败降级/优雅关闭）；`index.ts` 改 http server 共享端口 + SIGINT/SIGTERM 优雅关闭 + persona/orchestrator 模块级单例（REST/WS 人设一致）；**附带修复 gateway.ts 帧类型 bug**（ws 文本帧以 Buffer 交付，改用 isBinary 区分，否则 `{type:'audio'}` 控制消息被当音频帧上行）；验证：tsc 零错误 + 自检 9/9 + voice-shell 回归全绿 + 真实端到端 6/6（真实 Qwen 连接 session.updated 人设注入）
- [x] **P4 素材库数字人完成（AV-02~04 + CL-01/02）**（2026-08-09）：AV-02 manifest 设计 ✅ / AV-03 素材占位 ✅ / AV-04 情绪匹配与轮换 ✅ / CL-01 前端画布 ✅ / CL-02 useAvatar ✅
- [x] **M4 前端集成开工：CL-06 useVoice + CL-08 audio.ts 完成**（2026-08-09）：`client/src/hooks/useVoice.ts`（连 /ws/voice 语音状态机：二进制 PCM16k 上行 / base64 PCM24k 下行、全事件分发、打断、StrictMode 安全）+ `client/src/voice/audio.ts`（PCM 编解码/重采样/RMS 能量 + createMicCapture/createAudioPlayer，零第三方）+ voice-machine.ts（状态机纯函数）；自检 67/67 + tsc 零错误 + vite build 通过；CL-03（ChatUI）/CL-04（CaptionBar）待派
- [ ] P5 体验优化 + 收尾

---
*最后更新：2026-08-09（M2 语音链路全通：AP-05 WS 挂载完成，真实 Qwen 端到端验证通过；M3 数字人 AV-02/AV-04/CL-01 已出卡；契约 v1.8）*

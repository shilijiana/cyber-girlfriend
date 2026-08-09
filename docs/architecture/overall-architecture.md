# 赛博女友 · 整体架构设计（v1.1）

> **文档定位**：赛博女友项目的核心架构总纲，统一所有任务模块的设计基准。
> **文档日期**：2026-08-09
> **前置依据**：`混合架构方案-云端语音壳+本地大脑.md`（老板定稿）、`DESIGN.md`（v0.7）、三份 S2S 调研报告、`PROJECT_MEMORY.md`
> **一句话架构**：**赛博女友 = 交互界面（语音问答 + 人设 + 数字人），云端 Qwen-Audio 当"嘴和耳朵"，本地 Hermes 当"大脑"负责具体事务与记忆，中间用文本衔接。**
> **v1.1 变更**（老板 2026-08-09）：**删除记忆系统与数据库模块**——记忆由 Hermes 负责，赛博女友只做交互界面与简单问答，具体事务全部交给 Hermes。

---

## 1. 架构梳理：现状与决策脉络

### 1.1 决策历史（为什么走到今天）

| 阶段 | 决策 | 依据 |
|------|------|------|
| v0.1 | CodeBuddy Agent SDK 做文本聊天内核 + S2S 语音 + 4 MCP | 脚手架初选 |
| v0.2 | 数字人改素材库方案（口型大致对，运行时零 GPU） | 老板：真人口型配置要求太高 |
| v0.4 | S2S 默认 Qwen 端到端（阿里 DashScope）；功能增删评审 | 老板拍板 |
| v0.5 | 完整自动化测试设计（Vitest+Playwright+CI） | 老板要求 |
| v0.6 | 依赖最小化 + 国内源（pnpm） | 老板：可移植性 |
| v0.7 | **废弃 CodeBuddy Agent SDK**，评估 ST 式核心 + Hermes | 老板：SDK 太重 |
| 定稿 v2 | **Qwen-Audio-3.0-Realtime-Flash 语音壳 + Hermes 大脑**（混合架构） | 老板 2026-08-09 定稿 |
| **v1.1** | **纯交互界面：删除记忆系统与数据库，记忆/事务全归 Hermes** | 老板 2026-08-09 |

### 1.2 核心架构职责边界（定稿）

```
┌──────────────────────────────────────────────────────────────────────┐
│                        浏览器（React 前端）                            │
│  Chat UI │ Avatar 画布 │ 麦克风/播放 │ 字幕 │ 情绪波形                 │
└──────┬──────────────────────────────┬───────────────────────────────┘
       │ WebSocket（音频+控制）        │ HTTP/SSE（文本+状态）
┌──────▼──────────────────────────────▼───────────────────────────────┐
│                    Express 后端（自研 Chat Core）                     │
│  纯交互层：不存任何业务数据，不建数据库，无本地记忆                   │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │               Core Orchestrator（编排核心）                    │   │
│  │  · voice-gateway：/ws/voice 中继，双路分发                     │   │
│  │  · qwen-audio-client：Qwen Realtime WS 客户端                  │   │
│  │  · function-router：Function Calling 中转（路径 A）            │   │
│  │  · hermes-runner：hermes -z 子进程调用（120s 超时）            │   │
│  │  · prompt-builder：人设 instructions 组装                       │   │
│  └───────┬──────────────────────────┬────────────────────────────┘   │
│          │ 文本中转（function_call /                              │
│          │ conversation.item.create）                              │
┌──────────▼──────────┐     ┌─────────▼─────────────────────────────┐  │
│  Qwen-Audio-3.0     │     │        Hermes Agent v0.20.0           │  │
│  Realtime-Flash     │     │  （本机 Python 3.13.14）              │  │
│  （阿里云，语音壳）  │     │  · 50+ 工具：终端/文件/浏览器/Git     │  │
│  · 嘴和耳朵：听/说   │     │  · MCP 支持：hermes mcp serve        │  │
│  · 人设快问快答     │     │  · 200+ 模型、33 provider             │  │
│  · FunctionCall     │     │  · 自进化技能                         │  │
│  · 转写/打断/字幕   │     │  · **记忆/事务由 Hermes 负责**         │  │
└─────────────────────┘     └───────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────┘
```

### 1.3 职责边界与依赖关系

| 模块 | 职责 | 依赖 |
|------|------|------|
| **前端（client/）** | 麦克风采集、语音播放、字幕显示、数字人画布、聊天 UI | 后端 WS/HTTP 接口 |
| **voice-gateway** | 浏览器 ↔ Qwen 的双向音频中继，双路分发（播放/字幕/数字人） | qwen-audio-client |
| **qwen-audio-client** | Qwen Realtime WS 会话管理、instructions 注入、事件转发 | 阿里云 API |
| **function-router** | 拦截 Qwen 的 function_call → 调 Hermes → 结果写回 | hermes-runner |
| **hermes-runner** | `hermes -z` 子进程执行，结果文本捕获 | 本机 Hermes 安装 |
| **prompt-builder** | 角色卡 → instructions 组装 | 角色卡定义 |
| ~~记忆（memory/）~~ | **已删除**——记忆由 Hermes 负责 | - |
| ~~数据库（data/）~~ | **已删除**——本地不建库，无持久化 | - |

### 1.4 关键设计约束

1. **语音壳快问快答 <1s**：简单对话由 Qwen-Audio 直接答，**不打扰 Hermes**（成本 + 延迟双优）。
2. **复杂事务走 Hermes**：只有 function_call 触发时才启动子进程，结果文本回传朗读。
3. **人设只注入语音壳**：instructions 里放简单人物背景（名字/性格/语气/关系）；角色卡即人格，换卡即换人。
4. **文本中转是唯一耦合点**：Qwen 与 Hermes 之间只传文本，互不知晓对方内部。
5. **零 GPU 运行时**：数字人走素材库方案，本地不跑推理。
6. **无本地状态**：**不建数据库、不做持久化、不存记忆**——会话状态最小化，记忆/事务全部由 Hermes 负责（Hermes 自带记忆系统）。
7. **依赖最小化**：Node 侧无原生编译依赖、无数据库依赖，Python 仅 Hermes。
8. **测试/CI 暂停**：当前聚焦架构与核心链路，测试框架与 CI 配置搁置，后续恢复。

### 1.5 识别的问题与重构点

| # | 问题 | 处置 |
|---|------|------|
| 1 | 脚手架 cybergirlfriend/ 仍含 CodeBuddy Agent SDK 依赖与结构 | **重构**：聊天内核改为自研 Core Orchestrator，移除 SDK |
| 2 | cybergirlfriend/server/db.ts（better-sqlite3）及所有持久化逻辑 | **删除**：无本地数据库，db 相关代码不进新架构 |
| 3 | 记忆相关设计（memories 表、摘要注入） | **删除**：记忆由 Hermes 负责，赛博女友不持有 |
| 4 | mcp-servers.ts 的 SDK mcpServers 配置已失效 | **废弃**：MCP 能力由 Hermes 原生提供 |
| 5 | 前端仍是无角色概念的多 Agent 界面 | **调整**：收敛为单一人设（角色卡驱动） |
| 6 | 测试套件（vitest/playwright）已暂停 | **保留**：结构保留，暂停运行，恢复时按新架构重写用例 |

---

## 2. 整体设计（目标架构）

### 2.1 模块划分依据（按"职责单一 + 独立演进"切分）

赛博女友的领域可拆为 **4 个能力模块 + 1 个支撑层**：

```
能力层（可独立开发/测试/替换）：
┌─────────────────────────────────────────────────────┐
│  voice-shell  语音壳：听、说、人设、转写、打断       │  → 对接云端 Qwen
│  brain        大脑：事务理解、工具执行、结果返回     │  → 对接本机 Hermes
│  persona      人设：角色卡、instructions、说话风格   │  → 换卡即换人
│  avatar       数字人：素材库、匹配引擎、画布播放     │  → 零 GPU 可视化
└─────────────────────────────────────────────────────┘
支撑层：
┌─────────────────────────────────────────────────────┐
│  app     应用壳：Express 装配、路由、WS、SSE         │
└─────────────────────────────────────────────────────┘
```

**划分原则**：每个模块边界 = 一个"可独立替换的供应商"或"可独立演进的能力"。语音壳和大脑是**可插拔供应商**（Qwen 可换 Seeduplex、Hermes 可换任意模型后端），人设/数字人是**产品能力**，app 是**支撑底座**。**记忆与数据库不是本系统的模块**——它们属于 Hermes 的职责范围。

### 2.2 核心交互流程

**流程 A：快问快答（简单对话，<1s）**
```
老板语音 → 浏览器采集 → /ws/voice → voice-gateway → qwen-audio-client
        → Qwen-Audio（instructions 已注入人设）直接生成语音+字幕
        → 下行音频 → 浏览器播放 + 字幕显示 + 数字人 speaking 素材
```

**流程 B：复杂事务（老板让女友办事，1.5-6s）**
```
老板语音 → Qwen-Audio 听懂 → 模型发出 function_call("hermes_brain", {task})
        → function-router 收到 → hermes-runner 子进程 hermes -z "任务"
        → Hermes 办事（终端/文件/浏览器 50+ 工具，记忆由 Hermes 维护）
        → function_call_output 写回 → response.create
        → Qwen-Audio 用语音+字幕"说"出结果 → 数字人联动
```

**流程 C：记忆（Hermes 负责，赛博女友不参与）**
```
老板的任何事务交给 Hermes → Hermes 自带记忆系统（跨会话记住老板偏好）
赛博女友本身不存记忆、不建数据库
```

### 2.3 数据流向总览

```
用户语音 ──► 语音壳（Qwen）──► 语音响应 ──► 前端播放 + 数字人
                │
                ├─ 简单 → 直接答（instructions 人设）
                └─ 复杂 → function_call ──► 大脑（Hermes）──► 结果文本
                          （文本中转）              │
                                                └─► 写回语音壳朗读
赛博女友侧零持久化；事务/记忆全部在 Hermes 侧闭环
```

### 2.4 目录结构（对应任务模块）

```
赛博女友/
├── docs/                        # 📚 文档中心（本任务）
│   ├── architecture/            #   架构设计（本文件 + module-contracts.md）
│   ├── research/                #   调研报告（Qwen/Omni/Seeduplex）
│   └── adr/                     #   架构决策记录
├── voice-shell/                 # 🎙️ 语音壳（任务模块）
│   ├── README.md
│   ├── qwen-audio-client.ts     #   Qwen Realtime WS 客户端
│   └── gateway.ts               #   /ws/voice 中继 + 双路分发
├── brain/                       # 🧠 大脑（任务模块）
│   ├── README.md
│   ├── hermes-runner.ts         #   hermes -z 子进程调用（120s 超时）
│   └── function-router.ts       #   Function Calling 中转
├── persona/                     # 💃 人设（任务模块）
│   ├── README.md
│   ├── character-silly.json     #   角色卡（chara_card_v2 格式）
│   └── prompt-builder.ts        #   instructions 组装
├── avatar/                      # 🎭 数字人（任务模块）
│   ├── README.md
│   ├── clip-matcher.ts          #   素材匹配引擎（已预置）
│   └── manifest.json            #   素材清单
├── app/                         # 🖥️ 应用壳（任务模块）
│   ├── README.md
│   ├── server/index.ts          #   Express 装配 + 路由 + SSE
│   └── ...                      #   （自 cybergirlfriend/server 迁移重构）
├── client/                      # 🌐 前端（任务模块）
│   ├── README.md
│   ├── components/              #   Chat UI / AvatarCanvas / CaptionBar / VoiceWaveform
│   ├── hooks/                   #   useVoice / useAvatar / useChat
│   └── ...                      #   （自 cybergirlfriend/src 迁移调整）
├── assets/                      # 🎬 素材库（不入 Git）
│   └── avatars/                 #   数字人素材（idle/speaking/listening + manifest）
├── scripts/                     # 🛠️ 工具脚本
│   ├── fetch-avatars.sh         #   素材下载
│   └── ...
├── tests/                       # ✅ 测试（暂停，恢复时用）
├── DESIGN.md                    # 详细设计（迭代中）
├── PROJECT_MEMORY.md            # 项目记忆
└── 混合架构方案-云端语音壳+本地大脑.md  # 老板定稿的方案
```

### 2.5 扩展性考量

| 扩展场景 | 支撑设计 |
|----------|----------|
| 换语音供应商（Seeduplex 等） | voice-shell 内部接口化，替换 qwen-audio-client 即可，brain/persona 不动 |
| 换 Hermes 模型后端（DeepSeek/Ollama） | Hermes 自身支持 200+ 模型 33 provider，零代码改动 |
| 新增能力模块（如日程/天气） | 注册为 Hermes 工具，赛博女友零改动 |
| 本地化部署（隐私场景） | 语音壳可切 Qwen3-Omni 开源自托管（已调研），接口不变 |
| 数字人增强（MuseTalk 实时口型） | avatar 模块预留 sidecar-client 接口（v2 可选，需 GPU） |
| 多角色/多女友 | persona 支持多角色卡切换，运行时热加载 |
| 记忆/个性化增强 | **全部在 Hermes 侧**（Hermes 自带记忆系统与自进化），赛博女友不承载 |

### 2.6 关键设计约束（落地红线）

1. **文本中转不漂移**：Qwen ↔ Hermes 只传纯文本任务描述 + 结果，不传音频、不传内部状态。
2. **语音壳不碰业务**：instructions 只装人设，不做任务调度；调度全在 function-router。
3. **Hermes 无状态调用**：`hermes -z` 一次性执行；**记忆/会话状态由 Hermes 自身管理**，app 层不持有。
4. **零持久化**：**不建数据库、不存文件、不做本地记忆**——赛博女友是纯交互界面。
5. **无状态服务**：应用壳保持无状态，便于随时重启、横向扩展。

---

## 3. 落地路径（与既有资产的关系）

| 既有资产 | 处置 |
|----------|------|
| cybergirlfriend/server/index.ts | 抽取编排逻辑 → app/server/，移除 SDK query 调用 |
| cybergirlfriend/server/db.ts | **删除**（无本地数据库） |
| cybergirlfriend/server/avatar/clip-matcher.ts | 迁移 → avatar/clip-matcher.ts（逻辑已验证） |
| cybergirlfriend/server/mcp-servers.ts | 废弃（MCP 能力移交 Hermes 原生） |
| cybergirlfriend/src/ | 迁移调整 → client/（收敛单一人设） |
| cybergirlfriend/tests/ | 保留结构，暂停运行 |
| DESIGN.md §17 评估 | 已被本方案吸收（ST 式核心 = Core Orchestrator） |

---

*架构 v1.1 · 2026-08-09 · 纯交互界面定位（无记忆/无数据库，事务与记忆归 Hermes）*

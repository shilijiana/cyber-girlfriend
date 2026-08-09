# 赛博女友 · 项目蓝图（BLUEPRINT）

> **你只看这一份文件就能理解整个项目、知道该干嘛、去哪查细节。**
> 更新日期：2026-08-09 · 版本 v1.1

---

## 1. 一句话项目

**赛博女友 = 纯交互界面**（语音问答 + 人设 + 数字人）。云端 Qwen-Audio-3.0-Realtime-Flash 当"嘴和耳朵"，本机 Hermes agent 当"大脑"负责具体事务与记忆，中间用文本衔接。**不建数据库、不存记忆、不做持久化**——事务与记忆全归 Hermes。

## 2. 架构速览

```
浏览器（React）
  │ WS（音频+控制）  │ HTTP/SSE（文本+状态）
  ▼                  ▼
Express 后端（Core Orchestrator，自研 ~400 行）
  │
  ├── voice-shell   → Qwen-Audio-3.0-Realtime-Flash（云端，语音壳）
  ├── brain         → Hermes Agent v0.20.0（本机，大脑）
  ├── persona       → 角色卡 → instructions（人设注入）
  └── avatar        → 素材库 + 匹配引擎（数字人，零 GPU）
```

**两条核心路径：**
- **快问快答（<1s）**：用户语音 → Qwen-Audio 直接答（人设已注入 instructions）
- **复杂事务（1.5-6s）**：Qwen 发 function_call → Hermes 干活 → 结果文本写回 → Qwen 语音说出

## 3. 模块清单

| 排名 | 模块 | 职责 | 核心文件 | 对外接口 |
|------|------|------|----------|----------|
| 1 | **config** ⚙️ | 配置中心：密钥集中管理，文件优先、环境变量兜底 | `config/apikeys.json` `config/loader.ts` | `AppConfig` / `loadConfig()` |
| 2 | **app** 🖥️ | Express 装配、路由、WS、SSE | `server/index.ts` `server/routes.ts` | REST + WS + SSE |
| 3 | **persona** 💃 | 人设接口（归 Hermes 维护）：PersonaProvider 抽象 + 切换 + 加载 | `provider.ts` | `PersonaProvider` |
| 4 | **brain** 🧠 | 复杂事务执行（Hermes 子进程），记忆归 Hermes | `hermes-runner.ts` `function-router.ts` | `BrainRunner` |
| 5 | **voice-shell** 🎙️ | 听、说、人设快问快答、转写、打断 | `qwen-audio-client.ts` `gateway.ts` | `VoiceProvider` / `VoiceSession` |
| 6 | **avatar** 🎭 | 素材库匹配引擎，情绪 → 选片播放（方案已确认） | `clip-matcher.ts` `manifest.json` | `ClipMatcher` |
| 7 | **client** 🌐 | React 前端：聊天 UI / 数字人画布 / 字幕 / 波形 | `components/` `hooks/` | WS/REST 消费方 |

> 完整优先级排名与理由见 `docs/TASKS.md` 顶部章节。

## 4. 红线（不可违反）

| # | 红线 | 出处 |
|---|------|------|
| 1 | **无数据库、无持久化、无本地记忆** | 老板 2026-08-09 明确（ADR-006） |
| 2 | **事务与记忆归 Hermes** | 老板：具体的事情有 Hermes 负责 |
| 3 | **人设归 Hermes 维护** | 赛博女友只保留接口定义与加载抽象（ADR-007） |
| 4 | **环境搭建永久暂停** | 老板：不是你负责的事（ADR-005） |
| 5 | **测试/CI 暂停** | 新架构落地后恢复 |
| 6 | **文本中转不漂移** | Qwen ↔ Hermes 只传纯文本 |
| 7 | **语音壳不碰业务** | instructions 只装人设，调度在 function-router |
| 8 | **方案先确认再动手** | 重大变更先出方案给老板评审 |
| 9 | **配置集中管理** | 所有密钥通过 config/loader.ts 统一加载（ADR-007） |
| 10 | **依赖最小化** | 运行时 5-6 个纯 JS 依赖，零原生编译（ADR-007） |

## 5. 技术栈

| 层 | 技术 | 说明 |
|----|------|------|
| 前端 | React 18 + Vite 5 + TypeScript + Tailwind | 自 cybergirlfriend/src 迁移，TDesign 已裁（优化报告 v1.0） |
| 后端 | Express 4 + TypeScript | 自研 Core Orchestrator（无 Agent SDK） |
| 语音 | Qwen-Audio-3.0-Realtime-Flash | 阿里 DashScope，WebSocket，PCM 16k 入 / 24k 出 |
| 大脑 | Hermes Agent v0.20.0 | 本机 Python 3.13.14，`hermes -z` 子进程 |
| 数字人 | 素材库（`<video>` 播放） | 零 GPU，情绪匹配引擎（方案已确认） |
| 运行时 | Node.js 22+ | 无原生编译依赖 |

## 6. 文档索引

需要深入某块时，去这查：

| 想了解 | 去哪看 |
|--------|--------|
| 架构全貌与设计思路 | `docs/architecture/overall-architecture.md` |
| 模块间接口定义与协议 | `docs/architecture/module-contracts.md` |
| 为什么做这些决策 | `docs/adr/README.md`（6 条 ADR） |
| 老板定稿的混合架构 | `混合架构方案-云端语音壳+本地大脑.md` |
| 详细设计（迭代历史） | `DESIGN.md` |
| S2S 语音选型调研 | `docs/research/Qwen-Audio-3.0-Realtime-调研报告.md` |
| 备选方案对比 | `docs/research/Qwen3-Omni-调研笔记.md`、`docs/research/豆包Seeduplex-调研报告.md` |
| 当前任务与进度 | `docs/TASKS.md` |
| 开发日志 | `docs/DEVLOG.md` |
| 工作流规则 | `docs/WORKFLOW.md` |
| 项目记忆 | `PROJECT_MEMORY.md` |

## 7. 快速上手（给新加入的模块开发者）

### 你要开发某个模块？三步走：

1. **读蓝图**（本文档）→ 理解项目全貌与你的模块在哪
2. **查契约** → `docs/architecture/module-contracts.md` → 找到你模块的接口定义
3. **看任务** → `docs/TASKS.md` → 找到你模块的待办任务与验收标准

### 开始干活时：

4. 在 `docs/DEVLOG.md` 开一条当日日志
5. 写代码，遵守红线与契约
6. 完成后在 `docs/TASKS.md` 更新任务状态
7. 在 `docs/DEVLOG.md` 记录做了什么、遇到什么问题

### 目录结构：

```
赛博女友/
├── docs/                  # 📚 文档中心
│   ├── BLUEPRINT.md       #   ← 你在这里（项目蓝图）
│   ├── TASKS.md           #   任务看板
│   ├── DEVLOG.md          #   开发日志
│   ├── WORKFLOW.md        #   工作流规则
│   ├── architecture/      #   架构设计（总纲 + 契约）
│   ├── research/          #   调研报告
│   └── adr/               #   架构决策记录
├── voice-shell/           # 🎙️ 语音壳
├── brain/                 # 🧠 大脑
├── persona/               # 💃 人设
├── avatar/                # 🎭 数字人
├── app/                   # 🖥️ 应用壳
├── client/                # 🌐 前端
├── assets/                # 🎬 素材库（不入 Git）
├── scripts/               # 🛠️ 工具脚本
├── tests/                 # ✅ 测试（暂停）
├── cybergirlfriend/       # 📦 旧脚手架（迁移源，逐步废弃）
├── DESIGN.md              # 详细设计
├── PROJECT_MEMORY.md      # 项目记忆
└── 混合架构方案-云端语音壳+本地大脑.md  # 老板定稿方案
```

## 8. 里程碑概览

| 里程碑 | 目标 | 状态 |
|--------|------|------|
| **M0** 架构定稿 | 架构总纲 + 模块契约 + ADR + 目录结构 | ✅ 完成 |
| **M1** 核心骨架 | app 装配 + persona + brain Hermes Runner + function-router | ⏳ 待开工（阻塞项待拍板） |
| **M2** 语音链路 | voice-shell Qwen-Audio WS 客户端 + voice-gateway 双向中继 | ⏳ 待开工 |
| **M3** 数字人 | avatar clip-matcher + manifest + 前端 AvatarCanvas（方案已确认） | ⏳ 待开工 |
| **M4** 前端集成 | React UI + 字幕 + 波形 + 语音会话状态机 | ⏳ 待开工 |
| **M5** 联调收尾 | 端到端联调 + 体验优化 + 文档完善 | ⏳ 待开工 |

> 详细任务见 `docs/TASKS.md`

---

*蓝图 v1.1 · 2026-08-09 · 三文档工作流之一：让架构自我解释*

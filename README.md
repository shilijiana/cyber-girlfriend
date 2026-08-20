# 赛博女友（Cyber Girlfriend）🌸

> **AI 数字人语音陪伴应用** —— 云端语音壳 + 本地大脑的纯交互界面。

赛博女友是一个 Web 应用：用语音跟"她"聊天，她有自己的性格（人设）、会动（数字人）、能干活（接 Hermes 大脑办具体事务）。**不建数据库、不存记忆、不做持久化**——所有事务与记忆都交给本机 Hermes agent 管理，赛博女友侧保持纯交互、零状态。

```
云端 Qwen-Audio（嘴和耳朵） + 本机 Hermes（大脑） = 赛博女友
```

## ✨ 核心特性

| 特性 | 说明 |
|------|------|
| 🎙️ **语音对话** | Qwen-Audio-3.0-Realtime-Flash 全双工语音，边说边听、可打断（server_vad） |
| 💃 **数字人** | 素材库 + 情绪匹配引擎，情绪驱动选片播放（**零 GPU**）；素材缺失自动降级卡通占位 |
| 📝 **字幕 + 波形** | AI 语音实时字幕（增量缓冲）+ 情绪波形动画（音频能量驱动） |
| 💬 **文本聊天** | REST 文本通道（调试/降级用），人设注入保持一致 |
| 🧠 **复杂事务** | Qwen 发 function_call → 本机 Hermes 干活（50+ 工具）→ 结果语音说出来 |
| 🔀 **错误降级** | Hermes 不可用 → 自动降级纯 Qwen 文本回答（保持人设）；素材缺失 → 卡通兜底 |
| 🔁 **人设切换** | 人设文件化（personas.json 注册表），毫秒级切换，各人设记忆分区隔离 |

## 🏗️ 架构概览

```
浏览器（React 18 + Vite）
  │  WS（音频+控制）        │ HTTP/SSE（文本+状态）
  ▼                          ▼
Express 后端（Core Orchestrator，自研 ~400 行）
  │
  ├── voice-shell  → Qwen-Audio-3.0-Realtime-Flash（云端语音壳：听/说/转写/打断）
  ├── brain        → Hermes Agent v0.20.0（本机大脑：复杂事务执行 + 记忆）
  ├── persona      → 角色卡 → instructions（人设注入，文件化，直读毫秒级）
  └── avatar       → 素材库 manifest + 情绪匹配引擎（数字人，零 GPU）
```

**两条核心路径：**

- **快问快答**：用户语音 → Qwen-Audio 直接答（人设已注入 instructions，模型自带情感化语音）
- **复杂事务**：Qwen 发 `function_call` → Hermes 干活 → 结果文本写回 → Qwen 语音说出

> 详细架构见 [`docs/architecture/overall-architecture.md`](docs/architecture/overall-architecture.md)，模块接口契约见 [`docs/architecture/module-contracts.md`](docs/architecture/module-contracts.md)。

## 🚀 快速开始

### 环境要求

| 依赖 | 版本 | 用途 |
|------|------|------|
| Node.js | 22+ | 后端运行（原生支持 TS strip-types） |
| Hermes Agent | v0.20.0（本机安装） | 大脑（缺失时自动降级纯 Qwen） |
| DashScope API Key | 阿里百炼 | 语音壳（必填） |

### 安装

```bash
# 1. 安装后端依赖（项目根）
npm install

# 2. 安装前端依赖
cd client && npm install && cd ..
```

### 配置

密钥配置有两种方式（**文件优先、环境变量兜底**）：

```bash
# 方式一：编辑 config/apikeys.json（gitignore，不入库）
# 方式二：复制 .env.example 为 .env，按需填写
cp .env.example .env
```

**必填项：**

| 变量 | 说明 |
|------|------|
| `DASHSCOPE_API_KEY` | 阿里百炼 API Key（语音壳连接必需，无值则语音不可用） |

**可选常用项：**

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `HERMES_BIN` | `hermes`（PATH） | hermes 可执行文件路径 |
| `HERMES_PROFILE` | `cyber-girlfriend` | 专用 profile（记忆隔离，勿改） |
| `HERMES_PERSONAS_DIR` | `C:/Users/<user>/AppData/Local/hermes/profiles/cyber-girlfriend/personas` | 人设数据权威源目录 |
| `HERMES_TOOLSETS` | `terminal,file,web` | 工具白名单（不含 memory） |
| `PORT` / `HOST` | `3000` / `localhost` | 后端监听地址 |
| `DASHSCOPE_MODEL` | `qwen-audio-3.0-realtime-flash` | 语音模型 |

> 加载优先级：`config/apikeys.json` > 系统环境变量 > `.env.local` > `.env` > 默认值。完整变量清单见 `config/loader.ts`。

### 启动

**方式一：一键启动（推荐）**——双击项目根目录 `start-dev.bat`：自动启动后端（已在跑则跳过）+ 前端（自动清理残留端口，固定 5173）+ 健康检查就绪后自动用 Edge 打开页面。

**方式二：手动启动**

```bash
# 1. 启动后端（端口 3000，HTTP + WebSocket 同端口）
npm run dev

# 2. 另开终端启动前端（Vite 5173，代理 /api 与 /ws 到后端）
cd client && npm run dev
```

浏览器访问 **http://localhost:5173**，点击「开始语音」即可开聊。

### 快速验证

```bash
# 后端健康检查
curl http://localhost:3000/api/health
# → {"status":"ok"}

# Hermes 可用性
curl http://localhost:3000/api/brain/status
# → {"available":true,"version":"Hermes Agent v0.20.0 ..."}

# 文本聊天（Hermes 正常时走 Hermes；不可用时自动降级纯 Qwen，响应带 degraded:true）
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"1+1等于几？"}'
```

## 📁 项目结构

```
赛博女友/
├── app/                # 🖥️ 应用壳（Express 装配 / REST / WS / SSE / Core Orchestrator）
├── voice-shell/        # 🎙️ 语音壳（Qwen-Audio WS 客户端 / 网关 / 双路分发 / Function Calling）
├── brain/              # 🧠 大脑（hermes-runner 子进程 / function-router / qwen-fallback 降级）
├── persona/            # 💃 人设（PersonaProvider 接口 / FilePersonaProvider 直读）
├── avatar/             # 🎭 数字人（clip-matcher / emotion-matcher / manifest.json 素材清单）
├── client/             # 🌐 前端（React：AvatarCanvas / ChatUI / CaptionBar / VoiceWaveform / hooks）
├── config/             # ⚙️ 配置中心（apikeys.json + loader.ts，密钥集中管理）
├── assets/avatars/     # 🎬 数字人素材（gitignore，由脚本下载）
├── docs/               # 📚 文档中心（BLUEPRINT / TASKS / DEVLOG / WORKFLOW / architecture / adr / tasks）
├── scripts/            # 🛠️ 工具脚本
├── tests/              # ✅ 测试（暂停，恢复时按新架构重写）
├── cybergirlfriend/    # 📦 旧脚手架（迁移源，归档保留）
├── .env.example        # 环境变量模板（入库）
└── PROJECT_MEMORY.md   # 项目记忆
```

## 🧪 自检测试

项目采用**零依赖 node 原生自检**（无测试框架，红线 4 测试/CI 暂停），直接运行：

```bash
# 服务端各模块自检
node --experimental-strip-types voice-shell/function-calling-unit-test.ts
node --experimental-strip-types app/server/orchestrator-degradation-test.ts
node --experimental-strip-types brain/qwen-fallback-test.ts

# 前端核心逻辑自检（client 目录下）
cd client
npm run test:avatar      # AvatarCanvas 纯逻辑 13/13
npm run test:avatar-hook # useAvatar Hook 14/14
npm run test:chat        # ChatUI 消息核心 17/17
npm run test:chat-hook   # useChat Hook 21/21
npm run test:caption     # 字幕缓冲 13/13
npm run test:waveform    # 波形核心 30/30
npm run test:voice       # 语音状态机 67/67
```

类型检查：`npm run typecheck`（根目录 + client 均需通过）。

## ⚠️ 设计红线

1. **无数据库、无持久化、无本地记忆**——事务与记忆归 Hermes
2. **人设归 Hermes 维护**——数据权威在 `HERMES_PERSONAS_DIR`，赛博女友只读
3. **记忆双向隔离**——专用 profile `cyber-girlfriend`，与主 profile 互不污染
4. **文本中转不漂移**——Qwen ↔ Hermes 之间只传纯文本
5. **依赖最小化**——运行时仅 `express` + `ws` 两个纯 JS 依赖，零原生编译
6. **密钥集中管理**——所有密钥走 `config/loader.ts`，源码不硬编码

## 📚 文档索引

| 想了解 | 去哪看 |
|--------|--------|
| 项目全貌（蓝图） | `docs/BLUEPRINT.md` |
| 任务看板与进度 | `docs/TASKS.md` |
| 开发日志 | `docs/DEVLOG.md` |
| 工作流规则 | `docs/WORKFLOW.md` |
| 新聊天框任务入口 | `docs/TASKS-CONFIG.md` |
| 模块接口契约 | `docs/architecture/module-contracts.md` |
| 架构总纲 | `docs/architecture/overall-architecture.md` |
| 决策记录（ADR） | `docs/adr/README.md` |
| 详细设计 | `DESIGN.md` |
| 老板定稿混合架构方案 | `混合架构方案-云端语音壳+本地大脑.md` |
| 项目记忆 | `PROJECT_MEMORY.md` |

---

*赛博女友 · v0.1.0 · 纯交互界面 · 云端语音壳 + 本地 Hermes 大脑*

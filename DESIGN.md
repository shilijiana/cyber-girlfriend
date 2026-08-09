# DESIGN.md — 赛博女友详细技术设计（v0.6 评审稿）

> 状态：**M1 施工中**。老板已确认方案并开工。
> 老板已拍板：① S2S 用**云端 API** ② 数字人改走**预生成素材库 + 模仿说话**（口型大致同步即可，**运行时零 GPU**）③ 先出设计文档再动手。
> 2026-08-09 v0.2：按老板意见，实时视频口型（MuseTalk/LatentSync）降级为**可选增强**与**离线素材生成工具**，默认数字人方案改为素材库。
> 2026-08-09 v0.3：新增 **§14 Git 版本控制规范**（初始化 / .gitignore / 提交信息规范 / 分支管理）。
> 2026-08-09 v0.4：**S2S 默认 Qwen 端到端**（其余厂商写预留接口，按需再加）；采纳功能增删评审——新增长期记忆/字幕/情绪波形，删除 WebRTC 视频推流与 Provider 收敛，VSCODE/CODEX、MuseTalk sidecar、PWA 等延后（见 §15）。
> 2026-08-09 v0.5：**§11 扩展为完整自动化测试设计**（Vitest + Playwright + GitHub Actions CI + 覆盖率报告），并随 M1 脚手架一起落地。
> 2026-08-09 v0.6：新增 **§16 依赖与国内源策略**（依赖最小化 + pnpm 国内镜像 + 依赖清单见 DEPENDENCIES.md），解决本机 npm 挂起问题。

---

## 1. 目标与非目标

### 目标
- 端到端语音大模型（S2S）实时语音对话：语音进 → 模型直接出语音，**无中间文本转录**。
- 数字人**模仿说话**：预生成短视频素材库，对话时按情绪/内容选片播放，口型与语音**大致同步**（不追求逐帧对齐），**运行时零 GPU**。可选增强：MuseTalk 实时口型（需 GPU）。
- MCP 集成：v0.1 接 **Work Buddy + Hermes** 两个（VSCODE/CODEX 延后 v0.2，见 §15），女友能调用外部工具。
- 完整初始化代码、配置、使用说明、测试与运行文档。

### 非目标（v0.1 不做）
- 不做移动端原生 App（Web 优先，可 PWA）。
- 不做多模态视频输入（如摄像头视觉），后续可扩展。
- 不承诺绝对零文本——**语音对话主链路无文本**，但工具调用/日志内部仍会有文本（这是系统内部行为，不是用户可见的"中间转换"）。
- 不做逐帧口型对齐——采用**素材模仿**方案，接受口型近似（老板已确认）。

## 2. 总体架构

```
┌─────────────────────────── 浏览器（React 18 + Vite 5 + TS）──────────────────────────┐
│  聊天 UI（TDesign + SSE）  │  数字人画布（素材视频播放 / 兜底 Live2D）  │  语音（getUserMedia + 播放器） │
└───────────────┬───────────────────────────┬───────────────────────────┘
                │ HTTP / SSE / WebSocket     │ 静态素材 <video> 直接播放
┌───────────────▼───────────────────────────▼───────────────────────────┐
│                    Express 后端（Node + TS，端口 3001）                  │
│  Agent 会话（@tencent-ai/agent-sdk）│ SSE 流式│ 语音网关（WS 中继）│ MCP 注册器 │
└──────┬──────────────────────────────┬──────────────────────────────┬───┘
       │ WebSocket 音频                │ 素材匹配（事件驱动）          │ stdio/http
┌──────▼──────────────┐   ┌───────────▼──────────────┐   ┌─────────────▼──────────────┐
│  S2S 语音 Provider  │   │ 素材库数字人（默认，零GPU）│   │  MCP 服务器（v0.1 接 2 个）  │
│ Qwen 端到端（v0.1）  │   │ 匹配引擎 §5.2            │   │  Work Buddy / Hermes        │
│ 其余厂商预留接口     │   │ MuseTalk sidecar（v2）    │   │  VSCODE / CODEX（v0.2）      │
└─────────────────────┘   └──────────────────────────┘   └──────────────────────────────┘
```

**关键数据流（语音对话 + 素材模仿）**：
1. 浏览器采集麦克风 → `/ws/voice` 二进制音频流 → 语音网关。
2. 网关把音频流转发给当前 S2S Provider（WebSocket API，流式）。
3. Provider 流式返回**语音响应**（音频 chunk + 情绪/副文本事件）。
4. 网关把音频 chunk 回传浏览器播放；同时把**情绪/内容事件**发给素材匹配引擎。
5. 匹配引擎从素材库挑选合适片段 → 浏览器 `<video>` 播放，与语音**起点对齐**、口型大致同步（不逐帧对齐）。
6. （v2 可选增强）有 GPU 时：音频 chunk 同时送 MuseTalk sidecar 生成逐帧口型，无缝替换素材方案。

## 3. 技术选型明细

| 层 | 组件 | 版本/说明 |
|----|------|-----------|
| 脚手架 | codebuddy-chat-web（init-cbc-sdk-web 技能） | React 18、Vite 5、TS、TDesign、Tailwind、Express 4、SQLite |
| Agent | @tencent-ai/agent-sdk | query / unstable_v2_createSession / 权限模式 |
| 流式 | SSE（文本）+ WebSocket（语音/视频控制） | 后端已内置 SSE |
| S2S | **Qwen 端到端（v0.1 默认实现）**，GLM-Realtime 预留备选，其余厂商预留接口 | 阿里云 DashScope，80ms 级延迟、80+ 语言、OpenAI 兼容格式 |
| 数字人（默认） | **素材库模仿说话**（预生成短视频 + 匹配引擎） | 运行时零 GPU；素材离线一次性生成（云 GPU 渲染 / 授权素材 / Live2D 预渲染） |
| 数字人（v2 可选增强） | MuseTalk 实时口型 + LatentSync 高质量轨 | MIT / Apache-2.0；Python FastAPI sidecar，需 NVIDIA GPU（V100/RTX 30 系起） |
| 数字人兜底 | Live2D（pixi-live2d-display）或静态形象+音频能量口型 | 素材缺失时自动降级，保证功能可用 |
| 素材播放 | 静态 `<video>` 直接播放（本地静态文件） | 素材库方案无需 WebRTC/MSE 传输层（已删除） |
| 数据库 | SQLite（脚手架自带） | 会话/消息/语音会话/记忆档案 |
| MCP | SDK `mcpServers` 配置 | v0.1：stdio（Hermes）+ http（Work Buddy）；VSCODE/CODEX 延后 v0.2 |

## 4. S2S 语音 Provider 层（核心抽象）

> 设计原则：**主链路真 S2S**（语音进、语音出），Provider 通过统一接口接入，环境变量切换，不锁死厂商。

```ts
// server/voice/provider.ts
export interface VoiceProvider {
  connect(sessionId: string): Promise<VoiceSession>;   // 建立实时语音会话
  sendAudio(sessionId: string, chunk: Buffer): void;   // 上行用户语音
  onAudio: (chunk: Buffer) => void;                    // 下行 AI 语音（流式）
  onEvent: (evt: VoiceEvent) => void;                  // 可选事件（情绪、字幕副文本、打断等）
  close(sessionId: string): Promise<void>;
}
// v0.1 实现：QwenOmniProvider（默认）
// 预留接口（不实现，按需再加）：GLMRealtimeProvider / SeeduplexProvider / OpenAiRealtimeProvider / GeminiLiveProvider
// 选择：VOICE_PROVIDER=qwen_omni（v0.1）| glm_realtime | seeduplex | openai_realtime | gemini_live（预留）
```

**厂商初评（2026-08 调研，动手时以官方文档复核）**：
- **Qwen 端到端（阿里 DashScope）→ v0.1 默认实现**：80ms 级最低延迟、80+ 语言、兼容 OpenAI 格式、开源生态完善（Qwen3-Omni 同源可自托管）—— 老板拍板首选。
- **GLM-Realtime（智谱）→ 预留备选**：中文语义与长任务口碑好，作为"换一家试试"的第二选项，接口预留、按需再加。
- ~~豆包 Seeduplex / GPT Realtime / Gemini Live~~：**预留接口，v0.1 不实现**（Seeduplex 企业级但接入重；GPT/Gemini 适合英文/全球场景，暂不需要）。
- ~~MiniMax Speech 2.6~~：已确认是**流式 TTS（T2A）+ 音色克隆**，非纯 S2S；可作 TTS 音色库备选，不承担 S2S 主链路。

**人设注入**：S2S 会话初始化时在 system 参数里注入赛博女友人设 + 性格（活泼、会撒娇、靠谱），情绪通过 Provider 事件或音频特征驱动数字人表情（见 §6）。

## 5. 数字人模块设计（默认：素材库模仿说话）

### 5.1 方案对比与结论
| 方案 | 运行时成本 | 口型精度 | 说明 |
|------|-----------|---------|------|
| **素材库模仿说话（默认）** | 零 GPU、低延迟 | 大致同步 | 离线预生成/采集一段说话视频库，对话时按情绪/内容选片播放 |
| MuseTalk 实时口型（可选增强） | 需 GPU（V100/RTX 30 系） | 逐帧对齐 | 单步 latent 修复，256×256 口型区，30fps |
| LatentSync 1.5（可选增强） | 需 GPU（6GB+） | 画质最好 | 扩散模型，适合**离线打磨素材**，也可做高质量回放 |
| Live2D（兜底） | 零 | 能量驱动 | 素材缺失时的保底方案 |

> 老板拍板：**默认素材库方案**，口型"大致对"即可；MuseTalk/LatentSync 仅用于**离线一次性生成素材**，或作为可选实时增强，不要求本机 GPU。

### 5.2 素材库方案（默认，运行时零 GPU）

**素材结构（assets/avatars/）**：
```
assets/avatars/
├── idle/          # 不说话：眨眼、呼吸、微动（2-4 段，各 5-10s）
├── speaking/      # 说话姿态，按情绪分类：
│   ├── happy/     # 开心/撒娇（3-5 段）
│   ├── gentle/    # 温柔/安慰
│   ├── serious/   # 认真/办事
│   ├── surprise/  # 惊讶/卖萌
│   └── neutral/   # 中性（兜底）
├── listening/     # 倾听/点头（2-3 段）
└── manifest.json  # 素材清单：路径、情绪标签、时长、嘴型活跃度
```

**素材怎么来（一次性离线准备，运行时不再需要）**：
1. **云 GPU 一次性渲染（推荐）**：租一台 GPU 机器按小时付费，用 MuseTalk/LatentSync 把"固定台词的短视频"批量生成 20-40 段（不同情绪 × 不同台词模板），导出 mp4/webm 打包进项目。
2. **现成授权素材**：使用已授权的人物视频 / 开放素材裁剪分段（注意肖像与商用授权）。
3. **Live2D 预渲染**：用 Live2D 动画导出序列帧/视频，无真人版权问题。

**开发期占位素材策略（老板选定：先占位后补素材）**：
- **占位 A**：开源免费样片（授权允许商用的视频站素材）剪 3-5 段循环播放，验证"画布 + 匹配 + 切换"整条链路。
- **占位 B**：内置一个简单卡通形象（CSS/SVG 或轻量 Live2D），用**音频能量驱动嘴部开合**，快速验证"说话感"。
- **后补真实素材**：云 GPU 渲染真实形象素材库后，直接替换 `assets/avatars/` 即可——`manifest.json` 结构不变，**前端零改动**。

**匹配引擎（server/avatar/clip-matcher.ts）**：
- 输入：S2S Provider 返回的**情绪事件 + 副文本片段**（仅系统内部用于匹配，不展示给用户）；无事件时退化为音频能量/语速粗分类。
- 逻辑：情绪 → 对应 speaking 子库 → 随机/轮换选片（避免重复感）→ 拼接队列。
- 播放：片段间交叉淡入淡出；说完切回 idle；片段播完还没说完则循环同情绪片段。
- 对齐：只保证**起始点对齐**语音播放起点，后续口型大致同步（老板已接受）。

### 5.3 实时口型 Sidecar（v2 可选增强，v0.1 不开发）

> **决策记录**：v0.1 只做素材库方案，sidecar **降为纯设计保留、v2 再实现**——素材库已满足"口型大致对"的需求，sidecar 吃 GPU 且要维护 Python 服务，现阶段性价比低。

```
avatar-sidecar/  (FastAPI, v2 组件, 无 GPU 不启动)
├── app.py              # FastAPI: /health /sync/start /sync/audio /sync/frame /model
├── musetalk_worker.py  # MuseTalk 流式推理：音频 chunk → 口型帧
├── latentsync_worker.py# LatentSync 高质量轨（离线素材生成 / 准实时队列）
├── reference/          # 形象照片/短视频（驱动素材）
└── requirements.txt    # torch, musetalk, fastapi, websockets
```
- 启用时：音频 chunk 双路分发（播放 + sidecar），侧信道帧流经 `/ws/avatar` 推浏览器，无缝替换素材方案。
- 未启用时：该服务不存在，主应用完全自洽（素材方案照跑）。
- v0.1 中 sidecar 唯一实际用途：**离线批量生成素材库视频**（云 GPU 一次性跑），运行期不启动。

### 5.4 与 S2S 的协同
- 素材方案：语音流实时播放，匹配引擎按事件选片，**起点对齐 + 大致同步**，无逐帧管线负担。
- 打断（barge-in）：网关发 interrupt → 停止语音 + 停止素材播放 + 切回 idle。
- 表情联动：idle 段自带眨眼/呼吸；speaking 片段自带表情，情绪标签即表情切换。
- （可选增强）实时口型时：同一音频双路分发 + 200ms 起始缓冲对齐 + 打断清队列。

## 6. MCP 集成设计（SDK mcpServers）

CodeBuddy Agent SDK 官方支持 `mcpServers`（stdio / http / sse 三种传输），可传对象或配置文件路径（文档：codebuddy.ai/docs/zh/cli/sdk-mcp）。统一在 `server/mcp-servers.ts` 维护，示例：

```ts
// server/mcp-servers.ts —— 实际命令/参数动手时按各官方文档最终确认
// v0.1 只启用 workbuddy + hermes；vscode/codex 为 v0.2 预留模板（配置保留但注释掉）
export const mcpServers = {
  'workbuddy': {           // Work Buddy：平台能力走 HTTP endpoint（v0.1 启用）
    type: 'http',
    url: process.env.WORKBUDDY_MCP_URL,          // 按 WorkBuddy 平台提供的网关地址填
    headers: { 'Authorization': `Bearer ${process.env.WORKBUDDY_MCP_TOKEN}` },
  },
  'hermes': {              // Hermes agent（NousResearch）：本地 stdio（v0.1 启用）
    type: 'stdio',
    command: process.env.HERMES_BIN ?? 'hermes',
    args: ['mcp'],         // 以 Hermes 官方 MCP 模式文档为准
  },
  // vscode: { ... }       // v0.2 启用：与 SDK 自身能力重叠，延后
  // codex: { ... }        // v0.2 启用：依赖 OpenAI 账号，延后
};
```
- 接入后：`query({ prompt, options: { mcpServers } })`；工具调用过程通过 SSE 回传前端，UI 复用脚手架的 ToolCallsCollapse 展示。
- **健康检查**：`GET /api/mcp/status` 返回**已启用 MCP**（v0.1 为 2 个）的在线状态（启动时探测 tools 列表），老板可在设置页看到"女友的技能面板"。

## 7. 接口定义（v0.1）

### REST
| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/chat | 文本聊天（同步） |
| GET | /api/chat/stream | SSE 流式聊天（脚手架自带） |
| GET | /api/sessions / POST /api/sessions | 会话管理（脚手架自带） |
| GET | /api/mcp/status | 已启用 MCP 健康状态（v0.1：Work Buddy + Hermes） |
| GET | /api/avatar/status | 数字人引擎状态（clip_library 默认 / live2d 兜底） |
| GET/POST | /api/memory | 长期记忆档案查询/写入（新增，见 §15） |

### WebSocket
| 路径 | 方向 | 协议 |
|------|------|------|
| /ws/voice | 浏览器 ↔ 后端 ↔ Provider | JSON 控制（start/stop/interrupt）+ 二进制音频（16k/32k PCM 或 Opus）+ 字幕副文本事件 |
| /ws/avatar | 后端 → 浏览器 | 仅 v2 MuseTalk sidecar 启用时使用（帧流 `{frame, ts, emotion}`）；v0.1 素材库走静态 `<video>`，**不需要此通道** |

## 8. 数据模型（SQLite，脚手架 db.ts 扩展）

```
sessions(id, agent_id, created_at)                      -- 脚手架已有
messages(id, session_id, role, content, type, created_at) -- type: text|voice
voice_sessions(id, session_id, provider, status, started_at, ended_at)
avatar_config(id, engine, model_path, reference_asset, updated_at)
memories(id, key, value, source, created_at, updated_at) -- 长期记忆档案（新增，§15）
```

## 9. 目录结构（最终形态）

```
cybergirlfriend/
├── server/
│   ├── index.ts              # Express + SSE + 路由装配
│   ├── db.ts                 # SQLite（voice_sessions / memories 等表）
│   ├── memory.ts             # 长期记忆档案读写 + 摘要入库（§15）
│   ├── mcp-servers.ts        # MCP 配置（v0.1 启用 Work Buddy + Hermes，§6）
│   ├── voice/
│   │   ├── gateway.ts        # /ws/voice 中继 + 双路分发（播放/素材匹配/字幕）
│   │   └── providers/        # qwen-omni.ts（v0.1 实现）+ glm-realtime.ts 等预留
│   └── avatar/
│       ├── clip-matcher.ts   # 素材匹配引擎（§5.2，默认方案）
│       └── sidecar-client.ts # v2 预留：与 Python sidecar 的 WS 客户端
├── src/
│   ├── components/
│   │   ├── AvatarCanvas.tsx  # 素材 <video> 画布 / Live2D 兜底
│   │   ├── CaptionBar.tsx    # 字幕显示（S2S 副文本，§15）
│   │   ├── VoiceWaveform.tsx # 情绪波形动画（§15）
│   │   └── McpStatusPanel.tsx# 女友技能面板
│   ├── voice/audio.ts        # getUserMedia 采集、播放、能量分析
│   ├── hooks/useVoice.ts     # 语音会话状态机
│   └── hooks/useAvatar.ts    # 素材播放控制 + 对齐
├── avatar-sidecar/           # Python 数字人推理服务（v2 预留，§5.3）
├── assets/avatars/           # 素材库：idle/speaking(情绪分类)/listening + manifest.json（§5.2）
├── tests/
│   ├── setup-env.ts          # 测试环境变量预置
│   ├── unit/                 # 单元测试（纯逻辑，如 clip-matcher.test.ts）
│   ├── integration/          # 集成测试（Express API + SQLite）
│   ├── e2e/                  # Playwright 端到端
│   └── fixtures/             # 测试固定数据
├── scripts/
│   ├── fetch-avatars.sh      # 素材下载脚本（大文件不入 Git，见 §14.2）
│   └── aggregate-report.mjs  # 测试报告聚合（§11.5）
├── .github/workflows/ci.yml  # CI：push/PR 自动跑测试（§11.4）
├── vitest.config.ts          # 单元/集成测试配置（§11）
├── playwright.config.ts      # E2E 测试配置（§11）
├── .gitignore                # Git 忽略规则（§14.2）
├── .env.example
├── README.md                 # 使用说明
└── DEVELOPMENT.md            # 开发指南
```

## 10. 环境变量（.env.example 草案）

```bash
CODEBUDDY_API_KEY=          # 必填
VOICE_PROVIDER=qwen_omni    # v0.1: qwen_omni；glm_realtime/seeduplex/openai_realtime/gemini_live 预留
DASHSCOPE_API_KEY=          # 阿里云 DashScope（Qwen 端到端，v0.1 必填）
GLM_API_KEY=                # 智谱 BigModel（GLM-Realtime 备选，预留）
# ARK_API_KEY=              # 火山引擎 Seeduplex（预留）
# OPENAI_API_KEY=           # GPT Realtime（预留）
# GOOGLE_API_KEY=           # Gemini Live（预留）
AVATAR_ENGINE=clip_library  # clip_library(默认)|live2d(兜底)
# AVATAR_SIDECAR_URL=ws://127.0.0.1:8765   # v2 启用
WORKBUDDY_MCP_URL=          # Work Buddy 网关（按平台提供，v0.1 启用）
WORKBUDDY_MCP_TOKEN=
HERMES_BIN=hermes           # v0.1 启用
# CODEX_BIN=codex           # v0.2 启用
```

## 11. 自动化测试设计（老板要求，v0.5 扩展）

### 11.1 框架选型
| 层级 | 框架 | 理由 |
|------|------|------|
| 单元测试 | **Vitest** + @vitest/coverage-v8 | 与 Vite 5 同生态、TS 原生、快；内置覆盖率 |
| 集成测试 | **Vitest**（Node 环境直连 Express 服务） | 同一套工具链，覆盖 API/数据库/Provider mock |
| 端到端（E2E） | **Playwright** | 真实浏览器跑 UI 全流程（文本聊天→语音→字幕→工具调用） |
| CI | **GitHub Actions**（.github/workflows/ci.yml） | push/PR 自动触发，无需额外服务 |

### 11.2 目录与命名规范（可维护性）
```
tests/
├── unit/           # 单元测试：就近原则可放 src 同目录 *.test.ts，纯逻辑用例放这里
├── integration/    # 集成测试：起 Express + SQLite（内存/临时库），测 API 与数据库
├── e2e/            # Playwright：浏览器全流程
└── fixtures/       # 测试固定数据（mock 音频 chunk、素材 manifest 样例等）
scripts/aggregate-report.mjs  # 聚合 Vitest JSON + Playwright JSON → 汇总报告
```
- **命名规范**：测试文件 `<模块>.test.ts`；用例 `describe('模块名', ...)` + `it('应...（期望行为）', ...)`，**中文描述、动词开头**，一眼看懂测什么。
- **边界命名**：`it('应在音频流为空时返回 0，不抛异常')` 这类显式覆盖边界。
- 与 Git 规范呼应：测试改动提交用 `test: 补充...` / `test(voice): ...`。

### 11.3 测试命令（可自动运行）
```bash
npm test                  # 单元 + 集成（CI 主命令）
npm run test:unit         # 仅单元测试
npm run test:integration  # 仅集成测试（自动起临时 Express + SQLite）
npm run test:e2e          # Playwright 端到端（自动 build + 起服务）
npm run test:coverage     # 单元+集成，带覆盖率（v8），输出 HTML + JSON
npm run test:all          # 全覆盖（coverage + e2e），本地完整验证
npm run report            # 聚合生成 test-summary.md（通过率/失败详情/覆盖率）
```
> 语音集成连通脚本保留：`npm run test:voice`（真实 Qwen API，输出首包/稳定延迟/字幕事件，需 DASHSCOPE_API_KEY）。

### 11.4 CI 自动触发（.github/workflows/ci.yml）
- 触发：`push`（main + 任意分支）、`pull_request`。
- 任务：`test`（node 20/22 → npm ci → typecheck → `npm run test:coverage` → 上传 coverage/ 产物）与 `e2e`（build → 起服务 → Playwright → 上传 playwright-report/）。
- **每次代码变更自动验证**，未通过即红，老板一眼看出哪坏了。

### 11.5 测试报告（通过率 / 失败详情 / 覆盖率）
- **单元/集成**：Vitest JSON 报告（tests/failed/通过率）+ coverage/coverage-summary.json（覆盖率统计）。
- **E2E**：Playwright JSON（tests/passed/failed/flaky + 失败截图）。
- **汇总**：`npm run report` → `test-summary.md`：总通过率、失败用例清单（文件+行+报错摘要）、分支/函数/行覆盖率，CI 里作为 Summary 展示，本地也能直接看。

### 11.6 覆盖范围清单（对应"核心模块 + 业务逻辑 + 关键路径 + 边界"）
| 层级 | 手段 |
|------|------|
| 单元 | Provider 适配层 mock（Qwen 预留接口）、语音网关双路分发、记忆档案读写、素材匹配引擎（情绪→片段）、MCP 配置加载、字幕事件解析 |
| 集成 | Express API（/api/chat、/api/memory、/api/mcp/status）、SQLite 会话/记忆持久化、异常流程（无效请求/服务未启动/Provider 超时） |
| 数字人 | 素材匹配正确率、片段衔接（无重复感）、无素材降级 Live2D |
| 记忆 | 摘要入库正确性、system prompt 注入后"记得老板喜好" |
| MCP | 已启用 MCP 连通、工具调用打点 |
| E2E | 打开页面→文本聊天→语音会话→口型动起来→字幕可见→工具调用可见（正常流程）；断网/无 API Key 的异常与边界流程 |
| 人工 | 延迟手感、打断体验、口型观感、记忆感（老板亲自验收 🎀） |

## 12. 里程碑

- **M1 脚手架**：`git init` + .gitignore + init-cbc-sdk-web 生成项目 → 跑通文本聊天 → **Work Buddy + Hermes 两个 MCP** 配置 + 连通性测试 → Tag `v0.1.0-m1`。
- **M2 S2S 语音**：Provider 抽象 + **Qwen 端到端** + 浏览器麦克风/播放 + 打断 + **字幕显示 + 情绪波形** → Tag `v0.1.0-m2`。
- **M3 数字人 + 记忆**：素材库构建（含 manifest）+ 匹配引擎 + 浏览器画布播放 + **长期记忆档案** → Tag `v0.1.0-m3`。
- **M4 体验**：片段衔接优化、降级策略（无素材→Live2D）、设置页 → Tag `v0.1.0-m4`。
- **M5 收尾**：README/DEVELOPMENT 文档、全套测试、部署说明 → Tag `v0.1.0-m5`。
- **v0.2 展望**（不阻塞 v0.1 交付）：VSCODE/CODEX MCP、主动问候、语音消息回放、形象切换、PWA；**v2**：MuseTalk sidecar 实时口型。

## 13. 风险与权衡（跟老板交底）

1. **素材模仿的取舍**：口型只"大致对"，片段复用有轻微重复感（轮换+随机化缓解）；换来**运行时零 GPU、零 sidecar、低延迟** —— 老板已认可。
2. **素材准备是一次性成本**：推荐云 GPU 按小时渲染 20-40 段；也可用授权素材或 Live2D 预渲染，三选一即可开工。
3. **S2S 依赖阿里云 DashScope**：语音数据过第三方，注意隐私与成本；Provider 接口保证可切换（GLM-Realtime 预留），需要私有化时可换开源 Qwen3-Omni 自托管。
4. **音画起点对齐**：素材方案只保证起始对齐 + 大致同步；追求逐帧口型时 v2 启用 MuseTalk 增强（需 GPU）。
5. **MCP 权限**：v0.1 只有 Work Buddy（办公）+ Hermes（agent），风险可控；v0.2 接入 VSCODE/CODEX 时它们有文件/终端能力，必须走脚手架的权限模式（默认只读/逐次确认），防止女友乱动老板的电脑。

## 14. Git 版本控制规范

### 14.1 初始化 Git 仓库（M1 第一步执行）
```bash
# 1) 在项目根目录初始化
git init
git branch -M main          # 主干命名为 main

# 2) 创建 .gitignore（见 14.2）后再首次提交
git add .
git commit -m "chore: 初始化赛博女友项目（脚手架 + 设计文档 + Git 规范）"

# 3) 关联远程仓库并推送（远程地址以实际为准）
git remote add origin <repo-url>
git push -u origin main

# 4) 里程碑打 Tag（如 M1 完成）
git tag -a v0.1.0-m1 -m "M1 脚手架 + MCP 集成完成"
git push --tags
```

### 14.2 .gitignore 规则（示例，按项目结构定制）

```gitignore
# 依赖
node_modules/
avatar-sidecar/.venv/
avatar-sidecar/__pycache__/
*.pyc

# 构建产物
dist/
build/
*.tsbuildinfo

# 环境变量与密钥（绝不可入库）
.env
.env.local
*.pem
*.key

# 数据库与本地数据
data/*.db
data/*.db-journal
data/*.db-wal
data/*.db-shm

# 数字人素材（大文件不入 Git：单文件可能 GB 级，超出仓库限制）
assets/avatars/*.mp4
assets/avatars/*.webm
# 素材清单模板入库（manifest.example.json），实际素材通过 scripts/fetch-avatars.sh 下载

# 日志
*.log
npm-debug.log*
*.log.*

# 编辑器 / 系统
.idea/
*.iml
.DS_Store
Thumbs.db
.vscode/*
!.vscode/extensions.json
!.vscode/settings.example.json

# 测试产物
coverage/
playwright-report/
test-results/
```

> **素材大文件策略**：视频素材不进 Git 仓库。`manifest.json`（含下载地址）入库，真实视频由 `scripts/fetch-avatars.sh` 拉取到本地 `assets/avatars/`（该目录整体已在 .gitignore 中忽略）。这样仓库保持轻量，多人协作也不会互相传 GB 级文件。

### 14.3 提交信息规范（Conventional Commits）

**格式**：`<type>(<scope>): <subject>`

**type（必选）**：
| type | 用途 |
|------|------|
| feat | 新功能 |
| fix | 修复 bug |
| docs | 文档（README、DESIGN、注释） |
| style | 格式调整（不影响逻辑） |
| refactor | 重构（不改行为） |
| perf | 性能优化 |
| test | 测试相关 |
| build | 构建/依赖（package.json 等） |
| ci | CI 配置 |
| chore | 杂务（脚手架初始化、gitignore 等） |

**scope（可选）**：`voice`（语音链路）、`avatar`（数字人/素材）、`mcp`（MCP 集成）、`ui`（前端界面）、`server`（后端）、`sdk`（Agent SDK 接入）、`deps`（依赖）

**subject 要求**：
- 动词开头、中文简洁，**≤ 50 字**
- 说"做了什么 + 为什么"，不说"做了什么"的流水账
- 必要时加 body 说明背景/影响

**示例**：
```
feat(voice): 接入 Qwen 端到端 S2S 语音链路
fix(avatar): 修复素材片段切换时画面闪烁（交叉淡入淡出补齐）
docs: 补充 Git 分支规范与提交模板说明
refactor(mcp): 抽离 mcp-servers 配置为独立模块，便于按环境切换
chore: 初始化 Git 仓库并配置 .gitignore
```

### 14.4 分支管理（轻量 Git Flow）

**分支类型**：
| 分支 | 命名 | 说明 |
|------|------|------|
| 主干 | `main` | 稳定可运行，**只接受合并，不直接提交** |
| 功能分支 | `feature/<名称>` | 新功能，如 `feature/voice-gateway` |
| 修复分支 | `fix/<问题>` | bug 修复，如 `fix/avatar-flicker` |
| 杂务分支 | `chore/<任务>` | 依赖升级、配置调整 |

**日常开发流程**：
```bash
# 1) 从最新 main 拉功能分支
git checkout main && git pull
git checkout -b feature/voice-gateway

# 2) 开发 + 按规范小步提交（一次提交只做一件事）
git add server/voice/gateway.ts
git commit -m "feat(voice): 语音网关支持双路分发（播放 + 素材匹配）"

# 3) 合并前同步主干、解决冲突
git fetch origin
git rebase origin/main          # 或 git merge origin/main

# 4) 合并回主干（--no-ff 保留分支历史）
git checkout main && git pull
git merge --no-ff feature/voice-gateway

# 5) 里程碑结束打 Tag
git tag -a v0.1.0-m1 -m "M1 完成"
```

**并行开发防冲突**：语音（voice）、数字人（avatar）、MCP 三个模块目录独立，按模块拉分支即可基本互不干扰；改动共享文件（db.ts、index.ts、.env.example）时先合并再动手，降低冲突概率。

**里程碑与分支对应**：M1~M5 每个里程碑完成即打一个 Tag（`v0.1.0-m1` … `v0.1.0-m5`），随时可回退到任意阶段；老板想"退回上一版看效果"随时可以 `git checkout v0.1.0-mX`。

## 15. v0.4 功能决策记录（功能增删评审结论）

> 评审维度：用户体验 / 功能实用性 / 技术可行性 / 维护成本。

### 15.1 v0.1 新增（低成本高体验，进入本期开发）
| 功能 | 实现方式 | 价值 |
|------|----------|------|
| **长期记忆 / 人设档案** | SQLite `memories` 表（key-value）+ 每轮对话后摘要入库 + 下次会话 system prompt 注入；`GET/POST /api/memory` | 女友记住老板的名字/喜好/聊过的事，陪伴感灵魂 |
| **字幕显示（CaptionBar）** | S2S Provider 副文本事件经 /ws/voice 下发，前端显示"她说了什么" | 静音/嘈杂环境可用；调试时可直接核对内容 |
| **情绪波形动画（VoiceWaveform）** | 前端 AudioAnalyser 分析播放音频能量，动画条随音量起伏 | 画面立刻"活"起来，几乎零成本 |

### 15.2 v0.1 删除（多余或过度设计）
| 项 | 删除理由 |
|----|----------|
| **WebRTC 视频推流（avatar-rtc.ts）** | 素材库方案视频是本地静态文件，`<video>` 直接播放即可，不需要 WebRTC/MSE 传输层；只在 v2 MuseTalk sidecar 时才需要 |
| **5 个 S2S Provider 全实现** | 每家都要适配+测试+维护，成本高；v0.1 只实现 **Qwen 端到端**，GLM-Realtime 预留接口，其余厂商不实现（按需再加） |
| **多 Agent 配置切换** | 项目就一个"赛博女友"人设，脚手架自带的多 Agent 界面简化为单一人设，减少复杂度 |

### 15.3 延后清单（不阻塞 v0.1 交付）
| 功能 | 计划版本 | 延后理由 |
|------|----------|----------|
| VSCODE / CODEX MCP | v0.2 | 与 CodeBuddy SDK 自身文件/终端能力重叠；CODEX 依赖 OpenAI 账号、Hermes 依赖外部安装，变数多 |
| MuseTalk sidecar 实时口型 | v2 | 素材库已满足"口型大致对"；sidecar 吃 GPU 且要维护 Python 服务 |
| PWA 离线 | v1.5 | 体验收益小，Service Worker 缓存/推送复杂度高 |
| 语音消息回放 / 主动问候 / 形象切换 / 音量打断设置 | v0.2~v0.3 | 有价值但非核心路径，等 v0.1 跑通再逐项加 |

---
*设计稿 v0.7 · 2026-08-09 · §17 新增架构变更评估：SillyTavern 式核心对话 + Hermes Agent 工作执行，待老板确认方向*

## 16. 依赖与国内源策略（老板要求 2026-08-09）

### 16.1 依赖最小化原则
- **新依赖准入标准**：① 有明确不可替代的用途 ② 国内镜像源现成可获取 ③ 优先纯 JS/纯 TS（避免原生编译）。
- **原生模块豁免清单**：仅 `better-sqlite3`（有 npmmirror 预编译二进制镜像，无需 node-gyp 编译）。
- **持续瘦身**：M1 收尾前核查并移除未使用的包（候选：@tdesign-react/aigc、less、lucide-react/tdesign-icons-react 二选一、uuid→crypto.randomUUID）。

### 16.2 包管理器与安装方案
- **pnpm 11**（独立 tarball 在 `.tools/pnpm/`），国内镜像自动生效。
- **Windows 注意**：Node 22 的 v8 编译缓存在本机导致 npm/pnpm 启动挂起（`npm install` 无响应）→ 统一 `NODE_DISABLE_COMPILE_CACHE=1`。
- 完整命令与排查见 **DEPENDENCIES.md**。

### 16.3 国内源配置（已固化 .npmrc）
```ini
registry=https://registry.npmmirror.com
better_sqlite3_binary_host=https://npmmirror.com/mirrors/better-sqlite3/
shamefully-hoist=true
```
- 备选源：腾讯云 `https://mirrors.cloud.tencent.com/npm/`。
- Playwright 浏览器：`PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright`。

### 16.4 依赖清单
见 `DEPENDENCIES.md`（运行时 17 个 + 开发依赖明细 + 待瘦身项 + 国内获取方式 + 故障排查）。

---

## 17. 架构变更评估：SillyTavern 式核心对话 + Hermes Agent 工作执行（v0.7 · 2026-08-09）

> 背景：老板认为 CodeBuddy Agent SDK "太重"，要求评估用 **SillyTavern 式轻量核心对话+角色卡** 替代 SDK，语音沟通的文字输出交给 **Hermes agent** 干活。本评估基于实际调研 SillyTavern 源码结构与 Hermes agent v0.20.0 CLI/MCP 能力。

### 17.1 当前 vs 新方案对比

| 维度 | 当前（CodeBuddy SDK） | 新方案（ST 式核心 + Hermes） |
|------|----------------------|---------------------------|
| 聊天引擎 | `@tencent-ai/agent-sdk` 黑盒 | 自研轻量引擎：角色卡 JSON → prompt 组装 → LLM API 直连 |
| 角色/人设 | SDK 内 system message | **角色卡（chara_card_v2 格式）**：name / description / personality / scenario / first_mes / mes_example / system_prompt / post_history_instructions |
| 工作执行 | SDK query + MCP 工具调用 | **Hermes agent**（`hermes -z` one-shot 或 MCP stdio） |
| MCP 集成 | SDK `mcpServers` 配置 | Hermes 自带 `hermes mcp serve`（10 工具） + 50+ 内置工具 |
| LLM 后端 | SDK 绑定的后端 | **任意**（OpenAI / Claude / Ollama / OpenRouter / DeepSeek 等 20+） |
| 依赖重量 | SDK（含内部编译模块） | **纯 HTTP fetch + Python（Hermes）** |
| 可控性 | SDK 黑盒，调试困难 | 全部透明，每一步都能改 |

### 17.2 SillyTavern 核心机制提炼（我们需要的部分）

SillyTavern 本质上就是一个 **角色卡驱动的 LLM 对话前端**，核心流程极简：

```
┌──────────────┐    ┌───────────────┐    ┌─────────┐
│ 角色卡 JSON   │ →  │ Prompt 组装器  │ →  │ LLM API │ → 流式文本回复
│ (人物设定)    │    │ 系统提示词     │    │ (任意)   │
└──────────────┘    │ + 角色描述     │    └─────────┘
                    │ + 对话历史     │
                    │ + 用户消息     │
                    └───────────────┘
```

**角色卡 V2 标准字段**（`chara_card_v2`，我们自研实现）：
- `name`：角色名（"小呆"）
- `description`：角色描述/外貌/身份（支持 W++ 加权语法，可选）
- `personality`：性格特征（逗号分隔的标签或 W++）
- `scenario`：场景背景（"你是老板的私人 AI 助理..."）
- `first_mes`：首次打招呼的消息
- `mes_example`：对话示例（`{{user}}: ...\n{{char}}: ...` 格式），**关键**——教 LLM 说话风格
- `system_prompt`：系统级指令（覆盖默认 prompt）
- `post_history_instructions`：注入在对话历史**之后**的指令（行为约束）
- `creator_notes`：仅元数据，不发给 LLM

**我们复刻的内容**（只做最核心的，不需要 SillyTavern 的完整生态）：
- 角色卡 JSON 文件（`character/silly-dai.json`），用 chara_card_v2 字段 + 自定义扩展
- Prompt 组装器：`server/chat/prompt-builder.ts`——按模板把角色卡字段 + 历史 + 用户消息拼成最终 prompt
- LLM 代理：`server/chat/llm-client.ts`——统一接口对接各种 LLM API（先从 DeepSeek/OpenAI 兼容格式开始）
- 对话管理器：`server/chat/conversation.ts`——历史裁剪、token 计数、摘要触发

### 17.3 Hermes Agent 工作执行能力

**Hermes Agent 关键事实**：
- 语言：Python 3.11+，MIT 协议
- 当前版本：v0.20.0（2026-08）
- 一次性的 `hermes -z "任务描述"` 返回纯文本结果，适合管道捕获
- 内置 **50+ 工具**：终端执行（6 种后端）、文件操作、浏览器自动化、Git 操作
- 原生 **MCP 支持**：`hermes mcp serve` —— 10 个 MCP 工具（对话管理、消息收发、审批）
- 支持 **200+ 模型、33 个 provider**
- **自进化**：从任务中学习，沉淀为可复用技能

**我们怎么用它**：
```
┌──────────────┐                    ┌────────────────────┐
│ 用户语音/文字 │ →  Chat Core 判断   │ 普通聊天 → LLM API │
│              │    意图类型         │                   │
└──────────────┘                    │ 工作任务 → 提取为  │
                                    │ 纯文本指令，发给   │
                                    │ hermes -z "..."    │
                                    └───────┬────────────┘
                                            │ subprocess
                                    ┌───────▼────────────┐
                                    │ Hermes Agent       │
                                    │ (Python, one-shot) │
                                    │ - 文件/终端/浏览器  │
                                    │ - 执行后返回结果    │
                                    └───────┬────────────┘
                                            │ stdout 文本
                                    ┌───────▼────────────┐
                                    │ 结果注入对话上下文  │
                                    │ → LLM 用女友口吻   │
                                    │   转述结果给老板    │
                                    └────────────────────┘
```

**集成方式**（`server/work/hermes-runner.ts`）：
```ts
// 方式一：子进程 one-shot（推荐，简单直接）
const { execFile } = await import('node:child_process');
const result = await new Promise((resolve, reject) => {
  execFile('hermes', ['-z', workInstruction], {
    timeout: 120_000, // 2 分钟超时
    maxBuffer: 1024 * 1024, // 1MB 输出
  }, (err, stdout) => err ? reject(err) : resolve(stdout));
});

// 方式二：Hermes MCP 常驻服务 + MCP 客户端（复杂任务，多轮执行）
// spawn('hermes', ['mcp', 'serve']) → stdio JSON-RPC → 调用 tools
```

### 17.4 新总体架构

```
                        浏览器 (React 18 + Vite 5)
         ┌──────────────┬──────────────┬──────────────────┐
         │ Chat UI      │ Avatar Canvas│ Voice I/O        │
         │ (TDesign)    │ (<video>)    │ (getUserMedia)   │
         └──────┬───────┴──────┬───────┴────────┬─────────┘
                │ SSE/HTTP     │ 静态文件       │ WebSocket
    ┌───────────▼──────────────▼────────────────▼──────────────┐
    │              Express Server (Chat Core)                  │
    │                                                         │
    │  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
    │  │ Character   │  │ Conversation │  │ Memory        │  │
    │  │ Card Mgr    │  │ History Mgr  │  │ Archive       │  │
    │  └──────┬──────┘  └──────┬───────┘  └───────┬───────┘  │
    │         │               │                   │          │
    │         ▼               ▼                   ▼          │
    │  ┌──────────────────────────────────────────────────┐  │
    │  │           Chat Engine (自研)                     │  │
    │  │  - 角色卡注入 / Prompt 组装                      │  │
    │  │  - LLM API 代理 (OpenAI 兼容 / Claude / 等)      │  │
    │  │  - Intent Router: chat vs. work                 │  │
    │  │  - SSE 流式输出                                   │  │
    │  └──────┬───────────────────────┬───────────────────┘  │
    │         │ Chat Request          │ Work Request         │
    │         ▼                       ▼                      │
    │  ┌──────────────┐    ┌──────────────────────┐          │
    │  │ LLM API      │    │ Hermes Runner        │          │
    │  │ (任意后端)    │    │ child_process.exec   │          │
    │  │ DeepSeek /   │    │ hermes -z "..."      │          │
    │  │ OpenAI /     │    │ → 捕获 stdout 结果    │          │
    │  │ Claude / 等  │    └──────────────────────┘          │
    │  └──────────────┘                                      │
    │         │                                               │
    │         ▼                                               │
    │  ┌─────────────────────────────────────────────────┐   │
    │  │ Voice Gateway (ws/voice)                        │   │
    │  │ Qwen S2S 中继 / 字幕事件 / 素材匹配触发         │   │
    │  └─────────────────────────────────────────────────┘   │
    │                                                         │
    │  SQLite (node:sqlite, 零依赖)                           │
    │  sessions / messages / character_cards / memories       │
    └─────────────────────────────────────────────────────────┘
```

### 17.5 依赖变化

| 类型 | 变化 |
|------|------|
| **移除** | `@tencent-ai/agent-sdk`（及 SDK 递归依赖） |
| **移除** | `better-sqlite3`（原生编译模块，换 node:sqlite） |
| **新增** | `dotenv`（.env 加载，Express 自身不带）、`openai`（可选，LLM 调用的便利 SDK，或不加直接用 fetch） |
| **新增** | **Python 3.11+ + Hermes agent**（工作执行器） |
| **保留** | React 18 / Vite 5 / TS / TDesign / Tailwind / Express 4 / Vitest / Playwright |

### 17.6 可行性结论

#### 可行 ✓

| 方面 | 评估 |
|------|------|
| **Chat Core 自研** | 角色卡 JSON → prompt 组装 → LLM API，这个链路非常标准，300-400 行 TypeScript 即可实现核心。SillyTavern 源码已验证这套模式成熟可靠。 |
| **角色卡格式** | chara_card_v2 字段集简洁明确（12 个核心字段），可直接复刻，兼容社区生态（可导入社区角色卡）。 |
| **Hermes 集成** | `hermes -z` 是官方支持的 one-shot 命令，子进程调用即可，不需要运行常驻服务。 |
| **S2S 语音** | 完全不受影响——Qwen S2S 链路是独立的 voice-gateway 模块，只需把语音的副文本注入 conversation history。 |
| **与现有脚手架兼容** | Express + React + SQLite 全部保留，改动在后端的聊天路由（改 query 逻辑），前端基本不变。 |

#### 风险 ⚠️

| 风险 | 等级 | 缓解措施 |
|------|------|----------|
| **意图路由不准** | 中 | 先用关键词 + 简单分类器（"帮我/写/查/找/改" → work），后续加 LLM 轻量分类 |
| **Hermes 执行延迟** | 中 | 设置 120s 超时；复杂任务走流式进度推送（SSE 展示"在干活了..."） |
| **Python 依赖** | 低 | Node 核心零 Python，只有需要"干活"时才用 Hermes；可做成可选功能（无 Hermes 时降级为"这个我还不会"） |
| **Hermes 无上下文** | 低 | `hermes -z` 是 stateless，每次都给完整指令；复杂上下文可把对话摘要附在指令里 |
| **两套 LLM 成本** | 低 | Chat Core 和 Hermes 可以共享同一个 LLM provider（如都用 DeepSeek），不增加成本 |

#### 不可行 ✗

**没有发现阻塞性问题。** 技术上完全可行。

### 17.7 推荐实施计划（如确认此方向）

| 阶段 | 内容 | 产出 |
|------|------|------|
| **P0 核心对话** | 角色卡格式定义 + Prompt 组装器 + LLM 客户端 + SSE 流式 | 文本聊天跑通（替代 SDK） |
| **P1 数据库重构** | better-sqlite3 → node:sqlite + 新建 character_cards/memories 表 | 零编译依赖 |
| **P2 工作集成** | Intent Router + Hermes Runner（子进程） | 女友能干活 |
| **P3 语音回归** | S2S Qwen 网关重接（voice-gateway 已有接口设计） | 语音对话恢复 |
| **P4 数字人+记忆** | 素材库 + 记忆档案（DESIGN §5 + §15，逻辑不变） | 完整女友体验 |

### 17.8 待老板确认

1. **Hermes agent 安装**：需要本机 Python 3.11+，老板能接受吗？还是先用纯 LLM function calling 做 MVP，Hermes 后面再加？
2. **LLM 后端选哪个**：DeepSeek（便宜）、OpenAI（生态好）、Claude（长上下文）、还是 Ollama 本地模型？
3. **P0 先行**：是否先只做"核心对话 + 角色卡"（文字聊天跑通），Hermes 和语音等 P0 确认后再续？

---

*设计稿 v0.7 · 2026-08-09 · 新增架构变更可行性评估（ST式核心 + Hermes 工作执行）*

---

## 18. Qwen3-Omni 语音角色卡调研（2026-08-09）

> 背景：老板需求——类似 SillyTavern 的角色卡文件 → 发给 Qwen3-Omni → 发语音 → 实时返回语音+文字，不需要太高的智商（轻量即可）。本调研基于 GitHub / 阿里云官方文档 / Qwen 官方博客实搜。

### 18.1 核心结论速览

| 结论 | 说明 |
|------|------|
| **角色卡 = system prompt 注入** | Qwen3-Omni 官方明确支持通过 system prompt 定制角色风格、行为（"Customize behavior via system prompts"）。角色卡文件（chara_card_v2 JSON/PNG）→ 解析 → 组装成 system prompt + 对话历史注入，即可实现"角色卡驱动的语音对话"。 |
| **⚠️ 关键坑：Qwen-Omni-Turbo 不支持角色设定** | 阿里云文档明确：Qwen-Omni-Turbo 在输出含音频时**不支持 System Message**——设置"你是XXX"无效，自我认知仍是千问。**只能用 Qwen3-Omni-Flash（或 Qwen3.5-Omni）**。 |
| **SillyTavern 语音是 TTS 后处理，非 S2S** | ST 的语音 = LLM 出文本 → TTS 朗读，不是端到端语音进语音出。我们的场景要的是原生 S2S，不需要复刻 ST 的 TTS 管线。 |
| **不需要太高智商 → 用 Flash/轻量** | Qwen3-Omni-Flash（云端，便宜，20 分钟音频/次）或本地 30B-A3B MoE（3B 激活）都够；不必上 Thinking 变体。 |

### 18.2 云端 API vs 本地部署（两条路线）

| 维度 | 路线 A：DashScope 云端（推荐起步） | 路线 B：本地 vLLM 部署 |
|------|----------------------------------|------------------------|
| 模型 | `qwen3-omni-flash`（2025-12-01 快照） | `Qwen3-Omni-30B-A3B-Instruct`（Apache 2.0） |
| 硬件 | 无需 GPU，仅需 DashScope API Key | 40GB+ 显存（vLLM，MoE 3B 激活） |
| 延迟 | 网络往返（国内节点通常几百 ms~1s+） | 211ms 级（音频场景） |
| 上下文 | 65,536 tokens（max input 49,152 / output 16,384） | 32,768 tokens |
| 音频输入 | 单文件 ≤100MB / 最长 20 分钟；AMR/WAV/3GP/AAC/MP3 | 支持多轮流式输入 |
| 多轮历史 | **assistant 消息只能纯文本**（不能含音频），user 消息可带音频 | 支持完整音频多轮 |
| 成本 | 按 token 计费（flash 便宜） | 电费 + 硬件 |
| 隐私 | 音频过阿里云 | 完全本地 |
| 输出 | 文本+音频（Base64 流式），`modalities=["text","audio"]` | 文本+语音流式 |
| 调用方式 | OpenAI 兼容格式，`stream=True` 必开，仅支持流式 | vLLM OpenAI 兼容 `/v1` 接口 |
| 推荐场景 | 快速验证、个人娱乐、老板没有 40G 显存卡 | 隐私敏感、离线、极致延迟 |

> 结论：**老板的机器大概率没有 40GB 显存（Windows 本机），云端 Flash 是起步最优解**；本地部署作为后续可选（或直接用 ST 社区已有的本地推理方案）。

### 18.3 类似开源项目对比

| 项目 | ⭐ | 技术栈 | 功能 | 优点 | 缺点 | 对咱的参考价值 |
|------|----|--------|------|------|------|----------------|
| **SillyTavern** | 31.8k | Node.js（Express+前端） | 角色卡（chara_card_v2）、世界书、群聊、TTS 扩展、表情 | 角色卡生态最大、社区资源丰富、角色卡格式事实标准 | 语音是 TTS 后处理非 S2S；AGPL-3.0 协议 | 角色卡格式 + Prompt 组装思路（PROJECT_MEMORY §17 已提炼） |
| **Qwen3-Omni 官方仓库** | 3.9k | Python（Gradio web_demo + vLLM） | 全模态输入输出、流式语音、官方 Gradio GUI、多轮音频对话 | 官方维护、模型能力验证、WebSocket Realtime 支持 | 默认 GUI 是通用 demo，无角色卡概念 | 底层调用方式、WebSocket 协议参考 |
| **SGLang-Omni Playground** | - | FastAPI + JS 前端 + SGLang | Realtime WebSocket 语音（VAD 驱动）、多模态输入、文件浏览 | 低延迟、浏览器端 AudioWorklet 采集、16kHz PCM16 | 依赖 SGLang 部署，较底层 | 浏览器语音采集 + WebSocket 流式架构 |
| **Qwen3-Omni-Simple-WebUI**（hama-jp） | - | Python FastAPI + 静态页 + openai SDK | 浏览器麦克风 → DashScope → 语音回复 | 极简、直接调云端 API、uv 管理依赖 | 无角色卡、无多模态复杂功能 | **云端接入最小参考** |
| **run-qwen3-omni**（kissazi2） | - | Node.js + Vite | 多供应商（DashScope/硅基流动/本地）、VAD、多音色、会话管理、录屏对谈 | Node 栈与我们一致、多音色切换 | 代码纯 vibe 冗余多、不生产级 | **Node 侧接入 + 多音色** |
| **gouzi**（jingangdidi） | - | Rust 单文件（18MB） | Qwen3-Omni 语音助手 + 声音克隆 + prompts 注入 | 单文件免安装、**prompts 字段 = 简易角色卡** | Rust 栈、无 GUI 角色卡管理 | 证明"prompt 注入角色"可行 |
| **MiniCPM-o 4.5** | - | Python + llama.cpp/vLLM | 9B 全模态、全双工、音频 system prompt（声音克隆+角色扮演） | 端侧友好（11GB int4）、主动交互、支持音频角色提示词 | 非 Qwen 系（面壁），老板指定 Qwen3-Omni | 备选方案，不主推 |
| **OpenAvatarChat**（Jackjet） | - | Python + FastAPI | 数字人 + Qwen-Omni handler + MuseTalk/LiteAvatar | 模块化、数字人对话一体 | 无角色卡、需 GPU（MuseTalk） | 后续数字人集成参考 |

### 18.4 推荐实现方案（待老板确认）

**目标**：一个轻量 Web 应用：加载角色卡 → 浏览器采集语音 → 流式发给 Qwen3-Omni → 实时返回语音 + 字幕文字。

**架构（延续 PROJECT_MEMORY 决策：TS 单栈、自研 Chat Core）**：

```
浏览器（React/Vite 或极简原生 JS）
 ├─ 角色卡上传/选择（chara_card_v2 JSON/PNG 解析）
 ├─ 麦克风采集（getUserMedia + AudioWorklet，16kHz PCM16/Opus）
 └─ 语音播放（WebAudio）+ 字幕显示（SSE/WS 事件）
        │ WebSocket（音频上行 + 控制）
        ▼
Express 后端（Node + TS）
 ├─ 角色卡解析器 character-card-parser.ts（chara_card_v2 → system prompt）
 ├─ Prompt 组装器 prompt-builder.ts（角色设定 + 对话历史 + 当前语音）
 ├─ Qwen Omni 客户端 qwen-omni-client.ts（OpenAI 兼容，stream=True）
 │    model: qwen3-omni-flash（或 qwen3.5-omni-flash）
 │    messages: [{role:user, content:[{type:input_audio,...},{type:text,...}]}, ...]
 │    modalities: ["text","audio"], audio:{voice, format}
 └─ 流式转发：音频 chunk + 字幕事件 → 浏览器
```

**关键实现点**：
1. **角色卡 → prompt**：解析 `chara_card_v2` 字段（name/description/personality/scenario/first_mes/mes_example/system_prompt），组装成 system prompt + 示例对话（mes_example 用 `{{char}}`/`{{user}}` 模板，同 SillyTavern 语法）。
2. **语音上行**：浏览器把用户语音打包为一段音频（WebM/Opus → 转 base64 或直接传 buffer），Qwen3-Omni Flash 每次请求传 1 个音频文件 + 文本。
3. **流式输出**：`stream=True` 返回 delta：文本（字幕）+ 音频（Base64 chunk），后端转发前端即时播放。
4. **多轮**：历史里 user 轮保留音频（或降级为文本摘要），assistant 轮纯文本 —— 符合 API 限制。
5. **轻量**：不需要太高的智商 → 用 flash；不必开思考模式（思考模式不输出音频）。

**待老板拍板**：
1. **云端 vs 本地**：默认推荐云端 `qwen3-omni-flash`（免 GPU、便宜、接入最快）；本地 vLLM 需要 40GB+ 显存，作为后续可选项。
2. **前端形态**：① 在现有 cybergirlfriend 里加一个"语音角色卡"页面；② 独立小应用（极简 HTML/JS，最快跑通）。
3. **角色卡来源**：需要先做一个"小呆"角色卡（或老板给角色卡文件）；可兼容社区 chara_card_v2（如 chub.ai 下载的卡）。
4. **角色卡格式**：复刻 chara_card_v2（兼容社区生态）还是自定义精简格式？

---
*设计稿 v0.8 · 2026-08-09 · 新增 §18 Qwen3-Omni 语音角色卡调研（云端/本地路线 + 7 个开源项目对比 + 推荐方案），待老板拍板*

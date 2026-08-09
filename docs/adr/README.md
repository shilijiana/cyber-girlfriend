# 架构决策记录（ADR）

> 本目录按 ADR 规范记录赛博女友项目的关键架构决策。每条 ADR 说明 **Context（为什么）→ Decision（决定什么）→ Consequences（代价与收益）**，是后续所有开发的事实依据。

---

## ADR-001: 混合架构 —— 云端 Qwen-Audio 语音壳 + 本地 Hermes 大脑

### Status
Accepted（老板 2026-08-09 拍板定稿）

### Context
- 最初方案用 CodeBuddy Agent SDK 做聊天内核，老板评估后认为"SDK 太重"。
- S2S 语音选型调研（Qwen-Audio-3.0-Realtime / Qwen3-Omni / 豆包 Seeduplex）显示：Qwen-Audio-3.0-Realtime-Flash 专为实时语音对话设计（<120ms、全双工可打断、instructions 角色注入、原生 FunctionCall），是最稳主选。
- 需要"女友能干活"（终端/文件/浏览器等真实操作），这超出了纯 LLM 能力范围。

### Decision
**Qwen-Audio-3.0-Realtime-Flash 当"嘴和耳朵"（语音交互 + 人设快问快答），Hermes agent 当"大脑"（复杂任务执行，50+ 工具），中间用文本衔接（Function Calling 中转优先）。**

- 简单对话：Qwen-Audio 直接答（<1s，人设由 instructions 注入）
- 复杂问题：Qwen 发 `function_call("hermes_brain")` → Hermes 子进程干活 → 结果文本写回 → Qwen 语音+字幕说出

### Consequences
- ✅ 语音体验（<120ms、全双工）与工作能力（50+ 工具）兼得，互不拖累
- ✅ 成本最优：简单对话不烧云 token；复杂任务走本地 Hermes
- ✅ 解耦：Qwen 可换 Seeduplex、Hermes 可换任意模型后端，互不影响
- ⚠️ 复杂任务延迟 1.5-6s，需"稍等"过渡语
- ⚠️ 语音数据过阿里云（隐私权衡，已接受；本地化可切 Qwen3-Omni 开源版）

---

## ADR-002: 弃用 CodeBuddy Agent SDK，自研轻量 Chat Core

### Status
Accepted（老板 2026-08-09 指示，DESIGN §17 评估通过）

### Context
- CodeBuddy Agent SDK 功能强大但体积大、黑盒化，难以按需裁剪与调试。
- 项目的实际需求收敛为：角色卡人设 + LLM API 直连 + 一个工作执行器（Hermes），不需要完整 Agent 框架。

### Decision
**移除 `@tencent-ai/agent-sdk`，聊天内核改为自研 Core Orchestrator（app/server）**：
- persona 模块：角色卡（chara_card_v2）→ instructions 组装
- voice-shell 模块：Qwen-Audio WS 客户端 + 语音网关
- brain 模块：Hermes Runner（子进程 `hermes -z`）
- 数据层用 node:sqlite（零原生依赖）

### Consequences
- ✅ 依赖大幅缩减，全部透明可控
- ✅ LLM 后端自由选择（不再绑定 SDK 生态）
- ⚠️ 自研需要维护（但代码量小，~400 行核心）

---

## ADR-003: 数据库用 node:sqlite（弃用 better-sqlite3）

### Status
~~Accepted（2026-08-09，已验证）~~ → **Superseded by ADR-006**（2026-08-09 本决策作废，见下）

### Context
- 原方案需要本地持久化，better-sqlite3 是原生编译模块（node-gyp），可移植性差、国内源配置繁琐。
- Node 22 内置 `node:sqlite`（DatabaseSync），API 与 better-sqlite3 几乎一致，已验证可用。

### Decision（已被 ADR-006 取代）
~~数据层统一用 node:sqlite（Node 22 内置，零依赖）。~~
**本决策已作废**：赛博女友定位调整为纯交互界面，无本地数据库，故 node:sqlite 不再需要。

### Consequences
- ✅ 技术验证仍有价值（node:sqlite 可用，若未来 Hermes 需要 Node 侧存储可复用）
- ⚠️ 原设计中的 data/ 模块与 schema 已删除

---

## ADR-004: 数字人走素材库模仿说话（弃用实时口型）

### Status
Accepted（老板 2026-08-09 拍板）

### Context
- 真人视频级口型（MuseTalk/LatentSync）对 GPU 要求高，老板电脑不满足。
- 需求降级为"口型大致对即可，运行时零 GPU"。

### Decision
**默认引擎 `clip_library`（素材库）**：离线预生成 idle/speaking(情绪分类)/listening 短视频，运行时匹配引擎按情绪选片播放，起点对齐 + 大致同步。MuseTalk/LatentSync 仅作离线素材生成工具或 v2 可选增强。

### Consequences
- ✅ 运行时零 GPU、低延迟
- ✅ 素材一次准备，前端零改动替换
- ⚠️ 口型只"大致对"，片段复用有轻微重复感（轮换+随机化缓解）

---

## ADR-005: 环境搭建永久暂停（职责边界）

### Status
Accepted（老板 2026-08-09 明确指示，永久生效）

### Context
- 老板明确："环境不用搭建了，不是你负责的事情，本任务永久暂停环境搭建。"

### Decision
**本项目（架构与实现任务）永久暂停环境搭建类工作**：不执行 npm/pnpm install、Python 依赖安装、素材下载（fetch-avatars.sh）、工具链配置等任何环境类操作；DESIGN §16 依赖策略与 DEPENDENCIES.md 仅作历史记录，不再维护更新。环境由老板或外部渠道负责。

### Consequences
- ✅ 职责边界清晰，架构/实现任务专注代码与设计
- ⚠️ 代码只交付不负责跑通环境，联调需老板环境就绪后由对应任务执行

---

## ADR-006: 赛博女友定位为纯交互界面 —— 删除记忆系统与数据库，事务与记忆归 Hermes

### Status
Accepted（老板 2026-08-09 明确指示）

### Context
- 原设计包含 memory（记忆档案）与 data（SQLite 持久化）模块。
- 老板明确："关于记忆系统和数据库这些删除掉，有 Hermes 负责处理。赛博女友项目只是个交互界面，简单的问答，具体的事情有 Hermes 负责。"

### Decision
**删除 memory/ 与 data/ 模块，赛博女友定位为纯交互界面**：
- 不建数据库、不做持久化、不存本地记忆
- 简单问答由 Qwen-Audio 直接答；具体事务交给 Hermes（Hermes 自带记忆系统与 50+ 工具）
- 应用壳与各模块保持无状态，随时可重启/扩展

### Consequences
- ✅ 架构大幅简化：只剩 4 个能力模块 + 1 个支撑层，无持久化负担
- ✅ 职责边界清晰：赛博女友管"界面交互"，Hermes 管"事务+记忆"
- ✅ 无状态服务更易部署、扩展、重启
- ⚠️ 会话上下文不跨请求保留（如需多轮衔接，靠 Qwen 会话窗口或 Hermes 侧记忆）
- ⚠️ ADR-003（node:sqlite）已作废；原 memory/data 设计不再演进

---

## ADR-007: 人设归 Hermes 维护 + APIKEY 集中配置 + 前端轻量化

### Status
Accepted（老板 2026-08-09 指示）

### Context
- 老板明确："persona 人设应该由 Hermes 统一维护，赛博女友仅保留接口定义、切换方式和人设加载地址等抽象接口。"
- 老板要求："新增一个 APIKEY 配置文件，集中保存所有用到的 API 密钥相关信息。"
- 老板要求："审查支撑层和前端代码，找出可优化点，目标是实现轻量级配置，尽量减少依赖和代码体积。"
- 旧脚手架 24 个源文件 ~5316 行，13 个运行时依赖，大量代码与 SDK/DB/多 Agent 强耦合。

### Decision
**三项变更同时落地：**

1. **persona 模块重构**：删除本地角色卡文件（`character-silly.json`）和组装逻辑（`prompt-builder.ts`），改为 `PersonaProvider` 抽象接口——赛博女友只定义"获取人设/切换人设/组装 instructions"的接口，实际数据由 Hermes 维护和提供。`PersonaBuilder` 接口替换为 `PersonaProvider`。

2. **APIKEY 集中配置**：新增 `config/` 目录，包含 `apikeys.json`（实际密钥，gitignore）+ `apikeys.example.json`（模板，入库）+ `loader.ts`（加载器：文件优先、环境变量兜底）。所有模块通过 `import { config } from '../config/loader'` 获取配置。

3. **前端与支撑层轻量化**：
   - 运行时依赖 13 → 5-6 个（删除 SDK/DB/router/TDesign 全家桶/uuid）
   - 前端组件 10 个 3224 行 → 5 个 ~310 行（删除 7 个无关组件，简化 4 个）
   - 服务端 1024 行 → ~269 行（删除 db.ts/mcp-servers.ts，重写 index.ts）
   - 总代码量 ~5316 行 → ~1003 行（-81%）
   - 删除 TDesign 全家桶（4 包），用 Tailwind + 内联组件替代

### Consequences
- ✅ 人设统一管理：换人设只需在 Hermes 侧操作，赛博女友零改动
- ✅ 密钥集中管理：一个文件管所有 key，不再散落各处
- ✅ 依赖极简：5-6 个运行时依赖，全部纯 JS，零原生编译
- ✅ 代码量降 81%，维护成本大幅下降
- ⚠️ 前端 UI 需要自己写少量组件（但有 Tailwind 足够）
- ⚠️ persona 模块依赖 Hermes 子进程获取人设数据（增加一次进程调用，可优化为文件读取）

---

*ADR 目录 · 2026-08-09 · 7 条 ADR（ADR-007: 人设归 Hermes + 配置集中 + 轻量化）*

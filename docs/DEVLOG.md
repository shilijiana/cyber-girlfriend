# 赛博女友 · 开发日志（DEVLOG）

> **按时间倒序记录开发进度、决策、阻塞。最新在最上面。**
> 规则：每条记录写日期 + 做了什么 + 决策 + 阻塞/下一步。简洁不啰嗦。

---

## 2026-08-09（撤销：环境搭建永久暂停 → 恢复执行）

### 做了什么
- 老板指令："环境搭建永久暂停这个去掉。"
- 移除全部文档中的"环境搭建永久暂停"红线：
  - ADR-005 标记 Deprecated（撤销）
  - BLUEPRINT.md：红线表删除该条（10→9 条）
  - TASKS.md：暂停任务表删除该条
  - TASKS-CONFIG.md：红线速查删除该条（补"依赖最小化"）
  - PROJECT_MEMORY.md / DEVLOG.md 同步
- **影响**：子任务可按需执行 npm/pnpm install、依赖安装、工具链配置，交付可运行代码

### 决策
- 环境搭建恢复执行，但仍遵守轻量化约束（运行时 5-6 纯 JS 依赖，ADR-007）
- 保留"测试/CI 暂停"红线（未提及，不动）

### 阻塞 / 下一步
- M1 子任务（BR-01/PS-01 等）可自行安装依赖验证代码

---

## 2026-08-09（整合任务配置：TASKS-CONFIG.md 单文件入口）

### 做了什么
- 老板要求整合分散在 4 个文件的任务说明/上下文 → 产出 **`docs/TASKS-CONFIG.md`**（v1.0）
- 结构：使用说明（说"执行模块 X"即自举）→ 模块列表 → 模块职责 → 模块依赖 → 各模块任务定义（执行入口/输入/预期输出/验收标准）→ 任务速查
- 覆盖 8 个模块（CF/AP/PS/BR/VS/AV/CL/DC）全部任务，接口定义与 module-contracts v1.2 一致
- WORKFLOW.md v1.4：§4.5 入口改为 TASKS-CONFIG.md；BLUEPRINT/TASKS 文档索引加新文件

### 决策
- 新聊天框只读 TASKS-CONFIG.md 即可执行；原三文档 + 契约保留为体系存档
- 模块命名/接口/任务 ID 与现有完全一致，无漂移

### 阻塞 / 下一步
- 待老板新建聊天框执行 BR-01 / PS-01（卡片指令已简化：读 TASKS-CONFIG.md 即可）
- AP-02 任务卡待 BR-01/PS-01 就绪

---

## 2026-08-09（协作模式修正：任务卡模式，老板明确）

### 做了什么
- 老板明确协作模式：**「整体架构」= 当前聊天框（出题/看进度/汇总）**；子任务由老板在项目下**新建独立任务/聊天框**执行，不在当前聊天框里写代码
- WORKFLOW.md v1.3：§4.5 从"派活模板"改为"**任务卡模式**"——架构负责人出任务卡（自包含：背景/接口/验收/参考文档）→ 老板新建任务粘卡片执行 → 执行框汇报 → 架构负责人核对汇总
- 修正我的执行偏差：之前用子代理直接执行子任务，不符合老板模式，已纠正

### 决策
- 协作闭环：小呆出题（任务卡）→ 老板分发（新建聊天框）→ 独立执行 → 小呆批改汇总
- AP-01 已有一版产出（app/server/index.ts + routes.ts，子代理完成），保留作为参考；BR-01/PS-01 转为任务卡模式由老板新建任务执行

### 阻塞 / 下一步
- 向老板交付 BR-01 / PS-01 任务卡 → 老板新建聊天框执行
- AP-02 任务卡待 BR-01/PS-01 就绪后出

---

## 2026-08-09（AP-01 完成：Express 装配与路由骨架）

### 做了什么
- 产出 `app/server/index.ts`：Express 装配（json 中间件 + `/api` 路由挂载 + `/api/events` SSE 骨架 + 条件 listen），导入 `../../config/loader` 的 `config` 驱动 host/port，用 `maskKey` 脱敏打日志
- 产出 `app/server/routes.ts`：`createApiRouter(config)` 路由工厂；`GET /api/health` → `{status:"ok"}`；`chat`/`brain/status`/`avatar/status` 占位返回 501（待 AP-03）
- `docs/TASKS.md`：AP-01 标记 ✅ DONE

### 决策
- 路由用工厂函数注入 config，为 AP-03 复用铺路，符合契约"只依赖接口"
- SSE 骨架独立 `/api/events` 通道（心跳 15s + close 清理），后续 Orchestrator 事件统一走此通道

### 阻塞 / 下一步
- 当时未执行 npm install / tsc 校验（历史：环境搭建红线已撤销，后续可正常安装验证）
- 待 PS-01 / BR-01 就绪后派 AP-02（Core Orchestrator）

---

## 2026-08-09（M1 开工：派发 AP-01 / BR-01 / PS-01）

### 做了什么
- 老板下令"开工 M1" → 按架构负责人角色派活（不自己写代码）
- TASKS.md：AP-01 / BR-01 / PS-01 标记 🔄 IN PROGRESS，M1 里程碑状态改"进行中"
- 用 WORKFLOW §4.5 派活模板，把三个 P0 任务派给对应模块开发者

### 决策
- 三条线并行：AP-01（app Express 骨架）｜BR-01（brain hermes-runner）｜PS-01（persona PersonaProvider 接口）
- 均不依赖老板拍板项（路径A/B、Hermes 模型、人设内容、判定规则——那是 AP-02 之后的事）

### 阻塞 / 下一步
- 等三个模块开发者回报进度 → 汇总给老板
- 就绪后派 AP-02（Core Orchestrator，依赖 AP-01 + PS-01 + BR-01）

---

## 2026-08-09（角色边界明确：架构负责人只派活看进度）

### 做了什么
- 老板明确：本任务是**整体架构**，不负责子任务开发，只需**下达任务 + 看任务进度**
- WORKFLOW.md v1.2：新增 §6.1 架构负责人职责边界（✅做派活/看板/汇总/架构变更，🚫不写子模块代码）
- 项目记忆 MEMORY.md：新增"角色边界"章节固化

### 决策
- 开工方式 = 用派活模板（§4.5）把任务派给子代理，然后盯 TASKS.md 进度、向老板汇总
- M1 开工即派 AP-01 / BR-01 / PS-01，不自己动手写代码

### 阻塞 / 下一步
- M1 待派：AP-01（Express 骨架）→ BR-01 / PS-01（并行）→ AP-02（Orchestrator）
- M1 阻塞项待老板拍板（路径A/B · Hermes后端模型 · 小呆人设 · 判定规则）

---

## 2026-08-09（派活模板写入 WORKFLOW + GitHub 开源上线）

### 做了什么
- 老板问"子任务读哪个文件能自主执行" → 明确入口为 `docs/WORKFLOW.md`（自举入口，§2.1 流程导航）
- WORKFLOW.md 升级 v1.1：新增 §4.5 派活模板（模板 A 一句话版 / 模板 B 完整版 + 占位符示例 + 派活注意）
- GitHub 开源上线：`shilijiana/cyber-girlfriend`（Public），SSH key 方案推送 81 文件成功
- 排障经验：GitHub 推送受阻 → 连接器只读（403）→ fine-grained PAT 缺写权限（403）→ **本机 SSH key + 公钥入库** 一步到位

### 决策
- 子任务执行入口 = WORKFLOW.md（自举），派活模板 A 为底线、模板 B 加速
- GitHub 认证优先走 SSH（不依赖连接器权限/token）

### 阻塞 / 下一步
- M1 阻塞项不变（路径A/B · Hermes后端模型 · 小呆人设 · 判定规则）

---

## 2026-08-09（模块优先级排名 + 素材匹配方案确认 + Git 初始化）

### 做了什么
- 老板确认素材匹配引擎方案 ✅（clip-matcher 三函数 + 五情绪素材库 + 零 GPU + MuseTalk 预留）
- 对所有功能模块做优先级排名：config(1) → app(2) → persona(3) → brain(4) → voice-shell(5) → avatar(6) → client(7) → docs(8)
- 更新 TASKS.md v1.1：新增模块优先级排名章节、修正依赖关系图（PS-01/PS-02 改 PersonaProvider 版）、AV 任务标注方案已确认
- 更新 BLUEPRINT.md v1.1：模块清单加排名、技术栈 TDesign→Tailwind、M3 标注方案已确认
- Git 初始化 + .gitignore（CF-02 完成）+ 首次提交

### 决策
- 排名依据：依赖拓扑位置 + 核心体验贡献度（语音+人设+数字人）+ 风险先行
- persona 排在 brain 前：Orchestrator 依赖 persona 注入 instructions；BR-01 无依赖可与 PS-01 并行
- avatar 定为 P1 排在 voice-shell 后：依赖语音情绪事件驱动，方案已确认可提前备料（素材/清单）

### 阻塞 / 下一步
- M1 阻塞项不变（路径A/B · Hermes后端模型 · 小呆人设 · 判定规则）
- M1 开工即可并行铺两条线：PS-01 接口 + BR-01 hermes-runner

---

## 2026-08-09（架构优化：persona 归 Hermes + APIKEY 集中配置 + 轻量化）

### 做了什么
- 审查旧脚手架全部源码（24 文件 ~5316 行，13 运行时依赖）
- persona 模块重构：PersonaBuilder → PersonaProvider 抽象接口，人设数据归 Hermes
- 新增 config/ 目录：apikeys.example.json + loader.ts（文件优先、环境变量兜底）
- 前端轻量化方案：删除 7 个无关组件 + TDesign 全家桶，代码量 -81%
- 产出 `docs/architecture/optimization-report.md`（完整优化报告）
- 更新 module-contracts.md v1.2（PersonaProvider 接口 + 配置集中管理约束）
- 新增 ADR-007（人设归 Hermes + APIKEY 集中 + 轻量化）
- 更新 TASKS.md（persona 任务重构、新增 config 任务 CF-01/CF-02）
- 更新 BLUEPRINT.md（红线 10 条、persona 模块描述）

### 决策
- persona 不再本地存储角色卡，改为 HermesPersonaProvider 子进程获取
- APIKEY 集中到 config/apikeys.json，文件优先环境变量兜底
- 删除 TDesign 全家桶（4 包），用 Tailwind + 内联组件
- 运行时依赖 13→5-6 个，总代码 ~5316→~1003 行（-81%）

### 阻塞 / 下一步
- CF-01 已完成（配置文件 + 加载器），CF-02 待更新 .gitignore
- M1 阻塞项不变（路径A/B · Hermes后端模型 · 小呆人设 · 判定规则）
- 老板确认优化方案后开工

---

## 2026-08-09（三文档工作流建立）

### 三文档工作流管理系统上线
- 创建 `docs/BLUEPRINT.md`（项目蓝图）：一站式入口，架构自解释
- 创建 `docs/TASKS.md`（任务看板）：M0~M5 全模块任务清单，含 ID/优先级/依赖/验收标准
- 创建 `docs/DEVLOG.md`（开发日志）：本文件，按时间倒序记录
- 创建 `docs/WORKFLOW.md`（工作流规则）：接任务→读文档→干活→写日志→更看板

**决策**：三文档定位——蓝图管"是什么"、看板管"干什么"、日志管"干了什么"。WORKFLOW 管"怎么干"。

---

## 2026-08-09（历史回填）

> 以下是今天之前完成的工作，按时间顺序回填。

### 架构定稿阶段（M0 完成）

**决策脉络（按时间顺序）：**

1. **项目启动**：老板提出"赛博女友"项目——CodeBuddy SDK + S2S 语音 + 数字人 + 4 个 MCP。先调研后动手。
2. **S2S 选型调研**：MiniMax Speech 2.6（纯 TTS 排除）→ Qwen 端到端 → Qwen3-Omni → **Qwen-Audio-3.0-Realtime-Flash**（老板直觉正确，专为实时语音设计，<120ms、全双工、instructions 角色注入）。
3. **数字人方案**：真人视频口型（GPU 太高）→ **素材库模仿说话**（零 GPU，口型大致对）→ 素材先占位后补。
4. **架构变更**：CodeBuddy Agent SDK 太重 → **弃用 SDK，自研 Core Orchestrator**（~400 行 TS）→ SillyTavern 式角色卡 + Hermes agent 做工作执行。
5. **核心架构定稿**：云端 Qwen-Audio 语音壳 + 本机 Hermes 大脑（混合架构 v2），Function Calling 中转（路径 A 推荐）。
6. **纯交互界面收敛**：删除记忆系统与数据库（ADR-006），事务与记忆全归 Hermes。

**产出文档：**
- `docs/architecture/overall-architecture.md` v1.1（架构总纲）
- `docs/architecture/module-contracts.md` v1.1（模块契约）
- `docs/adr/README.md`（6 条 ADR：混合架构/弃用 SDK/node:sqlite→作废/素材库/环境暂停/纯交互界面）
- `混合架构方案-云端语音壳+本地大脑.md` v2（老板定稿方案）
- `docs/research/` 三份调研报告（Qwen-Audio-3.0-Realtime / Qwen3-Omni / 豆包 Seeduplex）
- 各模块 README.md（voice-shell / brain / persona / avatar / app / client）

**目录结构建立：**
- 按模块建目录：voice-shell/ brain/ persona/ avatar/ app/ client/
- docs/ 中心：architecture/ research/ adr/
- 旧脚手架 cybergirlfriend/ 保留为迁移源

**关键验证：**
- Hermes v0.20.0 已在本机安装（Python 3.13.14，`hermes -z` 可用）
- node:sqlite 在 Node 22.22.2 可用（ADR-003 验证，后因 ADR-006 作废）
- Qwen-Audio Realtime API 文档已核实：instructions / Function Calling / 转写 / VAD 全部有 API 支撑

**阻塞项（待老板拍板）：**
- 中转路径 A/B（默认 A Function Calling）
- Hermes 后端模型（DeepSeek / OpenAI / Ollama）
- 小呆人设具体内容
- DASHSCOPE_API_KEY 申请与实测

**红线确立：**
- 无数据库、无持久化、无本地记忆（ADR-006）
- ~~环境搭建永久暂停~~（ADR-005，已撤销 2026-08-09）
- 测试/CI 暂停
- 文本中转不漂移、语音壳不碰业务、方案先确认再动手

---

## 日志模板（复制使用）

```
## YYYY-MM-DD（简述）

### 做了什么
- 

### 决策
- 

### 阻塞 / 下一步
- 
```

---

*开发日志 v1.0 · 2026-08-09 · 三文档工作流之三：记录做了什么*

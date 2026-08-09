# 赛博女友 · 开发日志（DEVLOG）

> **按时间倒序记录开发进度、决策、阻塞。最新在最上面。**
> 规则：每条记录写日期 + 做了什么 + 决策 + 阻塞/下一步。简洁不啰嗦。

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
- 环境搭建永久暂停（ADR-005）
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

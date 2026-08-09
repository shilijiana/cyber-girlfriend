# 赛博女友 · 开发日志（DEVLOG）

> **按时间倒序记录开发进度、决策、阻塞。最新在最上面。**
> 规则：每条记录写日期 + 做了什么 + 决策 + 阻塞/下一步。简洁不啰嗦。

---

## 2026-08-09（M1 批量验收：AP-02/03/06 + PS-02 + BR-03 完成）

### 做了什么
- 老板确认"部分子任务已完成功能" → 审查全部新产出并实测：
  - **AP-02** Core Orchestrator（orchestrator.ts）：persona 取 instructions → brain 执行 → 返回结果，依赖注入只依赖抽象接口 ✅
  - **AP-03** REST API（routes.ts）：/api/chat 完整链路 + /api/brain/status 探测 + /api/avatar/status 读 manifest ✅
  - **PS-02** HermesPersonaProvider（hermes-persona-provider.ts）：hermes -z 获取/加载/切换人设，JSON 提取容错 + 类型守卫 + voiceConfig 归一化 ✅
  - **BR-03** Hermes 可用性探测（probeHermes）✅
  - **AP-06** 环境变量管理（loader.ts parseDotEnv + .env.local + .env.example）✅
- **端到端实测通过**：POST /api/chat "1+1等于几？" → `"老板～这题小呆会！1+1=2 呀～🌸"`（人设注入 + Hermes 执行，12.7s）；/api/brain/status → `{available:true, version:"Hermes Agent v0.20.0"}`；空消息 → 400
- **M1 文字链路全通**：发消息 → 注入人设 → Hermes 干活 → 返回结果 ✅
- module-contracts.md 升级 v1.2：新增 §2.7 Core Orchestrator 契约
- 更新 TASKS.md / TASKS-CONFIG.md 状态（AP-02/03/06、PS-02、BR-03 → ✅）
- .gitignore 新增临时验证脚本规则（.tmp-probe/、*.tmp.json、tests/_tmp_*.ts）

### 决策
- default-persona-provider.ts 为占位实现（人设数据最终归 Hermes），PS-02 交付后可替换注入，orchestrator 零改动
- 临时验证脚本不入库（符合"跑完即删"规范）

### 阻塞 / 下一步
- M1 剩余：BR-02 function-router（依赖 BR-01✅ + AP-02✅，可开工）
- M2 语音链路：VS-01（依赖 PS-02✅ + API Key）
- M3 数字人：AV-02 manifest.json（无依赖，可开工）

---

## 2026-08-09（AP-02 完成：Core Orchestrator 编排层交付，真实 Hermes 全链路验证通过）

### 做了什么
- 交付 `app/server/orchestrator.ts`（CoreOrchestrator 编排层）+ `app/server/default-persona-provider.ts`（占位人设）
- **契约先行**（红线 4）：module-contracts.md 新增 §2.7 Core Orchestrator 接口（ChatRequest/ChatResult/SwitchResult/依赖注入约定）并细化 §2.1 `/api/chat` 契约，v1.1 → v1.2
- **编排流程**：`chat(message)` = persona 取 instructions → `brainRunner.run({instruction, context:instructions})` → 返回 `{reply, personaId, ok, durationMs, brain}`；依赖注入（只依赖 §2.3 BrainRunner + §2.4 PersonaProvider 抽象接口，type-only imports，零运行时依赖 ADR-007）
- **占位人设**：app 内嵌 DefaultPersonaProvider（小呆，硬编码常量非持久化），PS-02 交付后在 index.ts 装配处一行替换，orchestrator 零改动
- **错误语义**（契约 §3.3）：persona 获取失败 → 上抛转 4xx/5xx；brain 失败 → 不抛错，`ok:false` + 友好降级提示（HTTP 200）
- routes.ts / index.ts 接入编排层（同时统一相对 import 补 `.ts` 后缀，node 原生 type-strip 可跑）
- 验证（node --experimental-strip-types）：mock 冒烟 6 用例全过（编排/切人设/未知人设抛错/brain 失败降级/真实 Hermes `1+1=?` → 小呆口吻回答，durationMs 13396）；tsc strict 零报错（orchestrator + provider）；临时脚本已删

### 决策
- Orchestrator 面向接口编程（构造注入），persona/brain 实现可随时替换，符合"只依赖接口不依赖实现"（契约 §3.1）
- 活跃人设仅内存（`activePersonaId`），无持久化（红线 1），重启回默认
- 占位人设属 app 装配策略，不越权写 persona 模块（PS-02 归 persona）

### 阻塞 / 下一步
- 交付后与 AP-03（REST API）无缝衔接：AP-03 在 `createApiRouter(config, orchestrator)` 签名上实现三接口，实测全通过
- BR-02 function-router（依赖 AP-02 ✅ + BR-01 ✅）；PS-02 HermesPersonaProvider（依赖 PS-01 ✅ + BR-01 ✅，替换占位人设）

---

## 2026-08-09（AP-03 完成：REST API 实现交付，实测全通过）

### 做了什么
- 实现 `app/server/routes.ts` 三个 REST 接口（契约 §2.1）：
  - `POST /api/chat`：走 Core Orchestrator（AP-02 编排层已就位）完整链路 → `{reply, personaId, ok, durationMs}`；message 校验 400、persona 不存在 400、编排异常 500、brain 业务失败 200 友好降级（契约 v1.2 语义）
  - `GET /api/brain/status`：`probeHermes()` spawn `binPath --version`（5s 超时，1MB 上限）→ `{available, version}`
  - `GET /api/avatar/status`：读 `config.avatar.assetsPath/manifest.json` 统计 → `{engine:'clip', clipCount}`，manifest 缺失/损坏降级 0
- 根目录新建最小 `package.json`（type:module + express ^4.18.2，npm install 68 包）——app 模块首个可运行环境，AP-04/CL 后续共用
- 实测验证（`node --experimental-strip-types` 启动 + curl，遵循项目无 tsconfig 惯例）：
  - ✅ `/api/health` → `{status:"ok"}`
  - ✅ `/api/chat` 真实链路 `{"message":"1+1=?"}` → `{reply:"1+1=2 呀，这种小问题可难不倒我～🌸...", personaId:"xiaodai", ok:true, durationMs:12893}`（小呆人设注入生效，persona→brain 串联打通）
  - ✅ `/api/brain/status` → `{available:true, version:"Hermes Agent v0.20.0 (2026.8.3)..."}`
  - ✅ `/api/avatar/status` → `{engine:"clip", clipCount:0}`（assets 暂无 manifest）
  - ✅ 错误路径：空 body / 空白 message → 400；`personaId:"nobody"` → 400 `人设不存在`
  - ✅ 边界：binPath 不存在 → `{available:false}`；临时 manifest 3 条 → `clipCount:3`；无 manifest → `clipCount:0`

### 决策
- brain/status 探测逻辑**自持在应用壳**（probeHermes），不越权写 brain 模块（BR-03 未指派，届时可复用/迁移）
- chat 契约跟随 v1.2：REST 层只做参数校验 + 编排调用 + 错误映射，业务降级文案归 orchestrator
- 保持轻量化：只新增 express 一个运行时依赖（ADR-007 允许 5-6 个纯 JS）

### 阻塞 / 下一步
- AP-04 旧脚手架迁移（依赖 AP-01 ✅，cybergirlfriend/server → app/server，移除 SDK/DB/TDesign）
- AP-05 WS 服务端（依赖 VS-02）；BR-03 Hermes 可用性探测可复用 probeHermes
- 根 package.json 已建，后续 npm scripts（dev/start）可随模块扩展

---

## 2026-08-09（AV-01 完成：clip-matcher 迁移与适配交付）

### 做了什么
- 从 `cybergirlfriend/server/avatar/clip-matcher.ts` 迁移素材匹配引擎到新架构 `avatar/clip-matcher.ts`
- **契约适配**（module-contracts.md §2.5 ClipMatcher）：素材库改**构造注入**（`createClipMatcher(library)` 工厂，接口方法不再传 library）；`buildQueue` 目标时长单位**秒 → 毫秒**（`targetDurationMs`）；参数顺序调整（`buildQueue(targetDurationMs, emotion)`）；类型改名 `AvatarEmotion → Emotion`、`AvatarClip → Clip`（公共共享类型，契约 §3.6）
- 保留核心逻辑：情绪筛选 → 新鲜池随机 → 全播过回退全池轮换 → 无素材返回 null（降级 Live2D）
- **队列语义修正**：素材未耗尽时队列内优先不重复；目标超过素材总时长时允许循环回退全池（DESIGN §5.2「播完还没说完循环同情绪片段」），护栏 100 段防死循环
- 用 `node --experimental-strip-types` 自检：**16/16 通过**（情绪过滤/避重复/全播回退/空库 null/毫秒时长覆盖/循环覆盖/护栏/短目标），临时验证脚本已删除
- 仍遵守红线：纯逻辑零依赖、零 IO、零持久化（红线 1/5）

### 决策
- 迁移产物为**纯 TS 单文件 + 工厂函数**，不引入类（与 brain/hermes-runner 风格一致）
- `Emotion`/`Clip` 类型在 avatar 模块自持（契约 §3.6 公共类型放各模块自持保证兼容）
- 单元测试框架仍暂停，改用 Node 原生 TS 自检脚本验证（符合 BR-01 规格验收方式）

### 阻塞 / 下一步
- AV-02 manifest.json 设计（P0，无依赖）→ AV-04 情绪匹配与轮换（依赖 AV-01，可开工）
- CL-01 AvatarCanvas 前端画布依赖 AV-01，可并行规划

---

## 2026-08-09（PS-01 完成：PersonaProvider 接口定义交付）

### 做了什么
- 交付 `persona/provider.ts`：契约 v1.2 对齐（module-contracts §2.4），导出 `PersonaProvider` 接口（listPersonas/getPersona/buildInstructions/switchPersona）+ `Persona`/`PersonaInfo` 类型 + `voiceConfig`/`postHistoryInstructions` 可选字段
- 附赠 `isPersonaInfo` / `isPersona` 类型守卫（供 PS-02 解析 Hermes 返回 JSON 时校验，零依赖纯函数）
- 验证：tsc strict 模式编译零报错；冒烟测试 4 用例全过（有效/无效 PersonaInfo、有效/无效 Persona）

### 决策
- 纯类型定义 + 类型守卫，零运行时依赖（ADR-007）；不实现具体逻辑，实现归 PS-02 HermesPersonaProvider

### 阻塞 / 下一步
- PS-02 HermesPersonaProvider 已解锁（依赖 PS-01 ✅ + BR-01 ✅）；BR-02 function-router 继续

---

## 2026-08-09（BR-01 完成：hermes-runner.ts 交付 + 实测验证通过）

### 做了什么
- 交付 `brain/hermes-runner.ts`：spawn `hermes -z "任务"` 子进程调用（binPath 取 `config.hermes.binPath` 绝对路径），120s 默认超时（可 `timeoutMs` 覆盖），1MB 输出上限防刷屏，stdout 捕获 trim，错误兜底（spawn 失败 / 非零退出码 / stderr 含 error|traceback|exception）
- 契约对齐 v1.2：导出 `BrainRunner` / `BrainTask` / `BrainResult` + `brainRunner` 适配器 + default export，BR-02 function-router 可直接依赖
- 实测验证（node --experimental-strip-types 原生试跑；项目无 tsconfig，按规格走"或"路线）：
  - ✅ 正常调用 `runHermes({instruction:'1+1=?'})` → `ok:true`，output `"2"`（12.9s，真实 Hermes 调用）
  - ✅ 超时兜底 `timeoutMs:100` → `ok:false`，error `"Hermes 任务超时（>100ms），已终止"`（117ms 触发）
  - ✅ 错误兜底 binPath 不存在 → `ok:false`，error `"无法启动 Hermes：spawn Z:/nonexistent/hermes.exe ENOENT"`
  - ✅ 顺带验证"文件优先"：有 apikeys.json 时 HERMES_BIN 环境变量不生效，正确使用文件内 binPath
- TASKS.md BR-01 → ✅ DONE；TASKS-CONFIG.md §1/§4 同步；PROJECT_MEMORY.md 更新

### 决策
- 相对 import 带 `.ts` 后缀（`../config/loader.ts`）：Node 原生 type-strip 可直接运行，无需构建步骤
- 不引入 typescript/@types/node（BR-01 只产出一个文件，spec 验收"tsc 或 node 试跑"二选一，原生试跑已覆盖行为验证）

### 阻塞 / 下一步
- 下一步：BR-02 function-router（依赖 BR-01 + AP-02）；PS-02 HermesPersonaProvider 已解锁（依赖 PS-01 + BR-01）

---

## 2026-08-09（BR-01 规格产出：hermes-runner 实现文档 + 实测验证）

### 做了什么
- 实测本机 Hermes：v0.20.0，binPath = `C:/Users/chipsine/AppData/Local/hermes/hermes-agent/.venv/Scripts/hermes`，默认模型 deepseek-v4-flash，`hermes -z "1+1=?"` → `2。` ✅
- 产出 `brain/hermes-runner-spec.md`（BR-01 实现规格）：接口定义（BrainRunner 契约）+ 实测参数表 + 参考实现骨架（spawn/超时/输出上限/错误兜底）+ 验收自检表 + 边界红线
- TASKS-CONFIG.md：BR-01 任务卡补充规格文档入口
- config/apikeys.example.json：hermes.binPath 更新为实测绝对路径

### 决策
- binPath 用绝对路径（避免 PATH 差异）；`-z` 一次性任务模式为标准调用方式
- BR-01 交付物 = 实现规格文档，新窗口子任务按文档实现 `brain/hermes-runner.ts`

### 阻塞 / 下一步
- 老板新建聊天框 → 读 `brain/hermes-runner-spec.md` + `docs/TASKS-CONFIG.md` → 实现 BR-01

---

## 2026-08-09（产出可复用任务架构模板）

### 做了什么
- 老板要求把"任务架构 + 单一入口机制"整理成可复用模板 → 产出 **`docs/templates/project-task-template.md`**（v1.0）
- 模板包含 7 大块：模板总览 / 四层任务架构（目标/任务/子任务/协作层）/ 子任务分工表 / 单一入口文件机制（7 段式结构 + 字段设计）/ 变量占位符清单 / 使用说明（7 步套用 + 注意事项）/ 实战参考
- 占位符采用 `{{项目名称}}` 风格，全局可替换
- BLUEPRINT.md 文档索引新增模板条目

### 决策
- 模板从赛博女友实战提炼，保留全部可复用机制（任务卡模式、单一入口、验收标准规则）
- 后续新项目可直接复制套用

### 阻塞 / 下一步
- 老板可按需套用到其他项目
- 项目本身：BR-01/PS-01 待老板新建聊天框执行

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

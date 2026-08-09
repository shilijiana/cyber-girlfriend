# 赛博女友 · 开发日志（DEVLOG）

> **按时间倒序记录开发进度、决策、阻塞。最新在最上面。**
> 规则：每条记录写日期 + 做了什么 + 决策 + 阻塞/下一步。简洁不啰嗦。

---

## 2026-08-09（BR-02 完成：function-router.ts，M1 收官）

### 做了什么
- 老板指示"执行 BR-02"→ 实现 `brain/function-router.ts`（Function Calling 中转器）：
  - `extractFunctionCall(event)`：兼容 3 种下行事件形态（conversation.item.created / response.output_item.done / 顶层 function_call），归一化为协议无关的 `FunctionCall`
  - `handle(call)`：拦截 `hermes_brain` → 解析 arguments（instruction/context/timeoutMs，JSON 解析失败兜底为纯文本 instruction）→ 调 hermes-runner → 序列化 `FunctionCallOutput` 写回；不抛错，未知工具/空 instruction/runner 失败统一 `status:'failed'` + error
  - `buildFunctionCallOutputEvent()`：构造上行 `conversation.item.create`（function_call_output）事件；`hermesBrainTool`：工具 schema（VS-06 注册直接用）
  - 依赖注入：`createFunctionRouter(runner?)` 工厂 + 默认实例；零新依赖（仅 hermes-runner.ts + Node 内置）
- 契约先行（红线 4）：module-contracts.md **v1.4** 新增 §2.8 FunctionRouter（补齐 FunctionCall 公共类型）
- 实测：tsc 零错误；冒烟测试 **12/12 通过**；真实 Hermes `1+1=?` → completed，output `2`，耗时 **8.1s**

### 决策
- router 与协议解耦：WS 收发归 voice-shell（VS-01），router 只做"事件归一化 ↔ 任务执行 ↔ 输出构造"，VS-06 几行代码即可接入
- 失败不抛错：所有失败以 failed 写回（含 error），由 Qwen 转述为友好语音（对齐契约 §2.7 错误语义）
- timeoutMs 上限 120s（与 hermes-runner 默认对齐），防 Qwen 传超大值

### 阻塞 / 下一步
- **M1 里程碑 ✅ 完成**（文字链路全通）
- **M2 语音链路：VS-01**（依赖 PS-02 ✅ + API Key）+ **VS-06**（依赖 BR-02 ✅ + VS-01，工具 schema 已就绪）
- **M3：AV-02 manifest.json**（无依赖，可派）
- CC-01/CC-02 待老板让 Claude Code 执行

---

## 2026-08-09（任务进度全面同步：CF-02/BR-04/BR-05/PS-04 补标完成）

### 做了什么
- 老板要求"更新所有文档，特别是任务进度部分"→ 全面核查实际产出 vs 看板状态，修正 4 项遗漏：
  - **CF-02** ✅（.gitignore 早已含 apikeys 忽略）
  - **BR-04** ✅（orchestrator 已实现超时降级："大脑开小差了...稍后再试试"）
  - **BR-05** ✅（runner 已加 `--profile cyber-girlfriend -t terminal,file,web` + AGENTS.md 已产出）
  - **PS-04** ✅（HM-03 记忆模板已产出）
- M1 里程碑状态更新：**文字链路全通**（AP-01~06 + BR-01/03/04/05 + PS-01~04 全部 ✅），仅剩 BR-02
- 模块排名表同步（config/app/persona/brain 状态更新）

### 决策
- 任务状态以"实际产出 + 实测"为准，看板同步修正
- M1 唯一剩余：BR-02 function-router（依赖 BR-01 ✅ + AP-02 ✅，可开工）

### 阻塞 / 下一步
- **M1 收官：BR-02 function-router**（可派）
- **M2 语音链路：VS-01**（依赖 PS-02 ✅ + API Key）
- **M3 数字人：AV-02 manifest.json**（无依赖，可派）
- CC-01/CC-02 待老板让 Claude Code 执行

---

## 2026-08-09（CC 模块建立：代码审查/依赖审计转 Claude Code）

### 做了什么
- 老板明确：代码审查（HM-04）与依赖审计（HM-05）**非 Hermes 长处**，转 **Claude Code** 执行
- 产出两份**自包含任务文档**（Claude Code 直接执行）：
  - `docs/tasks/CC-01-code-review.md`：审查 8 个核心文件 → 报告 `docs/reviews/code-review-2026-08-09.md`
  - `docs/tasks/CC-02-dependency-audit.md`：依赖/漏洞/配置/密钥审计 → 报告 `docs/reviews/dependency-audit-2026-08-09.md`
- TASKS.md / TASKS-CONFIG.md：HM-04/05 标 ➡️ 转 CC，新增 **CC 模块**（Claude Code 执行者）

### 决策
- 分工原则：**Hermes = 执行型**（守则/角色卡/记忆模板）｜**Claude Code = 深度分析型**（审查/审计）｜子任务框 = 开发型
- CC 任务文档自包含（只读一份即可执行），只诊断不改码

### 阻塞 / 下一步
- 老板后续让 Claude Code 执行 CC-01/CC-02 → 报告落 docs/reviews/ → 小呆核对更新 CC 表

---

## 2026-08-09（HM-03 完成：人设记忆维护模板，对齐 Hermes 记忆机制）

### 做了什么
- 老板指示：先问 Hermes 的记忆系统怎么维护，再按它的模式设计 HM-03
- 查询 Hermes 记忆机制（HM-MEMORY-QUERY 实测）：三层记忆（角色 memory.md / profile MEMORY.md / 主 profile 隔离）+ 小文件全量注入 + 大容量按需检索 + 预算硬顶逼压缩
- 产出 `docs/hm-03-memory-template.md`：收尾指令模板（新事实追加 + 20条/3KB 压缩 + 全局事实上浮）+ memory.md 格式 + 三层边界 + 写入纪律
- TASKS.md / TASKS-CONFIG.md：HM-03 状态 → ✅

### 决策
- HM-03 模板 = Hermes 记忆机制的参数化副本（阈值 20 条/3KB 写死，不靠 LLM 自觉）
- 三层边界：单角色 → 专用 profile MEMORY.md → 主 profile 永不触碰（红线 10）
- 事件驱动（每轮收尾评估），非定时；切换人设不触发记忆写入

### 阻塞 / 下一步
- HM-04 代码审查 / HM-05 依赖审计 待派（可用 kanban 异步模式）
- AGENTS.md §4 收尾指令模板可替换为 HM-03 版（落地项）

---

## 2026-08-09（HM 派活升级：kanban 异步模式 + 文档即状态）

### 做了什么
- 老板问：每次用 Hermes 是否新开对话？能否延续？→ 查询 Hermes 确认机制：`-z` 每次新会话但持久落库；`--resume <id>`/`--continue` 可延续；kanban 支持"派活不阻塞、稍后查"
- 老板明确规则：**①每次完成工作让 Hermes 更新文档 ②小呆通过查文档判断是否完成（文档即状态）**
- 产出 `docs/kanban-usage.md`：kanban 异步派活完整命令序列（create → dispatch → show/list 查询）+ 注意事项
- WORKFLOW.md v1.5：新增 §4.6 Hermes 执行者派活规则（同步 -z / 异步 kanban / 文档即状态）
- TASKS-CONFIG.md：HM 模块派活模式更新 + 文档即状态规则

### 决策
- HM 派活模式：小任务用 `-z` 同步；长任务用 `kanban create` 异步（不阻塞）→ 查文档/kanban show 判断完成
- 文档即状态：Hermes 完成任务必须更新 DEVLOG + HM 表，小呆 grep 查询判断

### 阻塞 / 下一步
- HM-03~06 可按 kanban 模式派发
- 待派：HM-03 记忆维护模板（Hermes 主动接单）

---

## 2026-08-09（HM 模块建立：Hermes 作为子任务执行者）

### 做了什么
- 老板拍板：把 Hermes 当作独立"子任务执行者"，同其他子任务一样建立任务列表和完成情况表
- TASKS.md 新增 **HM 模块**（Hermes 执行者）：HM-01 守则 / HM-02 角色卡 / HM-03 记忆模板 / HM-04 代码审查 / HM-05 依赖审计 / HM-06 文档一致性
- TASKS-CONFIG.md 同步：模块列表 + HM 任务定义 + 速查表
- 已派第一批任务给 Hermes：HM-01（AGENTS.md 行为守则）+ HM-02（三份人设角色卡）

### 决策
- HM 模块执行方式：小呆 `hermes -z` 派活 → Hermes 完成回报 → 小呆核对 → 更新 HM 表
- Hermes 是"执行者"，不写赛博女友代码模块（守则/角色卡/记忆模板/审查类任务）

### 阻塞 / 下一步
- 等 Hermes 回报 HM-01/HM-02 结果 → 核对 → 更新 HM 表状态
- 后续派 HM-03~06

---

## 2026-08-09（人设方案文档同步：评估报告 → 契约/看板/ADR）

### 做了什么
- Hermes 更新人设方案到 `docs/research/hermes-capabilities-review.md` §3.1（人设文件化 + 分区记忆 + profile 隔离，老板已拍板）
- 同步到项目文档：
  - **module-contracts.md v1.3**：§2.4 人设文件化（FilePersonaProvider + 数据文件约定），PersonaInfo 扩展 cardFile/memoryFile/voiceId/emotion
  - **TASKS.md / TASKS-CONFIG.md**：PS-02 方案改为文件化（✅ 已实现），新增 PS-04 分区记忆维护、BR-05 工具白名单
  - **BLUEPRINT.md**：红线新增第 10 条"记忆双向隔离"，persona 模块说明更新
  - **ADR-008**：人设文件化 + 记忆隔离决策记录
  - **项目记忆 MEMORY.md**：人设文件化要点
- 清理误创建空文件（"系统环境变量"/"默认值"）

### 决策
- 人设方案以评估报告 §3.1 为准（老板拍板）：文件化 + 分区记忆 + profile 隔离
- PS-02（FilePersonaProvider）✅ 已交付，PS-03（切换 API）✅ 已交付

### 阻塞 / 下一步
- PS-04 人设分区记忆维护（收尾指令模板）待做
- BR-05 工具白名单 + AGENTS.md 待做
- ACP 常驻 P1 试点待排期

---

## 2026-08-09（PS-03 完成：人设文件化 + 切换 API + 记忆隔离落地）

### 做了什么
- **人设方案定稿并落地**（老板拍板）：人设数据文件化到 Hermes 专用 profile cyber-girlfriend（profiles/cyber-girlfriend/personas/），每人设 = card.md（角色卡静态）+ memory.md（记忆区动态，Hermes 维护）；切换 = 写 active.txt（毫秒级、重启保持）
- **骨架已建**：personas.json 注册表（小呆/知心姐姐/助手）+ active.txt + README + 3 个人设目录
- **PS-03 实现**：
  - 新增 persona/file-persona-provider.ts（FilePersonaProvider：读注册表/角色卡/记忆区，instructions = 角色卡+记忆+收尾指令组装；弃用 PS-02 的 LLM 临场编 JSON 方案）
  - app/server/routes.ts：新增 GET /api/personas + POST /api/persona/switch
  - orchestrator.ts：新增 listPersonas，switchPersona 改为持久化（写 active.txt）
  - brain/hermes-runner.ts：调用参数升级为 --profile cyber-girlfriend -z ... -t terminal,file,web（记忆隔离三层中的读/写硬隔离）
  - config/loader.ts + apikeys.json：hermes 新增 profile/personasDir/toolsets 配置

### 决策
- **记忆隔离**（老板要求）：赛博女友与本地记忆/mem0 双向隔离。实测确认 --ignore-rules 挡不住 mem0，隔离必须靠独立 profile + 工具集白名单
- 人设记忆写入走 Hermes 收尾指令（file 工具追加 memory.md），赛博女友只读文件

### 验收（2026-08-09 实测）
- ✅ npm run typecheck 零错误
- ✅ GET /api/personas → 3 人设 + active；POST /api/persona/switch 切换后 active.txt 持久化；错误 id → 400
- ✅ POST /api/chat（知心姐姐）→ 12.6s 人设语气回复（"姐姐在这儿呢，你什么都不用撑着"），隔离生效
- ✅ 跨会话记忆："老板喜欢喝冰美式"写入 memory.md 后，新对话自动记得

### 阻塞 / 下一步
- 知心姐姐/助手 card 内容待老板定稿；具体人设记忆后期更新
- 中途热切换（对话中"变成知心姐姐"）P2 延后
- ACP 常驻（延迟 12s→2-5s）P1 试点
---

## 2026-08-09（Hermes 功能实现方法文档产出）

### 做了什么
- 老板要求写"hermes 相关所有功能的实现方法文件"（只写背景+需求，让 Hermes agent 自己判断实现方式）
- 产出 `docs/hermes-integration-spec.md`：项目背景 + 已对接能力现状 + 5 项待评估功能（人设管理/会话记忆/复杂事务/工具调用/常驻模式）+ 输出格式模板 + 交付物要求
- BLUEPRINT.md 文档索引新增

### 决策
- 不预设实现方法，由 Hermes agent 评估"可实现性 + 最优方案 + 优于现状的点 + 风险"
- 交付物：`docs/research/hermes-capabilities-review.md`（Hermes 评估后回填）

### 阻塞 / 下一步
- 把文档发给 Hermes agent 评估 → 回收评估结果 → 根据结论调整架构

---

## 2026-08-09（AP-04 完成：旧脚手架迁移重构，工程配置落位 + 旧 server 清理）

### 做了什么
- **工程配置补全**：根目录 `package.json` 规范化（name → `cyber-girlfriend`，与 git remote 一致；新增 `typecheck: tsc --noEmit`；运行时依赖**仅 express**，SDK/DB/TDesign 全部移除）；新建根 `tsconfig.json`（strict + NodeNext + `allowImportingTsExtensions` + `noEmit`，include 仅 app/avatar/brain/config/persona，不含 cybergirlfriend）
- **旧脚手架清理**：删除 `cybergirlfriend/server/` 全部已迁移/废弃文件——`index.ts`（SDK 版）、`db.ts`（SQLite，ADR-006）、`mcp-servers.ts`（MCP 归 Hermes）、`index.d.ts`、`avatar/clip-matcher.ts`（AV-01 已迁移至 avatar/）；cybergirlfriend/src（前端）保留待 CL-09
- **开发依赖补齐**：安装 `typescript` + `@types/express`（优化报告 §3.9 保留清单内，`NODE_DISABLE_COMPILE_CACHE=1` 规避 npm 挂起 bug，14s 完成）

### 决策
- 迁移策略：新架构代码已在 app/avatar/brain/config/persona 就位（AP-01/AV-01 等），AP-04 只做"工程配置落位 + 旧源清理 + 验证"，不重写任何业务代码
- 行数口径：旧 server 1021 行 → app/server 444 行（-56.5%）；-74% 目标按"纯骨架"估（235 行），实际交付含 AP-02/03 功能实现（orchestrator 123 行等），功能更全故未达骨架口径

### 验收（2026-08-09 实测）
- ✅ `/api/health` → `{"status":"ok"}`
- ✅ `/api/chat` "1+1=?" → `{"reply":"老板，1+1=2 呀～...","personaId":"xiaodai","ok":true}`（真实 Hermes 调用 16s）
- ✅ `npm run typecheck`（tsc --noEmit）零错误
- ✅ 运行时依赖 13 → 1（express），零原生编译

### 阻塞 / 下一步
- cybergirlfriend/ 前端 src/ 待 CL-09 迁移（迁移完成后整目录删除）；AV-02 manifest 可开工

---

## 2026-08-09（AP-06 完成：环境变量管理，.env/.env.local 读取 + 模板 + 契约同步）

### 做了什么
- `config/loader.ts` 新增轻量 .env 解析（零依赖自实现，ADR-007）：`parseDotEnv()`（支持注释/空行/export 前缀/单双引号/值尾行内注释）+ `loadEnvFile()`（读取 `.env` + `.env.local`，`.env.local` 覆盖 `.env`，不覆盖已存在的系统环境变量）
- 加载优先级定稿：`config/apikeys.json` > 系统环境变量 > `.env.local` > `.env` > 默认值（`loadConfig()` 入口先注入 .env，mergeWithEnv 逻辑零改动，接口不变）
- 根目录交付 `.env.example` 入库模板（dashscope / hermes / server / 预留 VOICE_PROVIDER 供 VS-01 用），`.env` 已在 .gitignore（CF-02 已配）
- 契约同步（非接口变更，不 bump）：module-contracts.md §3.8 配置集中管理细化优先级链；顺带修正 README.md 契约版本 v1.1 → v1.2
- package.json devDependencies 增加 `@types/node`（纯类型包，零运行时影响，typecheck 工具链）
- 验证（临时脚本跑完即删）：16/16 断言全过（语法解析 7 项 / .env、.env.local、系统环境变量优先级 4 项 / loadConfig 集成 3 项 / maskKey 2 项）；typecheck 经 npx 双包环境（`-p typescript -p @types/node`）跑通，**loader.ts 零错误**

### 决策
- .env 解析自实现而非引 dotenv 包：零新增运行时依赖，更贴 ADR-007 轻量化（当前运行时仍只有 express 一个）
- .env 语义遵循 dotenv 惯例：系统环境变量永远优先，.env 只填充未设置的键；`.env.local` 做本地个性化覆盖（不进 git）
- typescript 不装进项目：npm 在 Windows 反复被文件锁拦截（EPERM），改用 npx 临时环境跑校验，反而更符合零依赖约束

### 阻塞 / 下一步
- 遗留：全项目 typecheck 存在既有债务（app/server 缺 `@types/express`、若干隐式 any），与 AP-06 无关，建议各模块随自身任务修正
- M5-05 `.env.example` 完善（依赖 AP-06 ✅，解锁）；VS-01 可读 `process.env.VOICE_PROVIDER`

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

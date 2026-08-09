# Hermes 能力评估报告(给赛博女友项目)

> **评估者**:Hermes Agent(v0.20.0,本机)
> **评估时间**:2026-08-09
> **依据**:`docs/hermes-integration-spec.md` v1.0 + 本机实测(所有延迟数据为真实运行结果)
> **对应文档**:`docs/hermes-integration-spec.md` §3.1~3.5 + §5 交付物

---

## 0. 实测基线(2026-08-09,本机真实运行)

**环境**:Windows 11 · Hermes v0.20.0 · provider=deepseek · model=deepseek-chat · 记忆系统 mem0 启用

| 场景 | 命令 | 实测耗时 |
|------|------|---------|
| 最短问答 | `hermes -z "1+1=?"` | **14.0~20.2s**(6 次) |
| 带工具调用 | `hermes -z "用terminal执行 echo ..."` | 23.4s |
| 长指令(人设类) | `hermes -z "记住一个暗号:西瓜=7..."` | 27.9s |
| 恢复会话续问 | `hermes --resume <id> -z "暗号=?"` | 20.5s(**上下文保留 ✅**) |
| 查会话列表 | `hermes sessions list` | 0.9s(可拿到 session_id) |

**参数优化对比**(`-z "1+1=?"`):

| 参数组合 | 耗时 |
|---------|------|
| 默认 | 16.9s |
| `-m deepseek-chat` | 15.0s |
| `--reasoning minimal` | 14.0s |
| `-t terminal`(限工具集) | **12.6s** |
| `minimal + terminal` | 14.5s |

**结论:冷启动 12~23s 是硬成本**,参数优化最多省 ~4s,治标不治本。架构目标的"复杂事务 1.5-6s"靠一次性 `-z` 无法达成,必须上常驻(见 §3.5)。

**关键事实**(实测确认):

- `-z` 会**自动注入记忆**:输出出现过"1+1=2,小呆不骗你 😊"——MEMORY.md / USER.md / mem0 记忆全部生效
- `-z` 下**50+ 工具默认全量可用**,无需任何参数;help 原文:"approvals are auto-bypassed"(审批自动绕过 ⚠️ 有安全含义)
- 每次 `-z` 都会在 `hermes sessions list` 落库一条会话,ID 可被外部拿到(0.9s)
- `--resume <session_id> -z` 可延续上下文(20.5s,暗号测试通过)
- `hermes mcp serve`:Windows 上 stdio 冒烟测试**失败**(进程存活但 stdout EOF,无 stderr)——不可作为赛博女友通道
- `hermes serve`(9119):FastAPI + WebSocket,是**桌面 app 的后端底座**,带鉴权 token(`HERMES_DASHBOARD_SESSION_TOKEN`),协议为桌面定制
- `hermes acp`(ACP 协议 server):为 VS Code/Zed 等**外部 UI 驱动 Hermes** 设计,标准协议,支持流式事件/工具调用/多轮会话——与赛博女友形态最匹配(详见 §3.5)

---

## 3.1 人设管理

- **可实现性**:✅ 可实现,但**现状(PS-02)有架构空洞,必须改**
- **核心问题**:PS-02 号称"人设数据归 Hermes 维护",但 **Hermes 侧并不存在任何人设存储**——每次 `getPersona/switchPersona` 都是让 LLM 临场编 JSON:
  - 同一个 id 每次返回的 `instructions` 可能**不一致**(取决于模型心情与记忆注入)
  - `switchPersona` 让 LLM"记住切换"是**假动作**:`-z` 是一次性进程,进程结束即忘,没有写任何持久层(除非 LLM 恰好自觉调 memory 工具,不可控)
  - 长指令 + 冷启动 = 17~28s+,这就是 `switchPersona` 实测 >120s 超时的根因
- **推荐方案(老板 2026-08-09 拍板)**:人设文件化 + **人设分区记忆**——每个人设一套独立"角色卡 + 记忆区",切换人设 = 切换记忆,实现稳定的角色扮演(类 SillyTavern 角色卡模式)。老板确认:**记忆持久分区;先实现"新对话开始时切换",中途热切换 P2 延后;赛博女友直接 fs.readFile 读文件**。**配套隔离要求(同日拍板):赛博女友的记忆与本地记忆/mem0 双向隔离,互不污染**——通过**专用 profile `cyber-girlfriend`** + 工具集白名单实现(实测通过,见 §3.2)

  **① 目录结构**(专用 profile home 下,权威数据源):

  ```
  ~/AppData/Local/hermes/profiles/cyber-girlfriend/
  ├── personas/              # ← 人设数据全部在此(与主 profile 物理隔离)
  │   ├── personas.json      # 人设注册表(元数据)
  │   ├── active.txt         # 当前活跃人设 id(仅一行文本)
  │   ├── README.md          # 数据模型说明(Hermes 任何会话可查询)
  │   ├── xiaodai/
  │   │   ├── card.md        # 角色卡:身份/性格/说话风格/世界观(静态)
  │   │   └── memory.md      # 记忆区:该人设视角的对话记忆(动态,LLM 维护)
  │   ├── zhixin-jiejie/
  │   │   ├── card.md
  │   │   └── memory.md
  │   └── zhushou/
  │       ├── card.md
  │       └── memory.md
  ├── memories/              # profile 自带记忆区(保持为空/不写入)
  ├── config.yaml            # model=deepseek-chat, provider=deepseek(独立)
  └── .env                   # 仅 DEEPSEEK key,**无 MEM0_API_KEY**
  ```

  **② personas.json 格式**:

  ```json
  {
    "version": 1,
    "personas": [
      {
        "id": "xiaodai",
        "name": "小呆",
        "description": "18岁元气AI少女助理,活泼呆萌,做事靠谱",
        "cardFile": "personas/xiaodai/card.md",
        "memoryFile": "personas/xiaodai/memory.md",
        "voiceId": "zh_female_roumeinvyou_uranus_bigtts",
        "emotion": "happy"
      }
    ]
  }
  ```

  **③ card.md 格式**(角色卡,人设定义):

  ```markdown
  # 小呆
  - 身份:18 岁元气 AI 少女助理
  - 性格:活泼呆萌,偶尔犯迷糊,大事上绝不掉链子
  - 说话风格:口语化、亲近、简短(≤3 句)、可带小表情(如 ~🌸)
  - 称呼:称用户为"老板"
  - 职责:负责对话交流;需要动手的事交给工具执行,只把结果讲给老板听
  - 世界观:(可选,角色背景故事)
  ```

  **④ memory.md 格式**(记忆区,LLM 维护):

  ```markdown
  # 小呆的记忆区(角色视角)
  ## 长期记忆(压缩摘要)
  - 老板喜欢喝美式咖啡
  - 上周陪老板讨论了 NAS 分流方案
  ## 近期对话
  - [2026-08-09] 老板说想搭建 S2S 对话窗口
  - [2026-08-09] 老板拍板:人设记忆持久分区,新对话时切换
  ```

  **⑤ 对话流程**(新对话开始时):

  ```
  POST /api/chat
    1. fs.readFile(active.txt)          → 当前人设 id
    2. fs.readFile(personas.json)       → 注册信息(校验存在性)
    3. fs.readFile(<id>/card.md)        → 角色卡
    4. fs.readFile(<id>/memory.md)      → 记忆区
    5. 组装指令(纯文本拼接,红线 5):
         [card.md 内容] + [memory.md 内容] + [用户消息]
         + 收尾指令:"若对话中出现值得该人设记住的新事实,
           调用文件工具追加到 <id>/memory.md;全局事实写记忆系统。"
    6. 发 Hermes 执行(-z 或 ACP)
  ```

  **⑥ 切换流程**(新对话时切换):

  ```
  POST /api/persona/switch {id}
    1. 校验 personas.json 中存在该 id
    2. 写 active.txt(一行 id,毫秒级)
    3. 返回新角色摘要(前端提示"已切换为知心姐姐")
    切换后新对话自然加载新角色的 card+memory;无切换指令则沿用 active.txt
  ```

  **⑦ 记忆写入规则**(收尾指令模板,由 Hermes 执行):
  - 值得记:用户偏好、约定、决策、重要事件(角色视角)
  - 格式:追加到 memory.md「近期对话」区,带日期
  - **压缩规则**:「近期对话」>20 条或 memory.md >3KB 时,让 Hermes 把旧条目压缩为「长期记忆」摘要,防膨胀
  - 全局事实(跨人设的老板偏好/规则)→ 写 MEMORY.md/mem0,**不写**人设区

  **⑧ 红线合规**:
  - 红线 1(赛博女友零持久化):✅ 只读 Hermes 侧文件,不建库
  - 红线 3(人设归 Hermes 维护):✅ 数据权威在 `~/.hermes/personas/`,由 Hermes 管理文件内容,赛博女友只做接口读写
  - 红线 5(文本中转):✅ 角色卡+记忆+消息全为纯文本
  - 红线 9(依赖最小化):✅ fs.readFile 零新增依赖

- **优于现状的点**:人设确定性 100%(不再靠 LLM 临场编);切换毫秒级(不再 17s+);角色扮演有"人生经历"(记忆区),跨会话稳定;多设备/多会话共享同一份人设数据
- **风险/注意事项**:
  - **并发写冲突**:两个会话同时让 Hermes 写同一 memory.md,可能互相覆盖 → P0 单用户场景风险低;收尾指令要求"读-合并-写"或追加模式,ACP 常驻后单会话串行,天然规避
  - **memory.md 膨胀**:压缩规则兜底(⑦)
  - **角色保持范围**:一次性 `-z` 下角色只在单次指令内生效;多轮靠 `--resume` 会话延续;ACP 常驻后角色在会话生命周期内稳定(见 §3.5)
  - **文件备份**:personas/ 目录建议纳入每日备份(现有 NAS 备份流程),防误改
  - 中途热切换(对话中说"变成知心姐姐"立刻变):P2,届时复用同一目录结构,切换=重注入新卡新记忆+刷新上下文

---

## 3.2 会话记忆

- **可实现性**:✅ 读取自动;⚠️ 写入需显式设计
- **现状**:每个 `-z` 独立进程,但**读取侧已自动工作**——MEMORY.md / USER.md / mem0 记忆全部注入系统提示(实测输出带"小呆"人设即证据;注意这是**主 profile** 行为,赛博女友专用 profile 不注入,见下)。**写入侧不可控**:一次性进程结束后,聊天内容不会自动沉淀

- **记忆隔离设计(老板 2026-08-09 补充要求:赛博女友记忆与本地/mem0 双向隔离,已实测验证)**:

  | 隔离层 | 手段 | 实测结果 |
  |--------|------|---------|
  | 读隔离 | 专用 profile `cyber-girlfriend`:独立 home、`.env` 无 MEM0_API_KEY、`memories/` 为空 | ✅ LLM 自查"记忆库完全是空的",零全局记忆注入(`--ignore-rules` 挡不住 mem0,实测确认,隔离必须靠 profile) |
  | 写隔离(软) | profile 内 memory 工具只能写 profile 自己的 `memories/`,触不到主 mem0(无 key) | ✅ 测试写入落在 profile 记忆区,主 profile 零感知 |
  | 写隔离(硬) | 调用参数 `-t terminal,file,web`(白名单不含 memory 工具集) | ✅ LLM 明确报告"没有记忆工具,无法写入",硬隔离生效 |

  **赛博女友调用规范**:
  ```
  hermes --profile cyber-girlfriend -z "<模板指令>" -t terminal,file,web
  ```
  - 人设记忆读写:全部走 file 工具操作 `<profile-home>/personas/<id>/memory.md`
  - 主 profile 的 mem0 / MEMORY.md / USER.md:赛博女友会话**不可见、不可写**
  - 反向:主 profile 会话也不读 personas/(除非显式调用)——双向隔离

- **推荐方案**:
  1. **任务模板收尾指令(零成本,立即生效)**:每条发往 Hermes 的指令末尾追加一行——`"如果对话中有值得长期记住的事实(用户偏好、约定、项目决策),调用 memory 工具写入记忆;否则不要写。"` LLM 会自觉调用 mem0/memory 工具
  2. **多轮上下文(已实测)**:`-z` 首轮 → `hermes sessions list` 拿 session_id(0.9s)→ 后续 `--resume <id> -z` 延续上下文(20.5s,暗号=7 验证通过)。赛博女友侧只需维护"当前会话 id"一个状态,仍零持久化(存在内存)
  3. **ACP 常驻后(§3.5)**:会话天然存活,记忆沉淀由 LLM 在会话内自然完成,无需模板
- **优于现状的点**:把"记忆"从玄学(靠 LLM 自觉)变成"读自动 + 写模板化";多轮上下文从"无"到"有"
- **风险/注意事项**:
  - 收尾指令会略微增加 token 与耗时(~1-2s)
  - `--resume` 恢复的是"最近状态",若中途跑过别的会话,需确认 session_id 指向正确
  - mem0 是共享账户(上海/香港双设备),写入约定带设备后缀,项目记忆建议用固定前缀如 `[cyber-girlfriend]` 便于检索

---

## 3.3 复杂事务执行

- **可实现性**:✅ 单轮任务完全够用;⚠️ 多轮/长任务需设计
- **现状**:`-z` 一次一把梭,120s 超时,stdout 捕获。实测:工具自动可用(无需参数),输出干净,1MB 上限保护合理
- **推荐方案(任务分级)**:
  | 任务类型 | 通道 | 说明 |
  |---------|------|------|
  | 快任务(<30s,文件/查询/计算) | `-z`(优化后) | `-t` 白名单 + 短指令,12~14s |
  | 多轮任务(需追问) | `--resume` 链路 | 首轮拿 id,后续续聊;或 ACP 常驻 |
  | 长任务(>2min,批量/自动化) | ACP 常驻(**推荐**) | 进程不退出,可中间汇报、可打断 |
  | 真·后台任务 | Hermes 内部 `terminal(background)` | -z 退出后后台进程仍存活,回复"已启动,完成后再报" |
- **多轮交互的处理**:优先 **ACP 常驻**(§3.5),它是为"外部 UI 驱动 + 多轮 + 流式"设计的;`--resume` 链路作为无 ACP 时的兜底
- **长任务超时**:一次性 `-z` 的 120s 超时会杀进程,不适合 >2min 任务;ACP 常驻后无此问题
- **优于现状的点**:任务分级让"快问快答"不被迫等待冷启动;长任务不再被超时误杀
- **风险/注意事项**:
  - `-z` 被 kill 时,若 Hermes 正在写文件可能留半成品——任务模板加一句"执行前先确认,执行后报告文件路径"
  - 需要可朗读的结果:任务模板统一收尾"用 1-2 句中文总结结果,供语音朗读"

---

## 3.4 工具调用能力

- **可实现性**:✅ 完全可用,但**默认配置有安全风险,必须收敛**
- **现状**:`-z` 下 50+ 工具**默认全量可用**,且 help 明示 **"approvals are auto-bypassed"**(审批自动绕过)。这意味着:赛博女友触发的任务,危险操作(删文件、改系统配置)不会弹任何确认——Qwen 的 function_call 判定如果被诱导,后果不可控
- **推荐方案(三层防护)**:
  1. **`-t` 白名单(必须做)**:赛博女友的 `hermes-runner` 固定传 `-t terminal,file,memory`(按需加 web)。工具集收敛后:① 安全边界清晰 ② 顺带省 ~4s 冷启动
  2. **项目 AGENTS.md(免费安全层)**:`-z` 会加载 CWD 的 AGENTS.md。在赛博女友后端的工作目录放一份,声明:`只允许操作 <项目目录>/<data> 等白名单路径;禁止删除/覆盖非白名单路径;危险命令需先说明再执行`。LLM 每次运行都会读,等于内置"行为守则"
  3. **任务模板约束**:指令模板要求"执行敏感操作前先输出将要执行的命令"(给 Qwen 侧二次确认的机会)
- **优于现状的点**:从"全量工具 + 免审批"收敛为"白名单 + 行为守则",既保能力又控风险
- **风险/注意事项**:
  - `-t` 白名单不能漏 `memory` 工具(否则记忆沉淀功能失效)
  - 老板如果希望"放手让 Hermes 干",可保留全量但**必须**有 AGENTS.md 守则;建议默认白名单,特殊任务再放开

---

## 3.5 常驻模式 vs 一次性

- **可实现性**:✅ 常驻可行,且**是唯一能达成 1.5-6s 延迟目标的路径**
- **实测结论**:`-z` 冷启动 12~23s(参数优化只省 ~4s),对"快问快答"不可接受;但架构里"快问快答"本来就不该走 Hermes(Qwen-Audio 直答,<1s),Hermes 只处理复杂事务——**若接受事务延迟 12~23s,可先用 -z;若要 2-5s,必须常驻**
- **三个常驻候选实测对比**:

  | 方案 | 形态 | 实测/评估 | 适配度 |
  |------|------|----------|--------|
  | `hermes acp` | stdio JSON-RPC(ACP 标准协议) | 为 VS Code/Zed 等**外部 UI 驱动**设计;流式事件(文本增量/工具调用/完成)、多轮、可打断;官方 SDK(`@agentclientprotocol/sdk`,纯 JS) | ⭐⭐⭐⭐⭐ |
  | `hermes serve` | HTTP+WS(9119) | FastAPI,桌面 app 底座,鉴权 token,协议为桌面定制 | ⭐⭐ |
  | `hermes mcp serve` | stdio JSON-RPC(MCP) | **Windows 冒烟测试失败**(stdout EOF);且设计目标是"暴露会话给其他 agent",非自定义后端 | ⭐(排除) |

- **推荐方案**:**ACP 常驻**(`hermes acp --accept-hooks`)。
  - 赛博女友后端(Node)用 ACP SDK 连 stdio,冷启动只发生一次,之后每轮 = 模型一次推理(2~5s)
  - 原生支持:多轮上下文、流式文本(可边生成边转语音/字幕)、工具调用事件(可显示进度)、打断与取消
  - 会话隔离:`session/new` 天然隔离,多用户/多会话直接支持(顺带解决 §3.6)
  - 接入成本:一个 stdio 子进程 + SDK 依赖,符合"依赖最小化"红线(纯 JS)
- **路线图**:P0 先用"`-z` 优化三件套"(§3.1 文件化 + `-t` 白名单 + 短模板)把延迟压到 12~14s 并消除人设不确定性;P1 做 ACP 常驻试点(先在测试脚本验证 Windows 稳定性,再接入 orchestrator);验证通过后 `brain/hermes-runner.ts` 增加 `AcpRunner` 实现(现有 `BrainRunner` 接口零改动,依赖注入切换)
- **风险/注意事项**:
  - ACP 是 Hermes 的正式功能,Windows 上随 VS Code 生态广泛使用,稳定性有保障;但本机需先做一次 30 分钟稳定性验证(连续 20 轮对话)
  - `--accept-hooks` 只自动接受 shell hooks;危险命令审批策略在 ACP 下仍生效,需要与 §3.4 的白名单/AGENTS.md 配合
  - 若 ACP 试点失败,兜底方案:`hermes serve` 的 /api/pty(桌面 app 同款),但协议文档化程度低,成本高

---

## 3.6 身份与多会话(简要)

- `--resume <session_id>` / `--continue <name>` 天然支持会话隔离(每个 session 独立上下文,实测 sessions 库按 ID 落库)
- ACP 模式:`session/new` 即新会话,隔离是协议原生能力
- 结论:✅ 支持,P2 接入 ACP 时直接使用,无需额外设计

---

## 3.7 记忆接口规范(给赛博女友后端 / PS-03 开发)

> 2026-08-09 老板确认定稿。人设数据全部位于专用 profile home:
> `C:\Users\chipsine\AppData\Local\hermes\profiles\cyber-girlfriend\personas\`(下文简称 `<P>/`)
> **✅ 已实现(2026-08-09,PS-03 完成并实测通过)**。接口已落地,对应实现文件:
> - `persona/file-persona-provider.ts` — FilePersonaProvider(读注册表/角色卡/记忆区,组装 instructions)
> - `app/server/routes.ts` — `GET /api/personas` + `POST /api/persona/switch`
> - `app/server/orchestrator.ts` — listPersonas + 持久化 switchPersona
> - `brain/hermes-runner.ts` — 调用参数 `--profile cyber-girlfriend -z <指令> -t terminal,file,web`
> - `config/loader.ts` + `config/apikeys.json` — hermes.profile / personasDir / toolsets 配置
> 以下规范为实现的契约依据;下文伪代码与真实实现一致。

### 3.7.1 接口总览

| 操作 | 方式 | 耗时 | 说明 |
|------|------|------|------|
| 读当前人设 | `fs.readFile(<P>/active.txt)` | <1ms | 一行 id |
| 读注册表 | `fs.readFile(<P>/personas.json)` | <1ms | 校验存在性/取元数据 |
| 读角色卡 | `fs.readFile(<P>/<id>/card.md)` | <1ms | 人设定义(静态) |
| 读记忆区 | `fs.readFile(<P>/<id>/memory.md)` | <1ms | 人设记忆(动态) |
| 切换人设 | `fs.writeFile(<P>/active.txt, id)` | <1ms | 新对话生效 |
| 写记忆区 | Hermes 指令(file 工具) | 6~27s | 收尾指令驱动,见 3.7.3 |

**规则:赛博女友只读文件、写 memory.md 必须走 Hermes 指令**(红线 3:人设归 Hermes 维护;active.txt 例外,切换=写一行,属接口操作)。

### 3.7.2 文件规范

**active.txt**:仅一行人设 id,无换行,与 personas.json 的 id 一致。
**personas.json**:

```json
{
  "version": 1,
  "personas": [
    { "id": "xiaodai", "name": "小呆", "description": "18岁元气AI少女助理",
      "cardFile": "personas/xiaodai/card.md", "memoryFile": "personas/xiaodai/memory.md",
      "voiceId": "zh_female_roumeinvyou_uranus_bigtts", "emotion": "happy" }
  ]
}
```

**card.md**(角色卡,静态,老板定稿):固定字段——身份/性格/说话风格/称呼/定位/世界观。
**memory.md**(记忆区,动态,Hermes 维护):

```markdown
# <人设名>的记忆区(角色视角)
## 长期记忆(压缩摘要)
- <旧条目压缩后的摘要>
## 近期对话
- [2026-08-09] 老板喜欢喝冰美式。
```

### 3.7.3 memory.md 写入协议(收尾指令模板)

每条发往 Hermes 的对话指令末尾固定追加:

```
若对话中出现值得该人设记住的新事实,调用文件工具追加到 personas/<id>/memory.md 的「近期对话」区(格式: - [日期] 内容);若「近期对话」超过 20 条或文件超过 3KB,把旧条目压缩为「长期记忆」摘要。不要写入其他任何记忆系统。
```

- 值得记:用户偏好、约定、决策、重要事件(角色视角)
- 全局事实(跨人设的老板信息)→ 不写人设区(由老板/主 profile 另行维护)
- 压缩触发:「近期对话」>20 条 或 memory.md >3KB

### 3.7.4 对话调用流程(POST /api/chat,伪代码)

```ts
const P = PERSONAS_DIR; // .../profiles/cyber-girlfriend/personas
async function chat(message: string, personaId?: string) {
  const id = personaId ?? (await fs.readFile(`${P}/active.txt`, 'utf8')).trim();
  const registry = JSON.parse(await fs.readFile(`${P}/personas.json`, 'utf8'));
  if (!registry.personas.some(p => p.id === id)) throw new Error(`人设不存在:${id}`);
  const card   = await fs.readFile(`${P}/${id}/card.md`, 'utf8');
  const memory = await fs.readFile(`${P}/${id}/memory.md`, 'utf8');
  const instruction = `[角色卡]\n${card}\n\n[人设记忆]\n${memory}\n\n[用户消息]\n${message}\n\n[收尾]\n${CLOSING(id)}`;
  const r = await runHermes({ instruction, timeoutMs: 120_000 }); // -t terminal,file,web
  return { reply: r.output, personaId: id, ok: r.ok };
}
```

**Hermes 调用参数(固定)**:
```
hermes --profile cyber-girlfriend -z "<instruction>" -t terminal,file,web
```

### 3.7.5 切换流程(POST /api/persona/switch,伪代码)

```ts
async function switchPersona(id: string) {
  const registry = JSON.parse(await fs.readFile(`${P}/personas.json`, 'utf8'));
  const found = registry.personas.find(p => p.id === id);
  if (!found) return { ok: false, error: `人设不存在:${id}` };
  await fs.writeFile(`${P}/active.txt`, id); // 一行,无换行
  return { ok: true, persona: found };
}
```

切换毫秒级;新对话自然加载新角色的 card+memory;无切换指令则沿用 active.txt。

### 3.7.6 已验证示例(2026-08-09 实测)

| 场景 | 耗时 | 结果 |
|------|------|------|
| 首次对话(小呆查天气+记冰美式) | 27.1s | ✅ 角色语气回复 + memory.md 落盘「老板喜欢喝冰美式」 |
| 跨会话(新对话"渴了") | 6.7s | ✅ 记得冰美式,主动"必须安排冰美式呀~🧊" |
| 记忆写入验证 | - | ✅ memory.md「近期对话」区出现 `- [2026-08-09] 老板喜欢喝冰美式。` |

### 3.7.7 约束与红线

1. **隔离**:必须用 `--profile cyber-girlfriend` + `-t terminal,file,web`(见 §3.2,三层隔离实测通过)
2. **只读不写全局**:赛博女友会话不可见/不可写主 profile 的 mem0/MEMORY.md/USER.md
3. **写记忆唯一通道**:memory.md(经 Hermes file 工具);禁止直接 fs.writeFile 覆盖 memory.md(会与 Hermes 写入冲突)
4. **备份**:personas/ 纳入每日备份(现有 NAS 备份流程)
5. **card.md 只由老板定稿**,Hermes 不修改

---

## 4. 优先接入的 Hermes 能力(按 ROI 排序)

| 优先级 | 能力 | 方案 | ROI 理由 |
|-------|------|------|---------|
| 🥇 P0-1 | **人设文件化** | `~/.hermes/personas/` JSON + active.txt,赛博女友直读 | 消除最大不确定性(人设漂移)+ 消灭 switchPersona 超时(17s→ms) |
| 🥈 P0-2 | **`-t` 白名单 + AGENTS.md 安全层** | runner 固定 `-t terminal,file,memory`;工作目录放守则 | 堵住"免审批"风险,顺带提速 ~4s |
| 🥉 P0-3 | **任务模板** | 指令模板:短指令 + 可朗读总结 + 记忆沉淀收尾 | 输出质量、记忆沉淀、语音可读性三合一 |
| P1-1 | **ACP 常驻试点** | `hermes acp` + Node SDK,30 分钟稳定性验证 | 延迟 12-23s → 2-5s,唯一治本路径 |
| P1-2 | **记忆沉淀模板** | 收尾指令 + `[cyber-girlfriend]` 前缀 | 跨会话记得老板,从玄学变工程 |
| P2 | **多会话隔离** | ACP `session/new` | 单用户阶段可延后 |

## 5. 整体集成方式(比"子进程 -z"更好的方案)

**结论:分两阶段演进,接口抽象保持不变。**

```
阶段一(P0,本周可落地):优化版一次性
  赛博女友 Node ──spawn──▶ hermes -z "模板化指令" -t terminal,file,memory --reasoning minimal
  │  人设数据 ──fs.readFile──▶ ~/.hermes/personas/*.json   (毫秒级,不再走 LLM)
  │  多轮 ──sessions list + --resume──▶ 上下文延续
  └── 现状 hermes-runner.ts 基本不动,只改参数与模板

阶段二(P1,试点后切换):ACP 常驻
  赛博女友 Node ──stdio(ACP SDK)──▶ hermes acp --accept-hooks  [常驻进程]
  │  session/new → task/send → 流式事件(文本增量/工具调用/完成)
  │  冷启动一次,后续每轮 2~5s;多轮/打断/隔离原生支持
  └── brain/hermes-runner.ts 增加 AcpRunner(BrainRunner 接口零改动,装配处切换)
```

**为什么不选 mcp serve / serve**:mcp serve 实测在 Windows 不可用且设计目标不符(agent 间互调);serve(9119)是桌面 app 定制后端,鉴权与协议成本高。ACP 是三者中唯一"为外部 UI 驱动 Hermes"设计的标准协议,与赛博女友"自定义界面 + Hermes 大脑"的形态天然匹配。

---

*评估完成 · 2026-08-09 · 实测数据均为本机真实运行结果*

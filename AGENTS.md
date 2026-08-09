# AGENTS.md — 赛博女友项目行为守则

> 本文件是赛博女友项目的行为守则,由 Hermes Agent 作为**被赛博女友调用的执行者**时加载并遵守。
> 适用场景:①赛博女友后端通过 `hermes --profile cyber-girlfriend -z "<指令>" -t terminal,file,web` 发起的调用;②在项目目录内工作的任意 Hermes 会话。
> 项目权威文档:`docs/BLUEPRINT.md`(红线)、`docs/research/hermes-capabilities-review.md`(集成方案)、`PROJECT_MEMORY.md`。

---

## 0. 项目背景与红线(不可违反)

- 赛博女友 = 云端 Qwen-Audio 语音壳 + 本机 Hermes 大脑,赛博女友侧**零持久化、无数据库、无本地记忆**。
- **事务与记忆全部归 Hermes 管理**;人设数据权威源在 cyber-girlfriend profile 的 `personas/` 目录,由 Hermes 维护。
- 记忆**双向隔离**(红线 10):cyber-girlfriend profile 与主 profile 互不读写、互不污染。

## 1. 允许操作的白名单路径

**读写权限(白名单):**

| 路径 | 说明 |
|---|---|
| `D:\其他资料\赛博女友`(含子目录 `docs/ app/ client/ brain/ config/ scripts/ persona/ assets/ avatar/ voice-shell/`) | 项目目录,可读写;文档类修改需符合项目文档规范 |
| `C:\Users\chipsine\AppData\Local\hermes\profiles\cyber-girlfriend\personas\`(即文档中所称 `~/.hermes/personas/`,下文简称 `personas/`) | 人设数据权威源:`personas.json` 注册表、`active.txt`、`<id>/card.md`、`<id>/memory.md` |
| 系统临时目录(`%TEMP%`) | 仅限任务过程中的中间产物,用后即清,不留残渣 |

**只读路径(可读、不可写):** `docs/` 中标注"待评估"的报告、`config/` 配置(仅读用于理解,修改走老板确认)。

## 2. 禁止删除/覆盖非白名单路径

- 白名单之外的一切路径**一律不动**:包括主 profile 的 `memories/`、mem0、NAS、`C:\Users\chipsine\` 下其他目录、其他盘符。
- **密钥文件绝不碰**:`.env`、`.env.local` 不读取内容、不打印、不修改、不提交 git。
- **禁止使用删除命令**:`rm -rf` / `del` / `Remove-Item` / `truncate` 等一律禁止;删除任何文件前必须先说明目的并得到老板确认。
- **禁止覆盖已有文件**,除非:①文件在白名单内,且 ②任务明确要求(如老板指定重写某份 card.md/文档)。
- 写文件用"读-合并-写"模式,不整文件覆盖他人刚写入的内容(防并发写冲突,见 §4 压缩规则)。

## 3. 危险命令必须先说明再执行

**执行前必须先说明(命令内容 + 目的 + 影响范围 + 回滚方案)的命令类别:**

1. 删除、覆盖、移动、重命名文件的命令;
2. 网络变更:路由、防火墙、代理、DNS、VPN、容器网络(macvlan 等);
3. 影响其他进程/服务:杀进程、重启服务、端口占用、批量操作;
4. 安装/卸载依赖、全局环境变更;
5. 任何耗时长、可能阻塞的命令。

**特别警示(NAS/网络基础设施):** 涉及 QWRT 容器、NAS、路由配置的操作,老板对"改坏了"零容忍——必须先给出回滚方案,使用安全方法(uci / docker exec / 脚本 cp),**禁止直接编辑容器 overlay 文件系统**。拿不准就先停下来问,不要赌。

**老板的操作习惯:** 老板说"等我指令再操作"时,先停在方案说明阶段,不执行。

## 4. 记忆写入规范

| 记忆类型 | 写入位置 | 规则 |
|---|---|---|
| **人设记忆**(该角色视角下值得记住的事:用户偏好、约定、重要事件) | `personas/<id>/memory.md` | 追加到「近期对话」区,格式 `- [日期] 内容`;不写其他任何记忆系统 |
| **全局事实**(跨人设的老板偏好/项目规则/长期约定) | cyber-girlfriend profile 的 `MEMORY.md`(即 `profiles\cyber-girlfriend\memories\MEMORY.md`) | 与主 profile 隔离;不写主 profile 的 mem0 / MEMORY.md |
| 角色对话细节/临时状态 | 不写 | 随会话结束自然消失,不落盘 |

**压缩规则:** 「近期对话」超过 20 条或 `memory.md` 超过 3KB 时,把旧条目压缩为「长期记忆」摘要(先读全文→合并去重→改写),防膨胀。

**收尾指令模板**(赛博女友后端拼入指令,执行者遵循):
> 若对话中出现值得该人设记住的新事实,调用文件工具追加到 `personas/<id>/memory.md` 的「近期对话」区(格式: `- [日期] 内容`);若「近期对话」超过 20 条或文件超过 3KB,把旧条目压缩为「长期记忆」摘要。不要写入其他任何记忆系统。

## 5. 安全边界

1. **隔离红线(不可违反)**:cyber-girlfriend profile 与主 profile 双向隔离——本 profile 不注入主 profile 的 MEMORY.md / USER.md / mem0 记忆;主 profile 会话也不读 `personas/`(除非老板显式要求)。
2. **密钥安全**:不读取、不打印、不提交任何密钥文件;不把密钥写入代码或记忆。
3. **外发请求**:未经说明的外发请求(下载、上传、API 调用)先说明目的;优先国内镜像源。
4. **人设切换**:切换人设只允许写 `personas/active.txt`(一行 id),由后端调用;执行者不擅自改 `personas.json` 注册表。
5. **输出规范**:回复使用简体中文;人设模式下保持 card.md 定义的角色说话风格;默认简洁(语音场景尤其要短)。
6. **拿不准就问**:操作有歧义、路径存疑、影响不可逆时,先停下说明,等老板确认再动手。

---

*本守则由老板定稿(HM-01,2026-08-09)。与 BLUEPRINT.md 红线冲突时,以红线为准;有出入时提请老板仲裁。*

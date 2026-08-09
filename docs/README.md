# docs · 文档中心 📚

**职责**：赛博女友项目的知识中枢——架构、调研、决策、任务、进度全部沉淀在这。

## 三文档工作流（核心入口）

| 文档 | 定位 | 读它回答什么 |
|------|------|-------------|
| **BLUEPRINT.md** | 项目蓝图 | 项目是什么？架构长啥样？红线在哪？ |
| **TASKS.md** | 任务看板 | 该干什么？做到哪了？依赖谁？ |
| **DEVLOG.md** | 开发日志 | 干了什么？决策了什么？卡在哪？ |
| **WORKFLOW.md** | 工作流规则 | 三文档怎么用？任务怎么流转？ |

> 新加入项目的人：先读 BLUEPRINT.md，再读 WORKFLOW.md，然后看 TASKS.md 找活干。

## 完整结构

```
docs/
├── BLUEPRINT.md             # ★ 项目蓝图（一站式入口，架构自解释）
├── TASKS.md                 # ★ 任务看板（全模块任务清单与进度）
├── DEVLOG.md                # ★ 开发日志（按时间倒序记录）
├── WORKFLOW.md              # ★ 工作流规则（三文档怎么用）
├── architecture/            # 架构设计
│   ├── overall-architecture.md   # 整体架构总纲 v1.1
│   └── module-contracts.md       # 模块接口契约 v1.2
├── research/                # 调研报告
│   ├── Qwen-Audio-3.0-Realtime-调研报告.md
│   ├── Qwen3-Omni-调研笔记.md
│   └── 豆包Seeduplex-调研报告.md
└── adr/                     # 架构决策记录（6 条 ADR）
    └── README.md
```

## 文档维护约定

1. **三文档优先**：BLUEPRINT/TASKS/DEVLOG/WORKFLOW 是项目管理核心，实时维护
2. **根目录只留总纲**：`DESIGN.md`（详细设计）、`PROJECT_MEMORY.md`（项目记忆）、`混合架构方案-云端语音壳+本地大脑.md`（老板定稿）留在根目录
3. **模块文档就近**：每个模块自带 README 说明职责与核心文件
4. **调研报告归档**：已完成调研报告移入 `docs/research/`
5. **重大决策写 ADR**：架构变更、选型变更等记录到 `docs/adr/`
6. **接口变更先改契约**：修改接口时先更新 `module-contracts.md` 再写代码

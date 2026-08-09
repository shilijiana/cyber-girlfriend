# 赛博女友 · 项目长期记忆

## 核心架构定位（2026-08-09 老板明确，最高优先级）

- **赛博女友 = 纯交互界面**：只做语音问答（人设 + 数字人 + 字幕），**不建数据库、不做持久化、不存本地记忆**
- **具体事务 → Hermes 负责**：Hermes agent 自带记忆系统与 50+ 工具，记忆/事务状态全归 Hermes，赛博女友侧零持久化
- 架构：Qwen-Audio-3.0-Realtime-Flash（云端语音壳）+ Hermes Agent（本机大脑），Function Calling 中转（路径 A 推荐）
- 架构总纲：`docs/architecture/overall-architecture.md`（v1.1）；模块契约：`docs/architecture/module-contracts.md`（v1.2）；决策记录：`docs/adr/README.md`（7 条 ADR）；优化报告：`docs/architecture/optimization-report.md`

## 架构优化要点（2026-08-09 ADR-007）

- **persona 归 Hermes**：赛博女友只保留 `PersonaProvider` 接口（listPersonas/getPersona/buildInstructions/switchPersona），人设数据由 Hermes 维护，不存本地角色卡文件
- **APIKEY 集中配置**：`config/apikeys.json`（gitignore）+ `config/apikeys.example.json`（入库）+ `config/loader.ts`（文件优先、环境变量兜底）
- **轻量化**：运行时依赖 13→5-6 个（删 SDK/DB/router/TDesign全家桶/uuid），总代码 ~5316→~1003 行（-81%），全部纯 JS 零原生编译

## 三文档工作流（2026-08-09 建立）

- **项目协作基础设施**：四份核心文档管理项目全生命周期
  - `docs/BLUEPRINT.md`：项目蓝图（一站式入口，架构自解释）
  - `docs/TASKS.md`：任务看板（M0~M5 全模块任务，含 ID/优先级/依赖/验收标准）
  - `docs/DEVLOG.md`：开发日志（按时间倒序记录进度/决策/阻塞）
  - `docs/WORKFLOW.md`：工作流规则（接任务→读文档→干活→写日志→更看板）
- 任务 ID 规则：VS/BR/PS/AV/AP/CL/DC/M{X} 前缀 + 序号
- 状态：📋TODO / 🔄IN PROGRESS / ✅DONE / 🚫BLOCKED / ⏸PAUSED
- 优先级：P0阻塞 / P1核心 / P2增强 / P3延后
- 接口变更必须先改 module-contracts.md 再写代码

## 项目红线（老板明确指示，不可违反）

1. **🚫 环境搭建永久暂停**：不执行 npm/pnpm install、Python 依赖安装、素材下载、工具链配置等任何环境类操作；DESIGN §16 / DEPENDENCIES.md 仅历史记录不再维护。环境由老板/外部负责。
2. **🚫 测试框架与 CI 暂停**：Vitest/Playwright/GitHub Actions 搁置（旧任务已封存），恢复时按新架构重写。
3. **🔧 无记忆/无数据库**：赛博女友侧零持久化，记忆与事务归 Hermes（ADR-006）。
4. **方案先确认再动手**：重大变更先出方案给老板评审。
5. **称呼**：用户为"老板"，我（小呆）是老板的架构负责人兼助理。

## 角色边界（2026-08-09 老板再次明确，最高优先级）

- **小呆 = 整体架构负责人，只管两件事**：① 下达任务（用 WORKFLOW §4.5 派活模板派给子代理/模块开发者）② 看任务进度（维护 TASKS.md 看板 + 汇总汇报给老板）
- **🚫 不负责子任务开发**：不写子模块代码、不做子任务实现。开发由各功能模块的子代理/开发者完成
- **M1 开工 = 用派活模板把 AP-01/BR-01/PS-01 等任务派出去**，然后盯进度、汇总结论，而不是自己动手写
- 与"总体架构负责人"角色一致（2026-08-09 早前已确认）：把握架构方向、安排任务、看执行、做汇总

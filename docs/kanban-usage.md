# Hermes kanban 用法（异步派活参考）

> **用途**：赛博女友 HM 模块的**异步派活模式**——派活不阻塞、稍后查询。
> **来源**：Hermes v0.20.0 本机实测（2026-08-09，HM-KANBAN-GUIDE 查询）
> **配套**：`docs/TASKS-CONFIG.md` §HM 模块、`docs/WORKFLOW.md` §4.6

---

## 1. 为什么用 kanban

- `hermes -z` 是**同步阻塞**的：进程跑完才返回，派活必须挂起等待
- `hermes kanban` 是**异步派活**：`create` 秒返回 task_id → 后台执行 → 稍后 `show/list` 查询
- 契合老板规则"**文档即状态**"：派活后不等待，通过查询判断完成

## 2. 完整命令序列（赛博女友场景）

```bash
# A. 派活（立即返回 task_id，不阻塞主流程）
hermes --profile cyber-girlfriend kanban create "任务标题" \
  --body "输出: <绝对路径>；只列要点；200字内；完成后更新 docs/DEVLOG.md" \
  --assignee cyber-girlfriend --priority 2 \
  --workspace dir:D:/其他资料/赛博女友 \
  --created-by 小呆 --json
# 解析输出拿 task_id（形如 t_abcd）；建议带 --idempotency-key "<业务键>" 防重复派活

# B. 触发执行（不等 60s tick；gateway 在跑可省略）
hermes --profile cyber-girlfriend kanban dispatch --max 5

# C. 稍后查询（判断是否完成）
hermes --profile cyber-girlfriend kanban show t_abcd --json      # 状态+评论+事件
hermes --profile cyber-girlfriend kanban list --assignee cyber-girlfriend --status done

# D. 拿结果文本
hermes --profile cyber-girlfriend kanban runs t_abcd             # 结案 summary
hermes --profile cyber-girlfriend kanban log t_abcd              # 完整日志
```

## 3. 关键注意事项

| # | 注意点 |
|---|--------|
| 1 | **必须 `--workspace dir:<绝对路径>`**（默认 scratch 工作区用后即删，文件会丢） |
| 2 | 优先级数字越大越靠前（list 默认 priority DESC） |
| 3 | **任务 body = 验收标准**：写清"输出什么、放哪、什么格式"，worker 才有据可依 |
| 4 | 板子 host 级共享：任何 profile 敲 kanban 都是同一块板（与记忆隔离不冲突，但**别放密钥/隐私**） |
| 5 | 纯 CLI 场景无推送通道，**轮询 show/list 判断完成** |
| 6 | 别同时跑独立 kanban daemon 和 gateway dispatcher（claim race）；手动 dispatch 安全 |

## 4. 与"文档即状态"结合

- 派活指令的 body 里要求：**"完成后更新 docs/DEVLOG.md 追加记录，并更新 docs/TASKS.md HM 表状态"**
- 小呆通过 **grep docs/DEVLOG.md 最新条目 / HM 表状态** 判断 Hermes 是否完成，不阻塞等待
- 也可用 `kanban show <id>` 轮询作辅助确认

---

*kanban 用法 v1.0 · 2026-08-09 · 异步派活参考（Hermes 实测）*

# CC-01 · 已交付代码审查（Claude Code 执行）

> **执行者**：Claude Code
> **任务来源**：老板 2026-08-09 明确——代码审查非 Hermes 长处，转 Claude Code 执行
> **项目**：赛博女友（AI 语音陪伴应用：云端 Qwen-Audio 语音壳 + 本地 Hermes 大脑）
> **项目根目录**：`D:/其他资料/赛博女友`
> **本文件自包含**：Claude Code 只读本文件即可执行，无需翻阅其他文档

---

## 1. 任务目标

对已交付的核心代码做**深度代码审查**，输出一份审查报告（**只诊断不改码**），帮助发现逻辑 bug、边界问题、安全隐患与改进机会。

## 2. 审查范围（文件清单）

| 模块 | 文件 | 说明 |
|------|------|------|
| brain | `brain/hermes-runner.ts` | Hermes 子进程调用器（spawn `hermes -z`，120s 超时，stdout 捕获，错误兜底） |
| persona | `persona/provider.ts` | PersonaProvider 接口 + Persona/PersonaInfo 类型 + 类型守卫 |
| persona | `persona/file-persona-provider.ts` | FilePersonaProvider：直读 personas 文件（毫秒级切换） |
| avatar | `avatar/clip-matcher.ts` | 素材匹配引擎（情绪→选片→队列，纯函数） |
| app | `app/server/orchestrator.ts` | Core Orchestrator 编排层（persona→brain 链路） |
| app | `app/server/routes.ts` | REST API 路由（/api/chat、/api/brain/status、/api/avatar/status、/api/personas、/api/persona/switch） |
| app | `app/server/index.ts` | Express 装配 |
| config | `config/loader.ts` | 配置加载器（apikeys.json + .env 解析） |

## 3. 审查要点（逐项检查）

1. **逻辑正确性**：算法/流程是否有 bug？边界条件（空输入、超时、并发）是否处理？
2. **安全性**：密钥是否可能泄露？命令注入风险？路径穿越？敏感数据是否外泄？
3. **契约一致性**：接口是否与 `docs/architecture/module-contracts.md`（v1.3）一致？
4. **红线合规**：
   - 无数据库、无持久化、无本地记忆（赛博女友侧）
   - 文本中转不漂移（Qwen↔Hermes 只传纯文本）
   - 依赖最小化（仅 express，纯 JS）
5. **健壮性**：错误处理是否完整？异常是否会被吞掉？超时/降级是否合理？
6. **可维护性**：命名、注释、代码组织、TypeScript 类型是否规范？

## 4. 交付物（输出要求）

把审查报告写到：**`docs/reviews/code-review-2026-08-09.md`**（目录不存在则创建）

报告格式：

```markdown
# 代码审查报告（CC-01）

> 审查日期：YYYY-MM-DD · 审查者：Claude Code · 审查范围：见 CC-01 §2

## 审查结论（概要）
- 总体评价 / 发现问题的数量与严重程度分布（高/中/低）

## 发现的问题（按严重程度排序）

### 🔴 高（建议尽快修复）
| 位置 | 问题描述 | 影响 | 建议 |
|------|----------|------|------|
| 文件:行号 | ... | ... | ... |

### 🟡 中
### 🟢 低 / 改进建议

## 合规检查
- 红线合规：✅/❌ 逐条说明
- 契约一致性：✅/❌ 说明

## 总结与优先级建议
```

## 5. 验收标准

- [ ] 覆盖 §2 全部 8 个文件
- [ ] 报告包含：概要结论 + 高/中/低问题分级 + 合规检查 + 建议
- [ ] 每个问题标注"文件:行号"、影响、建议
- [ ] **不改任何代码**（只输出报告）
- [ ] 报告写入 `docs/reviews/code-review-2026-08-09.md`

## 6. 执行说明

1. 从项目根目录 `D:/其他资料/赛博女友` 开始
2. 逐个阅读 §2 文件（可参考 `docs/architecture/module-contracts.md` 契约）
3. 可按需运行 `npx tsc --noEmit`（若已装 typescript）辅助检查类型问题
4. 汇总写报告到 §4 指定路径
5. 报告完成后，在 `docs/DEVLOG.md` 最上方追加一条记录（做了什么/发现 N 个问题/报告路径）

---

*CC-01 代码审查任务卡 v1.0 · 2026-08-09 · Claude Code 直接执行*

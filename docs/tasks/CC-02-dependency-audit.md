# CC-02 · 依赖与安全审计（Claude Code 执行）

> **执行者**：Claude Code
> **任务来源**：老板 2026-08-09 明确——依赖审计非 Hermes 长处，转 Claude Code 执行
> **项目**：赛博女友（AI 语音陪伴应用：云端 Qwen-Audio 语音壳 + 本地 Hermes 大脑）
> **项目根目录**：`D:/其他资料/赛博女友`
> **本文件自包含**：Claude Code 只读本文件即可执行，无需翻阅其他文档

---

## 1. 任务目标

对项目依赖做**安全与健康度审计**，输出审计报告（**只诊断不改动**），确保依赖最小化、无已知漏洞、构建配置合理。

## 2. 审计范围

| 对象 | 路径 | 说明 |
|------|------|------|
| 依赖清单 | `package.json` | 运行时依赖（应仅 express）+ 开发依赖 |
| 锁文件 | `package-lock.json` | 实际安装版本 |
| TypeScript 配置 | `tsconfig.json` | 编译选项合理性 |
| 环境变量 | `.env.example` | 环境变量完整性 |
| 密钥配置 | `config/apikeys.example.json` | 模板是否含真实密钥（应无） |

## 3. 审计要点（逐项检查）

1. **依赖最小化**（红线：运行时 5-6 个纯 JS 依赖，零原生编译）：
   - package.json 运行时依赖是否只有 express？
   - 是否有已装但未使用的依赖（`npm ls --depth=0` 检查）
   - devDependencies 是否合理（@types/node 等）
2. **安全漏洞**：
   - 运行 `npm audit`（或 `npm audit --omit=dev`）检查已知漏洞（CVE）
   - 报告漏洞数量、严重程度、受影响的包与修复建议
3. **配置合理性**：
   - tsconfig.json：strict 是否开启？module/moduleResolution 是否与 `allowImportingTsExtensions` 搭配正确？
   - include 范围是否合理（不应包含 cybergirlfriend 旧脚手架）
4. **密钥安全**：
   - `.env.example` / `config/apikeys.example.json` 是否只含占位符？
   - `config/apikeys.json` 是否被 .gitignore 正确忽略？
   - 代码中是否有硬编码密钥（grep apiKey/token/secret）
5. **license 与弃用**（可选）：
   - 依赖包是否有 license 风险？是否有已弃用（deprecated）的包？

## 4. 交付物（输出要求）

把审计报告写到：**`docs/reviews/dependency-audit-2026-08-09.md`**（目录不存在则创建）

报告格式：

```markdown
# 依赖与安全审计报告（CC-02）

> 审计日期：YYYY-MM-DD · 审计者：Claude Code

## 审计结论（概要）
- 依赖健康状况 / 漏洞数量与严重程度 / 是否达标（红线：依赖最小化）

## 依赖清单分析
| 包名 | 类型 | 版本 | 用途 | 是否必要 | 备注 |
|------|------|------|------|----------|------|

## 安全漏洞（npm audit 结果）
| 严重程度 | 包名 | 漏洞描述 | 影响版本 | 修复建议 |
|----------|------|----------|----------|----------|

## 配置与安全检查
- tsconfig 合理性：✅/❌ 说明
- 密钥安全：✅/❌（是否发现硬编码/泄露风险）
- .gitignore 覆盖：✅/❌

## 建议
- 应删除的依赖 / 应升级的依赖 / 应补充的配置
```

## 5. 验收标准

- [ ] 覆盖 §2 全部 6 个对象
- [ ] 运行了 `npm audit`（若 npm 可用）并如实记录结果
- [ ] 报告包含：依赖清单分析 + 漏洞表 + 配置检查 + 建议
- [ ] **不改动任何文件**（只输出报告）
- [ ] 报告写入 `docs/reviews/dependency-audit-2026-08-09.md`

## 6. 执行说明

1. 从项目根目录 `D:/其他资料/赛博女友` 开始
2. 阅读 §2 文件 + 运行检查命令（`npm ls --depth=0`、`npm audit`，若 node_modules 已装）
3. 汇总写报告到 §4 指定路径
4. 报告完成后，在 `docs/DEVLOG.md` 最上方追加一条记录（做了什么/发现 X 个漏洞/报告路径）

---

*CC-02 依赖审计任务卡 v1.0 · 2026-08-09 · Claude Code 直接执行*

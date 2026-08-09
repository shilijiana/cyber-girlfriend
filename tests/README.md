# tests · 测试 ✅（暂停中）

**职责**：自动化测试覆盖——老板已指示**暂停**，恢复时按新架构重写用例。

## 结构（规划）

```
tests/
├── unit/           # 单元测试（纯逻辑：clip-matcher、prompt-builder、function-router）
├── integration/    # 集成测试（Express API + SQLite 内存库）
└── e2e/            # Playwright 浏览器全流程
```

## 暂停说明

- 原脚手架测试套件（vitest.config.ts / playwright.config.ts / ci.yml）保留在 `cybergirlfriend/` 未删除
- 新架构落地后，按 `docs/architecture/overall-architecture.md` 的模块边界重写用例
- 恢复时优先覆盖：clip-matcher（已有 10 用例）、prompt-builder、function-router、hermes-runner mock

## 相关

- 测试设计原稿：DESIGN.md §11
- 架构总纲：`docs/architecture/overall-architecture.md`

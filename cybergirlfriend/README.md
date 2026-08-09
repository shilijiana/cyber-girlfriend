# Web Agent（赛博女友 · Cyber Girlfriend）

一个基于 CodeBuddy Agent SDK 构建的 Web Agent 应用模板，正在改造为带 S2S 语音 + 数字人素材库的赛博女友应用。设计文档见项目上级目录 `DESIGN.md`（v0.5）。

## 技术栈

- **后端**: Node.js + Express + TypeScript
- **前端**: React 18 + TypeScript + Vite + TDesign
- **AI**: CodeBuddy Agent SDK
- **数据库**: SQLite (better-sqlite3)

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量（复制模板并填写 CODEBUDDY_API_KEY）
cp .env.example .env

# 3. 启动开发服务器（前端 5173 + 后端 3000）
npm run dev
```

打开浏览器访问 http://localhost:5173

> 也可以先 `codebuddy login` 登录 CLI，应用会自动使用 CLI 的登录信息。

## 自动化测试

覆盖：单元测试（业务逻辑）、集成测试（API/数据库）、端到端测试（浏览器 UI）、覆盖率统计。框架：Vitest + Playwright + GitHub Actions CI（详见 DESIGN.md §11）。

### 测试命令

```bash
npm test                  # 单元 + 集成测试（CI 主命令）
npm run test:unit         # 仅单元测试
npm run test:integration  # 仅集成测试（自动起临时 Express）
npm run test:e2e          # Playwright 端到端（首次需 npx playwright install chromium）
npm run test:coverage     # 单元 + 集成，带覆盖率（输出 coverage/）
npm run test:all          # 全覆盖（coverage + e2e）
npm run report            # 聚合生成 test-summary.md（通过率/失败详情/覆盖率）
```

### 测试报告

- `test-results/vitest-results.json` + `test-results/playwright-results.json`：机器可读结果
- `coverage/index.html`：覆盖率可视化报告
- `test-summary.md`：汇总报告（通过率、失败用例详情、覆盖率统计），由 `npm run report` 生成

### CI 自动触发

推送或 PR 时 GitHub Actions 自动运行：类型检查 + 构建 → 单元/集成 + 覆盖率 → E2E，失败即红。配置见 `.github/workflows/ci.yml`。

### 测试规范（可维护性）

- 单元测试就近放在 `server/` 对应模块旁（`*.test.ts`），纯逻辑放 `tests/unit/`
- 集成测试放 `tests/integration/`，E2E 放 `tests/e2e/`，固定数据放 `tests/fixtures/`
- 用例中文命名、动词开头：`describe('素材匹配引擎')` + `it('应避开最近播过的片段')`
- 提交信息用 `test: 补充...` 前缀

## 配置

- **环境变量**：创建 `.env` 文件（参考 `.env.example`）：`CODEBUDDY_API_KEY`、`PORT`、`CODEBUDDY_AUTH_TOKEN`、`CODEBUDDY_BASE_URL`、`CODEBUDDY_INTERNET_ENVIRONMENT`，以及本项目新增的 `VOICE_PROVIDER` / `DASHSCOPE_API_KEY` / `WORKBUDDY_MCP_URL` 等（见 DESIGN.md §10）。
- **Web UI 配置**：应用的设置页面也可配置环境变量（仅当前服务器进程有效）。

## 开发

```bash
npm run dev            # 开发模式（同时启动前后端）
npm run dev:server     # 单独启动后端
npm run dev:client     # 单独启动前端
npm run build          # 构建生产版本
npm run preview        # 预览生产版本
```

## 核心 API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/health` | GET | 健康检查 |
| `/api/check-login` | GET | 检查 CodeBuddy 登录状态 |
| `/api/sessions` | GET/POST | 会话列表 / 新建 |
| `/api/chat` | POST | 发送消息（SSE 流式响应） |
| `/api/permission-response` | POST | 响应权限请求 |
| `/api/mcp/status` | GET | MCP 健康状态（规划） |

## 二次开发

如果你想基于这个模板进行定制化开发，请查看 [DEVELOPMENT.md](./DEVELOPMENT.md) 获取详细指南，包括：

- 项目架构详解
- 核心功能实现原理
- 10+ 常见定制场景示例
- API 完整参考
- 调试和部署指南

## License

MIT

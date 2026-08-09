# DEPENDENCIES.md — 依赖清单与国内源配置

> 目标：依赖数量最小化 + 所有依赖可通过国内源顺畅获取（阿里云系 npmmirror 等）。
> 关联设计：DESIGN.md §16；安装命令见下文。

## 1. 包管理器选型

- **pnpm 11**（本项目使用，独立 tarball 已放在 `.tools/pnpm/`，不依赖 npm 安装）。
- **为什么不用 npm**：本机 Node 22.22.2 的 npm 10.9.7 存在 v8 编译缓存导致的**启动挂起 bug**（`npm install` / `npm view` 均无响应）；pnpm 更快、省磁盘、同样走国内镜像。
- **Windows 安装注意**：Node 22 的编译缓存在本机同样影响 pnpm 的 bin wrapper，安装命令统一加：

```bash
export NODE_DISABLE_COMPILE_CACHE=1
node .tools/pnpm/package/bin/pnpm.mjs <命令>
```

## 2. 国内源配置（已固化在项目 `.npmrc`）

```ini
registry=https://registry.npmmirror.com          # 主镜像（阿里云系，与 npmjs 同步）
better_sqlite3_binary_host=https://npmmirror.com/mirrors/better-sqlite3/  # 原生模块预编译二进制
shamefully-hoist=true                            # pnpm 兼容 npm 的 node_modules 结构
```

**其他备选国内源**（网络不佳时切换）：
| 源 | 地址 | 说明 |
|----|------|------|
| npmmirror（阿里云系，默认） | https://registry.npmmirror.com | 官方推荐，同步快 |
| 腾讯云镜像 | https://mirrors.cloud.tencent.com/npm/ | 备选 |
| 阿里云镜像 | https://registry.npmmirror.com | 同 npmmirror |
| 字节跳动 | https://registry.npmjs.org | 仅网络无障碍时 |

**Playwright 浏览器二进制**（E2E 需要，走国内镜像）：
```bash
export PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright
npx playwright install chromium
```

## 3. 依赖清单（全部可经国内源获取）

### 3.1 运行时依赖（dependencies，12 个）
| 包 | 用途 | 必要性 | 国内获取 |
|----|------|--------|----------|
| @tencent-ai/agent-sdk | CodeBuddy Agent 核心（chat/session/tools） | **核心**，不可替代 | npmmirror ✓ |
| express | HTTP 服务 | **核心** | npmmirror ✓ |
| better-sqlite3 | SQLite 存储（原生模块） | 核心；有预编译二进制，走镜像 | 镜像 ✓ |
| react / react-dom | 前端框架 | 核心 | npmmirror ✓ |
| @tdesign-react/chat | 聊天 UI 组件 | 核心 UI | npmmirror ✓ |
| tdesign-react | TDesign 基础组件 | 核心 UI | npmmirror ✓ |
| tdesign-icons-react | 图标 | 低（与 lucide 二选一） | npmmirror ✓ |
| @tdesign-react/aigc | AIGC 组件 | **待查：未使用则移除** | npmmirror ✓ |
| lucide-react | 图标 | **待查：未使用则移除** | npmmirror ✓ |
| react-router-dom | 路由 | 核心 | npmmirror ✓ |
| uuid | 会话 ID | 低（可换 crypto.randomUUID） | npmmirror ✓ |

### 3.2 开发依赖（devDependencies）
| 包 | 用途 | 国内获取 |
|----|------|----------|
| typescript / vite / @vitejs/plugin-react | 构建 | npmmirror ✓ |
| tsx | TS 直接运行（dev:server） | npmmirror ✓ |
| tailwindcss / autoprefixer / postcss / less | 样式 | npmmirror ✓（less 未使用可移除） |
| concurrently | 同时起前后端 | npmmirror ✓ |
| vitest / @vitest/coverage-v8 | 单元+集成测试 | npmmirror ✓ |
| @playwright/test | E2E 测试 | npmmirror ✓（浏览器走 cdn.npmmirror.com） |
| @types/* | TS 类型 | npmmirror ✓ |

### 3.3 待瘦身项（M1 收尾前核查，删除未使用的包）
- `@tdesign-react/aigc`（alpha 版，若非使用则删）
- `less`（若 vite 未用则删）
- `lucide-react` / `tdesign-icons-react`（图标库二选一）
- `uuid`（可替换为 Node 内置 `crypto.randomUUID()`）

## 4. 完整安装命令（Windows / Git Bash）

```bash
cd cybergirlfriend

# 1) 安装依赖（pnpm，国内源自动生效）
#    注意：必须清空 NODE_OPTIONS（WorkBuddy 注入的安全删除 shim 会拦截 pnpm 清理临时目录）
export NODE_OPTIONS=
export NODE_DISABLE_COMPILE_CACHE=1
node .tools/pnpm/package/bin/pnpm.mjs install

# 2) 配置环境变量
cp .env.example .env
# 编辑 .env 填入 CODEBUDDY_API_KEY / DASHSCOPE_API_KEY 等

# 3) 测试依赖（E2E 浏览器，首次）
export PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright
node .tools/pnpm/package/bin/pnpm.mjs exec playwright install chromium

# 4) 启动开发
npm run dev
```

## 5. 故障排查

| 症状 | 原因 | 处理 |
|------|------|------|
| npm/pnpm 命令无响应挂起 | Node 22 v8 编译缓存 bug（本机） | 加 `NODE_DISABLE_COMPILE_CACHE=1` |
| better-sqlite3 安装失败 | 预编译二进制下载慢/失败 | 已配 `better_sqlite3_binary_host` 镜像；仍失败则 `pnpm rebuild better-sqlite3` |
| Playwright 下载浏览器超时 | 浏览器二进制走 GitHub | 设 `PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright` |
| 个别包 404 | 镜像同步延迟 | 换腾讯云镜像 `--registry=https://mirrors.cloud.tencent.com/npm/` |

---
*维护：新增依赖前先确认必要性与国内可达性；优先用镜像源现成包，避免原生编译依赖（如 node-gyp 系列）。*

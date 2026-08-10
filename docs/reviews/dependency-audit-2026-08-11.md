# CC-02 依赖与安全审计报告

> **审计执行人**：Claude Code
> **审计日期**：2026-08-11
> **任务编号**：CC-02
> **审计范围**：根 package.json + client/package.json
> **npm 版本**：12.0.2

---

## 1. 概要结论

依赖清单**完全符合红线 5（依赖最小化）**——根仅 `express` + `ws`，client 仅 `react` + `react-dom`。根依赖零漏洞，**client 存在 2 个漏洞**（1 moderate + 1 high，均来自 `esbuild`，影响 `vite` 开发服务器）。配置与密钥管理**合规**——无硬编码密钥、`.gitignore` 覆盖完整。

---

## 2. 依赖清单分析

### 2.1 根 package.json（后端）

**dependencies（运行时）**：

| 包名 | 声明版本 | 实际版本 | 用途 | 是否使用 |
|------|---------|---------|------|---------|
| `express` | `^4.18.2` | 4.22.2 | HTTP 服务器框架 | ✅ 使用（index.ts、routes.ts） |
| `ws` | `^8.21.3` | 8.21.3 | WebSocket 服务器/客户端 | ✅ 使用（ws.ts、gateway.ts） |

**结论**：✅ **红线 5 达标**——运行时仅 2 个纯 JS 依赖，零原生编译模块。

**devDependencies（开发/构建）**：

| 包名 | 声明版本 | 实际版本 | 用途 |
|------|---------|---------|------|
| `@types/express` | `^5.0.6` | 5.0.6 | Express 类型定义 |
| `@types/node` | `^26.2.0` | 26.2.0 | Node.js 类型定义 |
| `@types/ws` | `^8.18.1` | 8.18.1 | ws 类型定义 |
| `typescript` | `^7.0.2` | 7.0.2 | TypeScript 编译器（`tsc --noEmit` 类型检查） |

**结论**：✅ 合理——全部为类型定义和构建工具，无多余包。

**版本健康**：
- `npm outdated` 显示 `express 4.22.2 → 5.2.1` 可升级（major 版本），但 4.x 是稳定 LTS 系列，5.x 为 breaking change，**当前不急于升级**。
- 其余包均为最新版本。

---

### 2.2 client/package.json（前端）

**dependencies（运行时）**：

| 包名 | 声明版本 | 实际版本 | 用途 | 是否使用 |
|------|---------|---------|------|---------|
| `react` | `^18.2.0` | 18.3.1 | UI 框架 | ✅ 使用（全部组件 + hooks） |
| `react-dom` | `^18.2.0` | 18.3.1 | React DOM 渲染 | ✅ 使用（main.tsx） |

**结论**：✅ **红线 5 达标**——运行时仅 2 个依赖，零额外库（无 UI 框架、无状态管理、无路由）。

**devDependencies（开发/构建）**：

| 包名 | 声明版本 | 实际版本 | 用途 |
|------|---------|---------|------|
| `@types/react` | `^18.2.43` | 18.3.31 | React 类型定义 |
| `@types/react-dom` | `^18.2.17` | 18.3.7 | ReactDOM 类型定义 |
| `@vitejs/plugin-react` | `^4.2.1` | 4.7.0 | Vite React 插件（Fast Refresh） |
| `esbuild` | `^0.21.3` | 0.21.5 | 打包工具（voice-test.ts 测试用） |
| `typescript` | `^5.6.0` | 5.9.3 | TypeScript 编译器 |
| `vite` | `^5.4.0` | 5.4.21 | 开发服务器 + 构建工具 |

**结论**：✅ 合理——全部为构建/开发工具，无多余包。`esbuild` 仅用于 voice-test.ts 的打包测试，非生产依赖。

**版本健康**：
- 所有包均为最新版本范围内。

---

## 3. 安全漏洞扫描

### 3.1 根 package.json

```
$ npm audit (registry.npmjs.org)
found 0 vulnerabilities
```

**结论**：✅ **零漏洞**。

### 3.2 client/package.json

```
$ npm audit (registry.npmjs.org)
2 vulnerabilities (1 moderate, 1 high)
```

| 漏洞 | 严重度 | 包名 | 受影响版本 | 问题描述 | 修复方案 |
|------|--------|------|-----------|---------|---------|
| GHSA-67mh-4wv8-2f99 | **moderate** | `esbuild` | `<=0.24.2` | esbuild 开发服务器允许任意网站发送请求并读取响应（CSWSH 类漏洞） | 升级到 `esbuild@0.28.2+` |
| 同上（传递依赖） | **high** | `vite` | `<=6.4.2` | vite 依赖了有漏洞的 esbuild 版本 | 升级到 `vite@7.0.0+` 或 `npm audit fix --force` |

**影响评估**：
- **仅影响开发环境**：`esbuild` 和 `vite` 均为 devDependencies，不参与生产构建产物。漏洞仅在 `vite dev` 开发服务器运行时存在。
- **生产构建不受影响**：`vite build` 生成的静态文件不包含 esbuild 代码。
- **修复代价**：`npm audit fix --force` 会升级 esbuild 到 0.28.2（breaking change），可能影响 voice-test.ts 的 esbuild 打包脚本。

**建议**：
- P1：升级到 `esbuild@0.28.2+` + `vite@7.0.0+`（需测试 voice-test.ts 是否仍正常）
- 或接受风险（仅开发环境漏洞，不影响生产部署）

### 3.3 npm audit 失败记录（npmmirror 镜像）

```
$ npm audit (registry.npmmirror.com)
npm warn audit 404 Not Found - [NOT_IMPLEMENTED] /-/npm/v1/security/* not implemented yet
```

**原因**：npmmirror 镜像尚未实现 `/security/advisories` 端点，需使用官方 registry（registry.npmjs.org）或切换到 GitHub Advisory Database。

**结论**：已通过官方 registry 成功执行审计，结果可信。

---

## 4. 配置与密钥安全

### 4.1 tsconfig.json（根）

| 检查项 | 结果 | 详情 |
|--------|------|------|
| `strict` 模式 | ✅ 开启 | `"strict": true` |
| `module` / `moduleResolution` | ✅ 正确 | `"nodenext"` / `"nodenext"`（Node.js ESM 标准） |
| `allowImportingTsExtensions` | ✅ 开启 | 支持 `.ts` 扩展名导入（Node 22 + `--experimental-strip-types` 需要） |
| `noEmit` | ✅ 开启 | 仅做类型检查，不生成 JS（由 Node 运行时直接执行 TS） |
| `include` 范围 | ✅ 合理 | `["app", "avatar", "brain", "config", "persona", "voice-shell"]`，不含 `cybergirlfriend/`、`node_modules`、`client` |
| `types` | ✅ 合理 | `["node"]`（仅 Node.js 全局类型） |

**结论**：✅ 配置完全合理。

### 4.2 client/tsconfig.json

| 检查项 | 结果 | 详情 |
|--------|------|------|
| `strict` 模式 | ✅ 开启 | `"strict": true` |
| `module` / `moduleResolution` | ✅ 正确 | `"ESNext"` / `"bundler"`（Vite 标准配置） |
| `jsx` | ✅ 正确 | `"react-jsx"`（React 17+ 自动 JSX 运行时） |
| `include` 范围 | ✅ 合理 | `["src"]`，不含旧目录 |
| `types` | ✅ 合理 | `["vite/client"]`（Vite 客户端类型） |

**结论**：✅ 配置完全合理。

### 4.3 密钥安全

| 检查项 | 结果 | 详情 |
|--------|------|------|
| `.env.example` 含真实密钥 | ✅ 安全 | 所有密钥字段为空或占位符，无真实 Key |
| `config/apikeys.example.json` 含真实密钥 | ✅ 安全 | `apiKey` 字段均为空字符串 `""`，`binPath` 为示例路径 |
| `config/apikeys.json` 被 .gitignore 忽略 | ✅ 已忽略 | `git check-ignore -v` 确认：`.gitignore:8:config/apikeys.json` |
| `.env` / `.env.local` 被 .gitignore 忽略 | ✅ 已忽略 | `.gitignore:9-10:.env` + `.env.local` |
| 代码中硬编码密钥（`sk-`） | ✅ 未发现 | `grep -r "sk-"` 零匹配 |
| 代码中硬编码密钥（`apiKey=`） | ✅ 未发现 | `grep -r "apiKey="` 仅匹配 config/loader.ts 的配置读取逻辑和 example 文件 |

**结论**：✅ **密钥管理完全合规**——红线 8（配置集中管理）达标，无硬编码密钥，敏感文件全部 gitignored。

### 4.4 .gitignore 覆盖检查

| 类别 | 覆盖情况 |
|------|---------|
| 依赖目录 | ✅ `node_modules/` |
| 构建产物 | ✅ `dist/`、`build/`、`*.tsbuildinfo` |
| 密钥配置 | ✅ `config/apikeys.json`、`.env`、`.env.local`、`.env.*.local` |
| 素材大文件 | ✅ `assets/avatars/*`（例外 `!manifest.json`）、`assets/*.mp4`、`assets/*.mov` |
| 日志 | ✅ `logs/`、`*.log`、`npm-debug.log*` |
| 测试产物 | ✅ `coverage/`、`test-results/`、`playwright-report/` |
| 临时文件 | ✅ `.tmp-probe/`、`*.tmp.json`、`tests/_tmp_*.ts`、`client/.tmp/` |
| 编辑器/系统 | ✅ `.idea/`、`.vscode/`、`*.swp`、`.DS_Store`、`Thumbs.db` |
| 旧脚手架 | ✅ `cybergirlfriend/_tmp_*`、`cybergirlfriend/.tools/`、`cybergirlfriend/node_modules/` |

**结论**：✅ **覆盖完整**，无遗漏。

---

## 5. 红线合规总结

| 红线 | 检查项 | 结果 |
|------|--------|------|
| 红线 5：依赖最小化 | 根仅 express+ws，client 仅 react+react-dom | ✅ 达标 |
| 红线 8：配置集中管理 | 密钥走 config/loader.ts，无硬编码 | ✅ 达标 |
| 红线 9：零原生编译 | 根运行时依赖均为纯 JS（express、ws） | ✅ 达标 |

---

## 6. 发现与建议

### 问题清单

| # | 严重度 | 来源 | 问题 | 建议 |
|---|--------|------|------|------|
| D1 | 🟡 中 | client npm audit | `esbuild@0.21.5` 存在 moderate 漏洞（开发服务器 CSWSH），影响 `vite@5.4.21` | 升级到 `esbuild@0.28.2+` + `vite@7.0.0+`，测试 voice-test.ts 兼容性 |
| D2 | 🟢 低 | npm outdated | `express 4.22.2 → 5.2.1` 有 major 版本更新可用 | 4.x 稳定 LTS，当前无需升级；5.x 可在下个大版本评估 |
| D3 | 🟢 信息 | npm audit | npmmirror 镜像不支持 audit 端点 | 审计时使用 `--registry=https://registry.npmjs.org` |

### 优点（做得好的地方）

1. **依赖最小化极致**：根运行时仅 2 个包，client 运行时仅 2 个包，完美符合红线 5
2. **devDependencies 分类清晰**：类型定义（@types/*）+ 构建工具（typescript/vite/esbuild），无冗余
3. **密钥零硬编码**：所有敏感配置走文件 + 环境变量，代码中无任何密钥痕迹
4. **`.gitignore` 全面覆盖**：从依赖到构建产物到密钥到素材到临时文件，无遗漏
5. **tsconfig 严格模式**：根和 client 均开启 `strict: true`，类型安全度高

---

*CC-02 依赖与安全审计报告 v1.0 · 2026-08-11 · Claude Code 生成*

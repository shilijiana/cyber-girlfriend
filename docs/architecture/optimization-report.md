# 赛博女友 · 架构优化报告 v1.0

> **审查范围**：persona 模块改为 Hermes 维护、APIKEY 集中配置、支撑层与前端轻量化
> **审查日期**：2026-08-09
> **审查依据**：cybergirlfriend/ 旧脚手架全部源码 + 架构总纲 v1.1 + 模块契约 v1.1

---

## 一、persona 模块变更：人设归 Hermes 维护

### 1.1 问题

当前 persona 模块设计为自己存储角色卡文件（`character-silly.json`）并组装 instructions。但老板明确"具体的事情有 Hermes 负责"——人设本质上是 Hermes 的人格配置，应该由 Hermes 统一管理和维护，赛博女友只做消费方。

### 1.2 新设计

赛博女友 persona 模块**只保留抽象接口**，不存储角色卡文件：

```
Hermes（人设管理者）          赛博女友 persona（消费者）
┌─────────────────┐          ┌──────────────────────┐
│ 人设配置存储      │          │ PersonaProvider 接口  │
│ 人设组装/切换     │◄────────│ listPersonas()       │
│ 人设热加载        │          │ getPersona(id)       │
│ 角色卡 CRUD      │          │ buildInstructions()  │
└─────────────────┘          └──────────────────────┘
```

### 1.3 新接口定义

```ts
// persona/provider.ts — 赛博女友只定义接口，不实现
export interface PersonaProvider {
  /** 获取可用人设列表 */
  listPersonas(): Promise<PersonaInfo[]>;
  /** 加载指定人设 */
  getPersona(id: string): Promise<Persona>;
  /** 人设 → Qwen instructions 文本 */
  buildInstructions(persona: Persona): string;
  /** 切换当前活跃人设 */
  switchPersona(id: string): Promise<void>;
}

export interface PersonaInfo {
  id: string;
  name: string;
  description: string;
  avatar?: string; // 头像标识
}

export interface Persona {
  id: string;
  name: string;
  instructions: string;       // Hermes 预组装好的 instructions 文本
  voiceConfig?: {             // 可选语音参数
    voiceId?: string;         // Qwen-Audio 音色 ID
    emotion?: string;         // 默认情绪
  };
  postHistoryInstructions?: string; // 对话后指令（function_call 引导）
}
```

### 1.4 实现方式

**HermesPersonaProvider**（默认实现）：通过 `hermes -z` 子进程获取人设数据。

```
listPersonas()  →  hermes -z "列出所有可用人设"  →  解析 stdout JSON
getPersona(id)  →  hermes -z "加载人设 <id>"     →  解析 stdout JSON
switchPersona() →  hermes -z "切换到人设 <id>"    →  确认
```

**预留**：
- `FilePersonaProvider`：从指定路径加载人设 JSON（Hermes 写文件，赛博女友读文件，免去子进程开销）
- `HttpPersonaProvider`：从 Hermes MCP serve 获取（常驻模式）

### 1.5 删除的内容

| 删除 | 原因 |
|------|------|
| `persona/character-silly.json` | 角色卡数据归 Hermes，不在赛博女友存储 |
| `persona/prompt-builder.ts` 中的组装逻辑 | instructions 由 Hermes 预组装，赛博女友直接用 |

### 1.6 影响范围

- **module-contracts.md**：`PersonaBuilder` 接口替换为 `PersonaProvider`
- **TASKS.md**：PS-01（角色卡定义）改为"PersonaProvider 接口实现"；PS-02（prompt-builder）改为"HermesPersonaProvider 子进程调用"
- **BLUEPRINT.md**：persona 模块描述更新
- **ADR**：新增 ADR-007（人设归 Hermes 维护）

---

## 二、APIKEY 集中配置文件

### 2.1 问题

当前密钥散落在 `.env`、`mcp-servers.ts`（硬编码 `process.env`）、`server/index.ts`（`process.env.CODEBUDDY_API_KEY`）等多处，不集中、难管理。

### 2.2 新设计

新增 `config/` 目录，集中管理所有配置：

```
config/
├── apikeys.json          # 实际密钥配置（.gitignore 忽略）
├── apikeys.example.json  # 模板（入库，供参考）
└── loader.ts             # 配置加载器（文件优先，环境变量兜底）
```

### 2.3 配置文件结构

```json
// config/apikeys.example.json
{
  "dashscope": {
    "apiKey": "",
    "workspaceId": "",
    "region": "cn-beijing",
    "model": "qwen-audio-3.0-realtime-flash"
  },
  "hermes": {
    "binPath": "hermes",
    "modelProvider": "deepseek",
    "apiKey": "",
    "baseUrl": ""
  },
  "server": {
    "port": 3000,
    "host": "localhost"
  },
  "avatar": {
    "assetsPath": "assets/avatars"
  }
}
```

### 2.4 加载器

```ts
// config/loader.ts
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export interface AppConfig {
  dashscope: {
    apiKey: string;
    workspaceId: string;
    region: string;
    model: string;
  };
  hermes: {
    binPath: string;
    modelProvider: string;
    apiKey: string;
    baseUrl: string;
  };
  server: {
    port: number;
    host: string;
  };
  avatar: {
    assetsPath: string;
  };
}

const CONFIG_PATH = resolve(process.cwd(), 'config', 'apikeys.json');

export function loadConfig(): AppConfig {
  // 1. 尝试读配置文件
  if (existsSync(CONFIG_PATH)) {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const fileConfig = JSON.parse(raw);
    return mergeWithEnv(fileConfig);
  }
  // 2. 无文件则全走环境变量
  return fromEnv();
}

function mergeWithEnv(file: Partial<AppConfig>): AppConfig {
  // 文件优先，环境变量兜底
  return {
    dashscope: {
      apiKey: file.dashscope?.apiKey || process.env.DASHSCOPE_API_KEY || '',
      workspaceId: file.dashscope?.workspaceId || process.env.DASHSCOPE_WORKSPACE_ID || '',
      region: file.dashscope?.region || 'cn-beijing',
      model: file.dashscope?.model || 'qwen-audio-3.0-realtime-flash',
    },
    hermes: {
      binPath: file.hermes?.binPath || process.env.HERMES_BIN || 'hermes',
      modelProvider: file.hermes?.modelProvider || process.env.HERMES_MODEL_PROVIDER || 'deepseek',
      apiKey: file.hermes?.apiKey || process.env.HERMES_API_KEY || '',
      baseUrl: file.hermes?.baseUrl || process.env.HERMES_BASE_URL || '',
    },
    server: {
      port: file.server?.port || Number(process.env.PORT) || 3000,
      host: file.server?.host || process.env.HOST || 'localhost',
    },
    avatar: {
      assetsPath: file.avatar?.assetsPath || 'assets/avatars',
    },
  };
}

function fromEnv(): AppConfig {
  return mergeWithEnv({});
}

export const config = loadConfig();
```

### 2.5 使用方式

```ts
// 任何模块直接 import
import { config } from '../config/loader';

const wsUrl = `wss://${config.dashscope.workspaceId}.${config.dashscope.region}.maas.aliyuncs.com/api-ws/v1/realtime?model=${config.dashscope.model}`;
```

### 2.6 安全规则

- `config/apikeys.json` 加入 `.gitignore`
- `config/apikeys.example.json` 入库作为模板
- 密钥不硬编码在源码中
- 日志输出时脱敏（只显示前 8 位 + `****`）

---

## 三、支撑层与前端代码审查

### 3.1 旧脚手架现状统计

| 层 | 文件数 | 代码行数 | 说明 |
|---|---|---|---|
| server/ | 4 文件 | ~1024 行 | index.ts 671 + db.ts 228 + mcp-servers.ts 56 + clip-matcher.ts 69 |
| src/hooks/ | 5 文件 | ~728 行 | useChat 392 + useSessions 160 + useAgents 90 + useModels 42 + useTheme 44 |
| src/components/ | 10 文件 | ~3224 行 | SettingsPage 761 + ToolCallsCollapse 767 + AgentConfigDialog 357 等 |
| src/ 其他 | 5 文件 | ~340 行 | App.tsx 207 + config.ts 21 + types.ts 88 + main.tsx + iconMap.ts |
| **合计** | **24 文件** | **~5316 行** | |

### 3.2 运行时依赖审查

| 依赖 | 版本 | 体积 | 处置 | 原因 |
|------|---|---|---|---|
| `@tencent-ai/agent-sdk` | ^0.3.43 | 重 | **删除** | ADR-002 弃用 SDK |
| `better-sqlite3` | ^12.6.2 | 重（原生编译） | **删除** | ADR-006 无数据库 |
| `react-router-dom` | ^7.13.0 | 中 | **删除** | 单页面应用，不需要路由 |
| `uuid` | ^9.0.0 | 轻 | **删除** | 用 `crypto.randomUUID()` 替代 |
| `@tdesign-react/aigc` | ^0.1.0-alpha | 中 | **删除** | AIGC 专用组件，项目不需要 |
| `@tdesign-react/chat` | ^1.0.2 | 中 | **删除** | 聊天 UI 自研更轻量 |
| `tdesign-icons-react` | ^0.5.0 | 轻 | **删除** | 与 lucide-react 冗余 |
| `tdesign-react` | ^1.12.0 | 重 | **评估** | 见下方分析 |
| `lucide-react` | ^0.563.0 | 轻 | **保留** | 图标库，tree-shake 友好 |
| `express` | ^4.18.2 | 轻 | **保留** | 后端框架 |
| `react` | ^18.2.0 | 轻 | **保留** | 前端框架 |
| `react-dom` | ^18.2.0 | 轻 | **保留** | React DOM |
| **保留** | | | **5 个** | 从 13 → 5 |

### 3.3 TDesign 去留分析

**保留 TDesign 的理由**：
- 提供完整的 UI 组件（Button、Input、Dialog、Message 等）
- 中文文档好，TDesign 生态成熟

**删除 TDesign 的理由**：
- `tdesign-react` + `@tdesign-react/chat` + `tdesign-icons-react` + `@tdesign-react/aigc` = 4 个包
- 项目前端极简（聊天框 + 数字人画布 + 字幕条 + 波形），不需要复杂组件库
- Tailwind CSS 已在，可以覆盖 90% 样式需求
- 删掉后运行时依赖从 13 → 5 个

**建议：删除 TDesign 全家桶**，用 Tailwind + 少量内联组件。项目前端总共就 4-5 个组件，不需要重型 UI 库。

### 3.4 前端组件裁剪清单

| 组件 | 行数 | 处置 | 原因 |
|------|---|---|---|
| AgentConfigDialog.tsx | 357 | **删除** | 单一人设，无多 Agent 配置 |
| SettingsPage.tsx | 761 | **删除** | 设置页依赖 SDK/DB，无持久化不需要 |
| ToolCallsCollapse.tsx | 767 | **删除** | SDK 工具调用展示，不再有 |
| PermissionDialog.tsx | 212 | **删除** | SDK 权限系统，不再有 |
| NewChatDialog.tsx | 204 | **删除** | 多 Agent 新建对话，不需要 |
| NewChatView.tsx | 157 | **删除** | 同上 |
| InlinePermissionCard.tsx | 143 | **删除** | SDK 权限卡片，不需要 |
| Sidebar.tsx | 142 | **简化→~30 行** | 去掉会话列表/Agent 切换，只留 logo + 主题切换 |
| Header.tsx | 105 | **简化→~20 行** | 去掉模型选择器/Agent 显示，只留标题 + 人设名 |
| ChatMessages.tsx | 202 | **简化→~80 行** | 去掉工具调用展示，只留文本气泡 |
| ChatInput.tsx | 174 | **简化→~50 行** | 去掉权限模式，只留输入框 + 发送 |
| **新增** AvatarCanvas.tsx | ~60 | **新建** | 数字人画布 |
| **新增** CaptionBar.tsx | ~30 | **新建** | 字幕条 |
| **新增** VoiceWaveform.tsx | ~40 | **新建** | 情绪波形 |

**前端代码量变化**：3224 行 → ~310 行（裁减 90%）

### 3.5 Hook 裁剪清单

| Hook | 行数 | 处置 | 原因 |
|------|---|---|---|
| useAgents.ts | 90 | **删除** | 单一人设，不需要多 Agent 管理 |
| useSessions.ts | 160 | **删除** | 无持久化，不需要会话 CRUD |
| useModels.ts | 42 | **删除** | Qwen-Audio 固定，不需要模型选择 |
| useChat.ts | 392 | **重写→~100 行** | SSE 流式保留，去掉 SDK/DB/权限逻辑 |
| useTheme.ts | 44 | **保留** | 主题切换，通用 |
| **新增** useVoice.ts | ~80 | **新建** | 语音会话状态机 |
| **新增** useAvatar.ts | ~50 | **新建** | 数字人控制 |

**Hook 代码量变化**：728 行 → ~274 行（裁减 62%）

### 3.6 服务端裁剪清单

| 文件 | 行数 | 处置 | 原因 |
|------|---|---|---|
| server/index.ts | 671 | **重写→~200 行** | 去掉 SDK/DB/权限/模型缓存，保留 Express + WS + SSE |
| server/db.ts | 228 | **删除** | ADR-006 无数据库 |
| server/mcp-servers.ts | 56 | **删除** | MCP 归 Hermes 原生 |
| server/avatar/clip-matcher.ts | 69 | **迁移** | 迁移到 avatar/ 模块，逻辑不变 |

**服务端代码量变化**：1024 行 → ~269 行（裁减 74%）

### 3.7 总体代码量变化

| 层 | 旧 | 新 | 变化 |
|---|---|---|---|
| 服务端 | 1024 行 | ~269 行 | -74% |
| 前端组件 | 3224 行 | ~310 行 | -90% |
| 前端 Hooks | 728 行 | ~274 行 | -62% |
| 前端其他 | ~340 行 | ~150 行 | -56% |
| **合计** | **~5316 行** | **~1003 行** | **-81%** |

### 3.8 运行时依赖变化

| 旧（13 个） | 新（5 个） |
|---|---|
| @tdesign-react/aigc | ~~删除~~ |
| @tdesign-react/chat | ~~删除~~ |
| @tencent-ai/agent-sdk | ~~删除~~ |
| better-sqlite3 | ~~删除~~ |
| react-router-dom | ~~删除~~ |
| tdesign-icons-react | ~~删除~~ |
| tdesign-react | ~~删除~~ |
| uuid | ~~删除~~ |
| **express** | **保留** |
| **react** | **保留** |
| **react-dom** | **保留** |
| **lucide-react** | **保留** |
| | **新增 ws**（WebSocket，如 Express 不够用） |

**依赖从 13 → 5-6 个，全部纯 JS，零原生编译。**

### 3.9 开发依赖变化

| 旧（19 个） | 处置 |
|---|---|
| @types/better-sqlite3 | **删除** |
| @types/uuid | **删除** |
| vitest / @vitest/coverage-v8 / @playwright/test | **暂停**（保留配置，不激活） |
| less | **删除**（TDesign 删掉后不需要） |
| **保留** | @types/express, @types/node, @types/react, @types/react-dom, @vitejs/plugin-react, autoprefixer, concurrently, postcss, tailwindcss, tsx, typescript, vite |

**开发依赖从 19 → 12 个。**

---

## 四、优化后的目录结构

```
赛博女友/
├── config/
│   ├── apikeys.json           # 密钥配置（gitignore）
│   ├── apikeys.example.json   # 密钥模板（入库）
│   └── loader.ts              # 配置加载器
├── voice-shell/
│   ├── README.md
│   ├── qwen-audio-client.ts   # Qwen Realtime WS 客户端
│   └── gateway.ts             # /ws/voice 中继
├── brain/
│   ├── README.md
│   ├── hermes-runner.ts       # hermes -z 子进程
│   └── function-router.ts     # Function Calling 中转
├── persona/
│   ├── README.md
│   └── provider.ts            # PersonaProvider 接口 + HermesPersonaProvider
│   （不存角色卡文件，人设数据归 Hermes）
├── avatar/
│   ├── README.md
│   ├── clip-matcher.ts        # 素材匹配引擎（迁移自旧脚手架）
│   └── manifest.json
├── app/
│   ├── README.md
│   ├── server/
│   │   ├── index.ts           # Express 装配（~100 行）
│   │   └── orchestrator.ts    # Core Orchestrator（~100 行）
│   └── types.ts               # 共享类型
├── client/
│   ├── README.md
│   ├── App.tsx                # 单页面（~50 行）
│   ├── main.tsx               # 入口
│   ├── components/
│   │   ├── ChatMessages.tsx   # 聊天气泡（~80 行）
│   │   ├── ChatInput.tsx      # 输入框（~50 行）
│   │   ├── AvatarCanvas.tsx   # 数字人画布（~60 行）
│   │   ├── CaptionBar.tsx     # 字幕条（~30 行）
│   │   └── VoiceWaveform.tsx  # 情绪波形（~40 行）
│   ├── hooks/
│   │   ├── useVoice.ts        # 语音状态机（~80 行）
│   │   ├── useChat.ts         # 文本聊天（~100 行）
│   │   ├── useAvatar.ts       # 数字人控制（~50 行）
│   │   └── useTheme.ts        # 主题切换（~44 行）
│   ├── voice/
│   │   └── audio.ts           # 采集/播放/能量分析（~60 行）
│   ├── index.css              # Tailwind 入口
│   └── config.ts              # 前端常量
├── assets/
│   └── avatars/               # 素材库（gitignore）
├── docs/
│   └── ...                    # 文档中心
├── scripts/
│   └── ...
├── tests/                     # 暂停
├── cybergirlfriend/           # 旧脚手架（迁移完成后删除）
├── DESIGN.md
├── PROJECT_MEMORY.md
├── .gitignore
├── package.json               # 5-6 运行时依赖
├── tsconfig.json
├── vite.config.ts
└── tailwind.config.js
```

---

## 五、优化总结

| 维度 | 优化前 | 优化后 | 改善 |
|------|--------|--------|------|
| 运行时依赖 | 13 个 | 5-6 个 | -54%，零原生编译 |
| 开发依赖 | 19 个 | 12 个 | -37% |
| 总代码量 | ~5316 行 | ~1003 行 | -81% |
| 前端组件 | 10 个（3224 行） | 5 个（~310 行） | -90% |
| 数据库 | better-sqlite3 | 无 | 零持久化 |
| 人设存储 | 本地 JSON 文件 | Hermes 维护 | 统一管理 |
| 密钥配置 | 散落 .env + 硬编码 | config/ 集中管理 | 统一管理 |

---

*优化报告 v1.0 · 2026-08-09 · 轻量级配置，最小依赖，最小体积*

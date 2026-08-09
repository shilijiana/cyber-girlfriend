# app · 应用壳 🖥️

**职责**：赛博女友的"骨架"——Express 装配所有模块、路由、WS、SSE，把能力层串起来。

## 核心功能

| 文件 | 说明 |
|------|------|
| `server/index.ts` | Express 装配：路由、中间件、SSE、WS 服务、启动 |
| `server/routes.ts` | REST API：/api/health、/api/chat、/api/memory、/api/mcp/status、/api/avatar/status |

## 接口一览（v1）

### REST
| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/health | 健康检查 |
| POST | /api/chat | 文本聊天（调试/无语音场景） |
| GET | /api/memory | 长期记忆档案查询 |
| POST | /api/memory | 写入记忆 |
| GET | /api/avatar/status | 数字人引擎状态 |
| GET | /api/brain/status | Hermes 可用性探测 |

### WebSocket
| 路径 | 说明 |
|------|------|
| /ws/voice | 语音主链路：音频上行（PCM 16k）+ 音频下行（PCM 24k）+ 控制事件 + 字幕副文本 |

## 与旧脚手架的关系

本模块由 `cybergirlfriend/server/` 迁移重构而来：
- ✅ 保留：Express 结构、条件 listen（测试友好）、SSE 骨架
- 🔧 重构：移除 CodeBuddy Agent SDK query 调用 → 改为编排 voice-shell/brain/persona/memory
- 🗑️ 废弃：mcp-servers.ts（MCP 能力移交 Hermes 原生）

## 相关

- 接口定义：DESIGN.md §7
- 架构总纲：`docs/architecture/overall-architecture.md`

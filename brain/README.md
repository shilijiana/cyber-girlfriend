# brain · 大脑 🧠

**职责**：赛博女友的"大脑和手"——接收语音壳转来的复杂事务，实际执行干活。**记忆与事务状态由 Hermes 自身管理**，赛博女友侧不持久化。

## 核心功能

| 文件 | 说明 |
|------|------|
| `hermes-runner.ts` | `hermes -z "任务"` 子进程调用（120s 超时、1MB 输出上限），捕获 stdout 结果文本 |
| `function-router.ts` | Function Calling 中转（BR-02）：拦截 Qwen 的 `function_call("hermes_brain")` → 调 hermes-runner → `function_call_output` 写回；含事件提取 / 工具 schema / 写回事件构造（契约 v1.4 §2.8） |

## 快速使用（function-router）

```ts
import { functionRouter, extractFunctionCall, buildFunctionCallOutputEvent, hermesBrainTool } from './function-router.ts';

// voice-shell（VS-06）接入：
// ① 注册工具：session.update({ tools: [hermesBrainTool] })
// ② 收到下行事件 → 提取 + 执行：
const call = extractFunctionCall(event);          // 非 function_call 事件返回 null
if (call) {
  const out = await functionRouter.handle(call);  // { callId, output, status }
  ws.send(buildFunctionCallOutputEvent(out));     // 写回 → 再发 response.create
}
```

## 关键约束

- **无状态调用**：每次 `hermes -z` 是独立执行，本模块只负责"干活并返回文本"
- **记忆归 Hermes**：跨会话记忆、偏好、事务状态由 Hermes 自带记忆系统维护，本模块不存储
- **文本中转**：只接收"任务描述 + 上下文摘要"，只返回"结果文本"
- **超时兜底**：Hermes 慢任务设 120s 上限，前端可显示"在干活了..."

## Hermes Agent 能力（v0.20.0 已装）

- 本机：`C:\Users\chipsine\AppData\Local\hermes\hermes-agent`（Python 3.13.14）
- 50+ 内置工具：终端执行（6 种后端）、文件操作、浏览器自动化、Git
- MCP 支持：`hermes mcp serve`（常驻多轮场景可选）
- 200+ 模型、33 provider：DeepSeek/OpenAI/Anthropic/Ollama 随便换
- 自进化：从任务中沉淀可复用技能

## 调用方式

```ts
// one-shot（推荐起步）
hermes -z "批量重命名当前目录所有 .png 为 .jpg"

// 常驻 MCP（复杂多轮，可选）
hermes mcp serve  →  stdio JSON-RPC
```

## 相关

- 集成细节：`混合架构方案-云端语音壳+本地大脑.md` §4/§5
- 架构总纲：`docs/architecture/overall-architecture.md`

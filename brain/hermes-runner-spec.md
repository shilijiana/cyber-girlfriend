# brain/hermes-runner.ts · 实现规格（BR-01）

> **任务卡配套文档**：本文件是 BR-01 的实现规格，新窗口子任务读本文件 + `docs/TASKS-CONFIG.md` §4-BR 即可实现。
> 更新日期：2026-08-09 · 版本 v1.0 · 状态：待实现（📋）

---

## 1. 目标文件

```
brain/hermes-runner.ts   ← 实现本规格的代码（唯一产出）
```

## 2. 接口定义（契约 v1.2，必须匹配）

```ts
// brain/runner.ts（契约定义，可另存）
export interface BrainRunner {
  run(task: BrainTask): Promise<BrainResult>;
}

export interface BrainTask {
  instruction: string;      // 纯文本任务描述（Qwen function_call 的入参）
  context?: string;         // 可选：对话上下文摘要
  timeoutMs?: number;       // 默认 120_000
}

export interface BrainResult {
  ok: boolean;
  output: string;           // Hermes stdout 纯文本
  durationMs: number;
  error?: string;
}
```

> hermes-runner.ts 实现 `run(task)` 方法即可；`BrainRunner/BrainTask/BrainResult` 类型可从契约内联或新建 runner.ts 导出。

## 3. 工作原理（实测验证 ✅）

```
Qwen function_call("hermes_brain", {instruction})
      │
      ▼
function-router（BR-02，后续实现）拦截
      │
      ▼
hermes-runner.run(task)   ← 本文件
      │ spawn 子进程
      ▼
hermes -z "instruction"   ← 本机 Hermes v0.20.0
      │（Hermes 内部调 DeepSeek deepseek-v4-flash）
      ▼
stdout 纯文本结果（如 "2。"）
      │
      ▼
return { ok: true, output: "2。", durationMs: 1234 }
```

**已实测**（2026-08-09 本机验证）：`hermes -z "1+1=?"` → stdout 输出 `2。`，退出码 0。

## 4. 本机 Hermes 实测参数（重要，直接可用）

| 参数 | 实测值 |
|------|--------|
| Hermes 版本 | v0.20.0（2026.8.3） |
| 安装目录 | `C:\Users\chipsine\AppData\Local\hermes\hermes-agent` |
| **可执行文件（binPath）** | `C:/Users/chipsine/AppData/Local/hermes/hermes-agent/.venv/Scripts/hermes` |
| Python | 3.13.14 |
| 默认模型 | `deepseek-v4-flash`（Provider: DeepSeek，API key 已配置 ✅） |
| one-shot 参数 | `-z "任务文本"` |
| 退出行为 | 任务完成即退出，stdout 输出最终答案 |

**config 配置**（`config/apikeys.json` 已就绪）：

```json
"hermes": {
  "binPath": "C:/Users/chipsine/AppData/Local/hermes/hermes-agent/.venv/Scripts/hermes",
  "modelProvider": "deepseek",
  "apiKey": "",
  "baseUrl": ""
}
```

> ⚠️ binPath 用**完整绝对路径**（实测 `which hermes` 能找到，但绝对路径最稳，避免 PATH 差异）。

## 5. 参考实现骨架（可在此基础完善）

```ts
/**
 * brain/hermes-runner.ts —— Hermes 子进程调用器（BR-01）
 *
 * 原理：spawn 子进程执行 `hermes -z "任务"`，捕获 stdout，120s 超时，错误兜底。
 * 无状态：每次调用独立，记忆/事务由 Hermes 自身管理。
 */
import { spawn } from 'child_process';
import { config } from '../../config/loader'; // 取 config.hermes.binPath

export interface BrainTask {
  instruction: string;
  context?: string;
  timeoutMs?: number;
}

export interface BrainResult {
  ok: boolean;
  output: string;
  durationMs: number;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB 输出上限，防内存溢出

export async function runHermes(task: BrainTask): Promise<BrainResult> {
  const started = Date.now();
  const timeoutMs = task.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // 组装命令：hermes -z "instruction"
  const binPath = config.hermes.binPath || 'hermes';
  // context 可选：追加为第二段上下文提示（Hermes 理解任务背景）
  const prompt = task.context
    ? `${task.instruction}\n\n[上下文] ${task.context}`
    : task.instruction;

  return new Promise<BrainResult>((resolve) => {
    const child = spawn(binPath, ['-z', prompt], {
      windowsHide: true,                    // Windows 下隐藏黑窗口
      stdio: ['ignore', 'pipe', 'pipe'],    // 不喂 stdin，只收 stdout/stderr
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    // 输出上限保护：超 1MB 停止累积（防止 Hermes 刷屏）
    const onData = (buf: Buffer, sink: { append: (s: string) => void }) => {
      if (stdout.length + stderr.length < MAX_OUTPUT_BYTES) {
        sink.append(buf.toString('utf-8'));
      }
    };
    child.stdout.on('data', (d: Buffer) => onData(d, { append: (s) => (stdout += s) }));
    child.stderr.on('data', (d: Buffer) => onData(d, { append: (s) => (stderr += s) }));

    // 超时兜底：到点杀掉子进程
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();                       // 强制终止
        resolve({
          ok: false,
          output: stdout.trim(),
          durationMs: Date.now() - started,
          error: `Hermes 任务超时（>${timeoutMs}ms），已终止`,
        });
      }
    }, timeoutMs);

    // 结束回调：正常/异常退出统一收口
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const hasError = code !== 0 || /error|traceback|exception/i.test(stderr);
      resolve({
        ok: !hasError,
        output: stdout.trim(),
        durationMs: Date.now() - started,
        error: hasError
          ? stderr.trim() || `Hermes 退出码 ${code}`
          : undefined,
      });
    });

    // spawn 本身失败（binPath 不存在等）
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        output: '',
        durationMs: Date.now() - started,
        error: `无法启动 Hermes：${err.message}`,
      });
    });
  });
}

/** BrainRunner 适配器：与契约 BrainRunner 接口对齐 */
export const brainRunner: { run: (task: BrainTask) => Promise<BrainResult> } = {
  run: runHermes,
};

export default runHermes;
```

## 6. 验收标准（BR-01，自检用）

| # | 验收点 | 自检方法 |
|---|--------|----------|
| 1 | `hermes -z` 子进程调用 | `runHermes({instruction:'1+1=?'})` → output 含 `2` |
| 2 | 120s 超时 | 传 `timeoutMs: 100`，任务挂起时返回 `ok:false` + 超时提示 |
| 3 | stdout 捕获 | 输出为 Hermes 答案纯文本（trim 后） |
| 4 | 错误兜底 | binPath 填不存在路径 → `ok:false` + "无法启动"；Hermes 任务失败 → `ok:false` + stderr 摘要 |
| 5 | 环境可跑 | 已撤销环境红线，可执行 `npx tsc --noEmit` 校验类型（若有 tsconfig）或 `node --experimental-strip-types` 试跑 |

## 7. 边界与红线

- ✅ 只做 hermes-runner.ts，不实现 function-router（那是 BR-02）
- ✅ 无状态、无持久化、无数据库（红线 1）
- ✅ 不 import brain 以外模块的内部实现；只依赖 `config/loader.ts`
- ✅ 依赖最小化：只 Node 内置 `child_process`，不新增依赖（红线 5）
- ⚠️ 文本中转不漂移：instruction/output 只传纯文本（红线 4）

---

*hermes-runner 规格 v1.0 · 2026-08-09 · BR-01 配套文档（实测数据已验证）*

/**
 * brain/hermes-runner.ts —— Hermes 子进程调用器（BR-01）
 *
 * 原理：spawn 子进程执行 `hermes -z "任务"`，捕获 stdout，120s 超时，错误兜底。
 * 无状态：每次调用独立，记忆/事务由 Hermes 自身管理（红线 1）。
 * 依赖最小化：仅 Node 内置 child_process + 项目 config/loader.ts（红线 5）。
 *
 * 实测参考（2026-08-09）：本机 Hermes v0.20.0，
 *   binPath = C:/Users/chipsine/AppData/Local/hermes/hermes-agent/.venv/Scripts/hermes
 *   `hermes -z "1+1=?"` → stdout `2。`，退出码 0。
 */
import { spawn } from 'child_process';
import { config } from '../config/loader.ts';

/** 任务输入（契约 v1.2） */
export interface BrainTask {
  instruction: string;   // 纯文本任务描述（Qwen function_call 的入参）
  context?: string;      // 可选：对话上下文摘要
  timeoutMs?: number;    // 默认 120_000
}

/** 执行结果（契约 v1.2） */
export interface BrainResult {
  ok: boolean;
  output: string;        // Hermes stdout 纯文本
  durationMs: number;
  error?: string;
}

/** BrainRunner 契约接口（BR-02 function-router 将依赖此接口） */
export interface BrainRunner {
  run(task: BrainTask): Promise<BrainResult>;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB 输出上限，防 Hermes 刷屏导致内存溢出
/** stderr 中出现这些关键词视为 Hermes 内部失败（而非正常结果） */
const STDERR_ERROR_PATTERN = /error|traceback|exception/i;

/**
 * 执行一次 Hermes 任务（one-shot）。
 * @param task 任务描述；instruction 必填，context 可选（追加为上下文提示），timeoutMs 默认 120s
 */
export async function runHermes(task: BrainTask): Promise<BrainResult> {
  const started = Date.now();
  const timeoutMs = task.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // 组装命令:hermes --profile <隔离profile> -z "instruction" -t <白名单>
  // (PS-03:专用 profile + 工具集白名单 = 记忆隔离三层中的读/写硬隔离,见 hermes-capabilities-review §3.2)
  const binPath = config.hermes.binPath || 'hermes';
  const prompt = task.context
    ? `${task.instruction}\n\n[上下文] ${task.context}`
    : task.instruction;
  const args: string[] = [];
  if (config.hermes.profile) args.push('--profile', config.hermes.profile);
  args.push('-z', prompt);
  if (config.hermes.toolsets) args.push('-t', config.hermes.toolsets);

  return new Promise<BrainResult>((resolve) => {
    const child = spawn(binPath, args, {
      windowsHide: true,                 // Windows 下隐藏黑窗口
      stdio: ['ignore', 'pipe', 'pipe'], // 不喂 stdin，只收 stdout/stderr
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    // 输出上限保护：超 1MB 停止累积（防止 Hermes 刷屏）
    const onData = (buf: Buffer, append: (s: string) => void) => {
      if (stdout.length + stderr.length < MAX_OUTPUT_BYTES) {
        append(buf.toString('utf-8'));
      }
    };
    child.stdout.on('data', (d: Buffer) => onData(d, (s) => (stdout += s)));
    child.stderr.on('data', (d: Buffer) => onData(d, (s) => (stderr += s)));

    // 超时兜底：到点杀掉子进程
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolve({
        ok: false,
        output: stdout.trim(),
        durationMs: Date.now() - started,
        error: `Hermes 任务超时（>${timeoutMs}ms），已终止`,
      });
    }, timeoutMs);

    // 结束回调：正常/异常退出统一收口
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const hasError = code !== 0 || STDERR_ERROR_PATTERN.test(stderr);
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

/** BrainRunner 适配器：与契约接口对齐（BR-02 直接使用） */
export const brainRunner: BrainRunner = { run: runHermes };

export default runHermes;

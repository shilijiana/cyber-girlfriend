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
import { spawn, type ChildProcess } from 'child_process';
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
/** L12：超时下限保护（timeoutMs = 0/负数/NaN 时兜底 1s，防子进程立刻被杀） */
const MIN_TIMEOUT_MS = 1_000;
/** 输出上限：stdout / stderr 各自独立 1MB（H5：互不挤占，防关键错误信息被大输出淹没） */
const MAX_OUTPUT_BYTES = 1024 * 1024;
/** M6：stderr 错误判定正则——精确匹配错误开头（^Error:/^Traceback/unhandled exception），
 *  避免误判"no error found"等正常日志；m 标志支持多行 stderr 逐行判定 */
const STDERR_ERROR_PATTERN = /^(?:error:|traceback|unhandled exception)/im;
/** L13：并发上限——一次最多一个 Hermes 子进程（冷启动 12~23s，并发 spawn 互相拖慢） */
const MAX_CONCURRENT_RUNS = 1;

/** L13：串行队列——并发调用排队执行，防进程数爆炸 */
let runQueue: Promise<unknown> = Promise.resolve();
function runSerial<T>(fn: () => Promise<T>): Promise<T> {
  const run = runQueue.then(fn);
  runQueue = run.catch(() => undefined); // 队列吞错，不因单次失败中断后续
  return run;
}

/** M7：终止子进程——Windows 下 SIGTERM 不可靠，用 taskkill 强制终止进程树；其他平台 SIGKILL */
function terminateChild(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid) {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
      return;
    } catch {
      // taskkill 失败回退 kill()
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // 进程可能已退出，忽略
  }
}

/**
 * 执行一次 Hermes 任务（one-shot）。
 * @param task 任务描述；instruction 必填，context 可选（追加为上下文提示），timeoutMs 默认 120s
 */
export async function runHermes(task: BrainTask): Promise<BrainResult> {
  // L13：并入串行队列（一次一个子进程）
  return runSerial(() => doRunHermes(task));
}

async function doRunHermes(task: BrainTask): Promise<BrainResult> {
  const started = Date.now();
  // L12：超时下限保护（防 0/负数/NaN 传入导致子进程立即被杀）
  const timeoutMs = Math.max(task.timeoutMs ?? DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS);

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

    // H5：stdout / stderr 独立计数（各 1MB 上限，互不挤占）
    const appendLimited = (buf: Buffer, target: string, append: (s: string) => void): void => {
      if (target.length >= MAX_OUTPUT_BYTES) return;
      const s = buf.toString('utf-8');
      append(s.slice(0, MAX_OUTPUT_BYTES - target.length));
    };
    child.stdout.on('data', (d: Buffer) => appendLimited(d, stdout, (s) => (stdout += s)));
    child.stderr.on('data', (d: Buffer) => appendLimited(d, stderr, (s) => (stderr += s)));

    // 超时兜底：到点强制终止子进程（M7：Windows 用 taskkill 杀进程树，防僵尸）
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      terminateChild(child);
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

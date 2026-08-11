/**
 * tools/subtitle-capture.ts —— 语音字幕抓取器（调试/审核工具）
 *
 * 用途：把语音会话的字幕流（用户转写 + 小呆 AI 字幕）实时写入文件，
 *   供老板审核字幕内容是否正确、完整（2026-08-12：小呆回复字幕显示排查）。
 *
 * 用法：后端启动时设环境变量 SUBTITLE_CAPTURE=1（或任意非空值）即启用，
 *   输出到 docs/reviews/test-reports/subtitle-capture-<时间戳>.log
 *   （ws.ts 装配时挂到 gateway deps.onSubtitle / onInputTranscript）
 *
 * 设计：
 *   - 零依赖（Node 内置 fs/path）、独立工具模块，不影响业务链路
 *   - 按会话分组：每个浏览器 WS 会话一个前缀标记
 *   - 用户转写 completed → 记完整一行；AI 字幕 delta → 每帧记一行（含累计文本，便于审核完整句子）
 *   - 防重：单例模式，多次创建共用同一文件句柄
 *
 * 红线：纯调试工具，业务代码不引用；不改变任何字幕/转写行为。
 */

import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

/** 输出目录：docs/reviews/test-reports/（与测试报告一致） */
const OUT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'reviews', 'test-reports');

/** 环境变量开关：SUBTITLE_CAPTURE 非空即启用 */
const ENABLED = !!process.env.SUBTITLE_CAPTURE;

/** 单例：文件路径 + 行号计数器 */
let captureFile: string | null = null;
let lineNo = 0;

/** 获取输出文件路径（首次调用时创建） */
function ensureFile(): string | null {
  if (!ENABLED) return null;
  if (captureFile) return captureFile;
  try {
    if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    captureFile = resolve(OUT_DIR, `subtitle-capture-${ts}.log`);
    appendFileSync(captureFile, `# 字幕抓取会话开始 @ ${new Date().toLocaleString('zh-CN')}\n`);
    return captureFile;
  } catch (e) {
    console.error('[subtitle-capture] 初始化失败:', e instanceof Error ? e.message : String(e));
    return null;
  }
}

/** 写一行（线程安全：Node 单线程 + appendFileSync 原子追加） */
function writeLine(prefix: string, text: string): void {
  const file = ensureFile();
  if (!file) return;
  lineNo += 1;
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  const safe = text.replace(/\n/g, '⏎').slice(0, 500);
  try {
    appendFileSync(file, `[${lineNo.toString().padStart(4, '0')}] ${time} ${prefix} ${safe}\n`);
  } catch (e) {
    console.error('[subtitle-capture] 写入失败:', e instanceof Error ? e.message : String(e));
  }
}

/** 字幕抓取器（挂 gateway deps） */
export interface SubtitleCapture {
  /** AI 字幕增量（gateway deps.onSubtitle） */
  onSubtitle: (text: string) => void;
  /** 用户语音转写（gateway deps.onInputTranscript） */
  onInputTranscript: (text: string, info: { delta: boolean }) => void;
  /** 当前抓取文件路径（未启用返回 null） */
  readonly file: string | null;
  readonly enabled: boolean;
}

/** 创建字幕抓取器（单例；未启用时为空操作） */
export function createSubtitleCapture(): SubtitleCapture {
  // 每会话字幕累积（AI 增量拼成完整句，便于审核）
  let sessionText = '';
  let sessionCount = 0;

  return {
    get enabled() {
      return ENABLED;
    },
    get file() {
      return captureFile;
    },

    onSubtitle(text: string): void {
      if (!ENABLED) return;
      sessionText += text;
      sessionCount += 1;
      // 每帧记一行：delta 原文 + 累计文本（审核完整句）
      writeLine('[小呆]', `+「${text}」 累计:「${sessionText}」`);
    },

    onInputTranscript(text: string, info: { delta: boolean }): void {
      if (!ENABLED) return;
      if (!info.delta) {
        // 最终完整转写：新会话开始（重置累积）
        sessionText = '';
        sessionCount = 0;
        writeLine('[用户]', `「${text}」`);
      }
      // delta 增量不记（completed 才是完整句）
    },
  };
}

/** 是否启用（供 ws.ts 判断是否挂载） */
export function isSubtitleCaptureEnabled(): boolean {
  return ENABLED;
}

export default createSubtitleCapture;

/**
 * avatar/clip-matcher.ts —— 素材匹配引擎（AV-01）
 *
 * 职责：数字人"选片大脑"——按情绪事件从素材库挑选视频片段，
 * 随机 + 轮换避免重复感，无素材时返回 null（调用方降级 Live2D/静默）。
 *
 * 适配说明（AV-01 迁移，源：cybergirlfriend/server/avatar/clip-matcher.ts 纯函数版）：
 * - 契约对齐：docs/architecture/module-contracts.md §2.5 ClipMatcher（v1.2）
 *   · pickClip(emotion, recentlyPlayed) / buildQueue(targetDurationMs, emotion)
 *   · 素材库改【构造注入】——createClipMatcher(library)，接口方法不再传 library
 *   · buildQueue 目标时长单位改【毫秒】（旧版为秒）
 *   · 类型改名：AvatarEmotion → Emotion、AvatarClip → Clip（公共共享类型，契约 §3.6）
 * - 保持纯逻辑：零依赖、零 IO、零持久化（红线 1/5）；素材库由调用方（AV-02 manifest）注入
 *
 * 核心逻辑（方案已确认）：情绪筛选 → 优先新鲜池随机 → 全播过回退全池轮换 → 无素材返回 null。
 * 队列语义：素材未耗尽时队列内【优先不重复】（避免重复感）；目标时长超过素材总时长时
 * 允许循环回退全池（DESIGN §5.2「片段播完还没说完则循环同情绪片段」），护栏防死循环。
 */

/** 情绪类型（与 voice-shell 情绪事件 / WS 消息 emotion 字段一致，公共共享类型） */
export type Emotion = 'happy' | 'gentle' | 'serious' | 'surprise' | 'neutral';

export const EMOTIONS: Emotion[] = ['happy', 'gentle', 'serious', 'surprise', 'neutral'];

/** 视频片段（对应 manifest.json 条目；AV-02 定稿嘴型活跃度等字段后可扩展） */
export interface Clip {
  id: string;
  emotion: Emotion;
  durationSec: number;
  src: string;
}

/** 素材库（由 manifest.json / 调用方注入） */
export interface ClipLibrary {
  clips: Clip[];
}

/** 契约 v1.2 §2.5：素材匹配引擎接口 */
export interface ClipMatcher {
  /** 按情绪选一个片段；recentlyPlayed 为最近播过的片段 id，优先避开；无素材返回 null */
  pickClip(emotion: Emotion, recentlyPlayed: string[]): Clip | null;
  /** 为目标时长（毫秒）构建播放队列，队列内片段不重复；无素材返回空数组 */
  buildQueue(targetDurationMs: number, emotion: Emotion): Clip[];
}

/** 工具函数：取某情绪下的全部片段（供调用方/前端过滤复用） */
export function clipsByEmotion(library: ClipLibrary, emotion: Emotion): Clip[] {
  return library.clips.filter((clip) => clip.emotion === emotion);
}

/**
 * 创建匹配器实例（素材库构造注入，满足契约接口）。
 * 选片逻辑：按情绪筛选 → 优先"新鲜池"随机 → 全部播过则回退全池轮换 → 无素材返回 null。
 */
export function createClipMatcher(library: ClipLibrary): ClipMatcher {
  const pickClip: ClipMatcher['pickClip'] = (emotion, recentlyPlayed = []) => {
    const candidates = clipsByEmotion(library, emotion);
    if (candidates.length === 0) return null;

    const fresh = candidates.filter((clip) => !recentlyPlayed.includes(clip.id));
    const pool = fresh.length > 0 ? fresh : candidates;
    return pool[Math.floor(Math.random() * pool.length)];
  };

  const buildQueue: ClipMatcher['buildQueue'] = (targetDurationMs, emotion) => {
    const queue: Clip[] = [];
    const played: string[] = []; // 队列内避免重复（契约签名不接收外部 recentlyPlayed）
    let totalMs = 0;
    let guard = 0; // 防死循环护栏

    // L18：护栏动态计算——所需最大轮数 ≈ 目标时长 / 最短片段时长（+2 余量），
    //   再夹在 [10, 500] 绝对区间（防 targetDurationMs 异常大/NaN 时死循环）
    const clips = clipsByEmotion(library, emotion);
    const minDurationMs =
      clips.length > 0 ? Math.min(...clips.map((c) => c.durationSec * 1000)) : 1;
    const maxNeeded =
      Number.isFinite(targetDurationMs) && targetDurationMs > 0
        ? Math.ceil(targetDurationMs / minDurationMs) + 2
        : 0;
    const guardLimit = Math.max(10, Math.min(maxNeeded, 500));

    while (totalMs < targetDurationMs && guard < guardLimit) {
      const clip = pickClip(emotion, played);
      if (!clip) break; // 无素材 → 返回已有队列（可为空，调用方降级）
      queue.push(clip);
      played.push(clip.id);
      totalMs += clip.durationSec * 1000; // 秒 → 毫秒累计
      guard += 1;
    }
    return queue;
  };

  return { pickClip, buildQueue };
}

export default createClipMatcher;

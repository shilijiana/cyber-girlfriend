/**
 * 素材匹配引擎（DESIGN §5.2）
 * 核心业务逻辑：按情绪标签选片、轮换避免重复、无素材时降级。
 * M1 预置核心纯函数（不依赖 IO，便于单元测试），M3 接入播放管线。
 */

export type AvatarEmotion = 'happy' | 'gentle' | 'serious' | 'surprise' | 'neutral';

export const EMOTIONS: AvatarEmotion[] = ['happy', 'gentle', 'serious', 'surprise', 'neutral'];

export interface AvatarClip {
  id: string;
  emotion: AvatarEmotion;
  durationSec: number;
  src: string;
}

export interface ClipLibrary {
  clips: AvatarClip[];
}

/** 取某情绪下的全部片段 */
export function clipsByEmotion(library: ClipLibrary, emotion: AvatarEmotion): AvatarClip[] {
  return library.clips.filter((clip) => clip.emotion === emotion);
}

/**
 * 选片：优先避开最近播过的片段（避免重复感）；
 * 若全部播过则回退到全池轮换；无该情绪素材返回 null（由调用方降级）。
 */
export function pickClip(
  library: ClipLibrary,
  emotion: AvatarEmotion,
  recentlyPlayed: string[] = []
): AvatarClip | null {
  const candidates = clipsByEmotion(library, emotion);
  if (candidates.length === 0) return null;

  const fresh = candidates.filter((clip) => !recentlyPlayed.includes(clip.id));
  const pool = fresh.length > 0 ? fresh : candidates;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * 构建播放队列：为一段预计时长的语音挑选若干片段，总时长覆盖目标；
 * 队列内片段不重复；无素材时返回空数组（调用方降级到 Live2D/静默）。
 */
export function buildQueue(
  library: ClipLibrary,
  emotion: AvatarEmotion,
  targetSec: number,
  recentlyPlayed: string[] = []
): AvatarClip[] {
  const queue: AvatarClip[] = [];
  const played = [...recentlyPlayed];
  let total = 0;
  let guard = 0; // 防死循环护栏

  while (total < targetSec && guard < 100) {
    const clip = pickClip(library, emotion, played);
    if (!clip) break;
    queue.push(clip);
    played.push(clip.id);
    total += clip.durationSec;
    guard += 1;
  }
  return queue;
}

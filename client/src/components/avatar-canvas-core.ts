/**
 * client/src/components/avatar-canvas-core.ts —— AvatarCanvas 纯逻辑核心（CL-01）
 *
 * 职责：把"状态/情绪 → 选片"的决策抽成零 React 依赖的纯函数，
 * 便于 node 直接自检（与 voice-shell 的 *-test.ts 惯例一致），
 * AvatarCanvas.tsx 只做 React 绑定与 video 播放。
 *
 * 依赖：AV-01 clip-matcher（选片）+ AV-04 emotion-matcher（带状态轮换，自动避重）。
 * 边界（规格 §6）：只做播放决策，不重写素材匹配逻辑（那是 AV-01/04 的活）。
 * 红线：纯内存（轮换记忆在 EmotionMatcher 实例内，无持久化）。
 */

import { createEmotionMatcher, type EmotionMatcher } from '../../../avatar/emotion-matcher.ts';
import { EMOTIONS, type Clip, type ClipLibrary, type Emotion } from '../../../avatar/clip-matcher.ts';

/** 画布状态（对齐 voice-shell 状态机：idle 空闲 / speaking AI 说话 / listening 用户说话） */
export type AvatarState = 'idle' | 'speaking' | 'listening';

/** 空态兜底优先级：idle/listening 无专属素材时按此顺序尝试（neutral 优先） */
export const FALLBACK_ORDER: readonly Emotion[] = ['neutral', 'happy', 'gentle', 'serious', 'surprise'];

/**
 * manifest JSON → ClipLibrary（类型收窄 + 非法条目过滤）。
 * AV-02 manifest 的 emotion 在 JSON 里是 string，这里校验为合法 Emotion，
 * 过滤缺失字段/非法情绪条目，保证下游 matcher 只收到合法 Clip（降级不崩）。
 */
export function toClipLibrary(raw: { clips?: Array<Record<string, unknown>> } | null | undefined): ClipLibrary {
  if (!raw || !Array.isArray(raw.clips)) return { clips: [] };
  const clips: Clip[] = [];
  for (const item of raw.clips) {
    const { id, emotion, durationSec, src } = item as Record<string, unknown>;
    if (
      typeof id === 'string' &&
      typeof src === 'string' &&
      typeof durationSec === 'number' &&
      EMOTIONS.includes(emotion as Emotion)
    ) {
      clips.push({ id, emotion: emotion as Emotion, durationSec, src });
    }
  }
  return { clips };
}

/** 创建带状态的情绪匹配器（AV-04：内部维护最近播放窗口，自动避重复） */
export function createAvatarMatcher(library: ClipLibrary): EmotionMatcher {
  return createEmotionMatcher({ library });
}

/**
 * 状态/情绪 → 选片（纯函数，可测）：
 * 2026-08-21 老板需求：**任何状态（idle/listening/speaking）都优先按当前情绪选片**——
 * 打字/语音驱动的情绪切换在空闲或聆听时也立即生效（原 idle/listening 走 FALLBACK_ORDER
 * neutral 兜底，导致打字"切到开心"视频不切换）。
 * - 当前情绪有素材 → 直接选该情绪片段
 * - 该情绪无素材 → 按 FALLBACK_ORDER 兜底（neutral 优先）
 * - 无匹配 → null（调用方降级占位）
 */
export function pickClipForState(
  matcher: EmotionMatcher,
  state: AvatarState,
  emotion: Emotion,
): Clip | null {
  // 任何状态都先按当前情绪选片（情绪驱动的切换即时生效）
  const clip = matcher.pick(emotion);
  if (clip) return clip;
  // 该情绪无素材 → 按兜底顺序尝试（neutral 优先）
  for (const e of FALLBACK_ORDER) {
    const c = matcher.pick(e);
    if (c) return c;
  }
  return null;
}

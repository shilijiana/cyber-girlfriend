/**
 * avatar/emotion-matcher.ts —— 情绪匹配与轮换（AV-04）
 *
 * 职责：在 AV-01 的 ClipMatcher（纯函数）之上封装【带会话状态】的情绪匹配器——
 * 内部维护"最近播放"窗口队列，调用方只需传情绪事件，无需自己维护 recentlyPlayed。
 *
 * 设计要点（规格 docs/tasks/AV-04-emotion-matcher.md）：
 * - 有状态：recentlyPlayed 窗口滑动（默认记住最近 5 个），自动避连续重复
 * - 随机 + 轮换：复用 AV-01 pickClip 逻辑（新鲜池随机 → 全播过回退全池轮换 → 无素材 null）
 * - pick() 内部自动 markPlayed；也提供独立 markPlayed（供调用方手动记录，如外部播放完成回调）
 * - reset() 清空播放记忆（切换人设/会话时调用）
 * - 无持久化（红线 1）：播放记忆仅内存，重启即清
 * - 零依赖（红线 5）：复用 clip-matcher 类型与 createClipMatcher，不新增第三方依赖
 *
 * 对接链路：Qwen-Audio 情绪事件 → dispatcher.onEmotion(e) → EmotionMatcher.pick(e)
 *          → Clip → CL-01 AvatarCanvas 播放
 */

import {
  createClipMatcher,
  type Clip,
  type ClipLibrary,
  type ClipMatcher,
  type Emotion,
} from './clip-matcher.ts';

/** 情绪匹配器构造参数 */
export interface EmotionMatcherOptions {
  /** 素材库（AV-02 manifest；AV-03 素材就位前可用 mock 库注入） */
  library: ClipLibrary;
  /** 最近播放记忆窗口（滑动窗口大小，默认 5） */
  recentlyPlayedWindow?: number;
  /** 可选注入底层匹配器（默认内部 createClipMatcher(library) 复用 AV-01） */
  matcher?: ClipMatcher;
}

/** 带会话状态的情绪匹配器（契约 §2.5 补充，AV-04） */
export interface EmotionMatcher {
  /** 情绪事件 → 选片：内部维护 recentlyPlayed 队列（窗口滑动），自动避重复；无素材返回 null */
  pick(emotion: Emotion): Clip | null;
  /** 记录已播放（选片已自动记录；调用方在外部播放完成时也可手动调用） */
  markPlayed(clipId: string): void;
  /** 重置播放记忆（切换人设/会话时调用，重新从新鲜池开始） */
  reset(): void;
  /** 当前播放记忆窗口内的片段 id 列表（快照，调试/测试用） */
  getRecent(): string[];
}

/**
 * 创建带会话状态的情绪匹配器。
 * pick 流程：底层 AV-01 pickClip（情绪筛选 → 新鲜池随机 → 全播过回退全池轮换）→
 *           选中后自动记入窗口队列；窗口满则挤出最旧（滑动窗口）。
 */
export function createEmotionMatcher(options: EmotionMatcherOptions): EmotionMatcher {
  const windowSize = Math.max(1, options.recentlyPlayedWindow ?? 5);
  const matcher = options.matcher ?? createClipMatcher(options.library);

  let recentlyPlayed: string[] = [];

  /** 记入窗口队列（窗口滑动：超限挤出最旧） */
  function remember(clipId: string): void {
    recentlyPlayed.push(clipId);
    if (recentlyPlayed.length > windowSize) {
      recentlyPlayed = recentlyPlayed.slice(recentlyPlayed.length - windowSize);
    }
  }

  const pick: EmotionMatcher['pick'] = (emotion) => {
    const clip = matcher.pickClip(emotion, recentlyPlayed);
    if (clip) remember(clip.id);
    return clip;
  };

  const markPlayed: EmotionMatcher['markPlayed'] = (clipId) => {
    remember(clipId);
  };

  const reset: EmotionMatcher['reset'] = () => {
    recentlyPlayed = [];
  };

  const getRecent: EmotionMatcher['getRecent'] = () => [...recentlyPlayed];

  return { pick, markPlayed, reset, getRecent };
}

export default createEmotionMatcher;

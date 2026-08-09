/**
 * client/src/hooks/use-avatar.ts —— 数字人控制 Hook（CL-02）
 *
 * 职责：AvatarCanvas 的外部控制层——
 *  1. 素材加载：manifest（AV-02）→ ClipLibrary（toClipLibrary 归一化，脏数据过滤）
 *  2. 状态机：state（idle/speaking/listening）管理与播放控制（play/stop/listen/setState）
 *  3. 情绪对齐：setEmotion（接 voice-shell emotion 事件 → 驱动选片）
 *  4. 轮换：内部维护 EmotionMatcher（AV-04，自动避重），next() 手动换片 / reset() 清记忆
 *
 * 与 AvatarCanvas 的关系：useAvatar 是"控制层"（管状态/情绪/素材 + 决策预览），
 * AvatarCanvas 是"播放器"（CL-01 已实现自主选片播放，内部 matcher 与 Hook 独立实例，
 * 选片逻辑同源 createAvatarMatcher + pickClipForState，行为一致）。
 * 边界：不重写素材匹配（AV-01/04）、不写播放 DOM（CL-01）、无持久化（红线 1）。
 */

import { useCallback, useMemo, useState } from 'react';
import type { Clip, ClipLibrary, Emotion } from '../../../avatar/clip-matcher.ts';
import {
  createAvatarMatcher,
  pickClipForState,
  toClipLibrary,
  type AvatarState,
} from '../components/avatar-canvas-core.ts';
import manifest from '../../../avatar/manifest.json' with { type: 'json' };

export type { AvatarState };

export interface UseAvatarOptions {
  /** 外部注入素材库（缺省自动从 manifest 加载；传 null/空 → hasAssets=false 降级） */
  library?: ClipLibrary | null;
  /** 初始状态（默认 idle） */
  initialState?: AvatarState;
  /** 初始情绪（默认 neutral） */
  initialEmotion?: Emotion;
}

export interface UseAvatarResult {
  /** 当前状态（喂给 AvatarCanvas） */
  state: AvatarState;
  /** 当前情绪（喂给 AvatarCanvas） */
  emotion: Emotion;
  /** 归一化素材库（喂给 AvatarCanvas；空 = 降级占位） */
  library: ClipLibrary;
  /** 当前应播片段（Hook 侧决策结果，供展示/调试；与 AvatarCanvas 内部播放解耦） */
  currentClip: Clip | null;
  /** 是否有可用素材（false → 前端可降级） */
  hasAssets: boolean;
  /** 播放控制：切换状态 */
  setState(next: AvatarState): void;
  /** 情绪对齐：接 emotion 事件 → 驱动选片 */
  setEmotion(next: Emotion): void;
  /** 播放控制：开始说话（可选指定情绪，缺省用当前） */
  play(emotion?: Emotion): void;
  /** 播放控制：回到空闲 */
  stop(): void;
  /** 播放控制：进入聆听（用户说话中，VAD 触发） */
  listen(): void;
  /** 轮换：手动换下一片段（内部 matcher 避重） */
  next(): void;
  /** 轮换：重置播放记忆（切换人设/会话时调用） */
  reset(): void;
}

/**
 * useAvatar：数字人控制 Hook。
 * state/emotion 变化 → pickClipForState 决策 currentClip（Hook 侧）；
 * next() 用 rotationTick 强制重算（React 对相同 setState 值会 bail out，需 tick 驱动）。
 */
export function useAvatar(options: UseAvatarOptions = {}): UseAvatarResult {
  const { library: injectedLibrary, initialState = 'idle', initialEmotion = 'neutral' } = options;

  const [state, setState] = useState<AvatarState>(initialState);
  const [emotion, setEmotion] = useState<Emotion>(initialEmotion);
  // 手动轮换信号：next() 自增 → 强制重算 currentClip（matcher 状态已变，需触发 useMemo 重算）
  const [rotationTick, setRotationTick] = useState(0);

  // 素材库：外部注入优先，否则从 manifest 加载（归一化 + 脏数据过滤）
  // 注：injectedLibrary 已是 ClipLibrary（合法 Clip[]），toClipLibrary 接受 raw 结构，
  // 传入的合法条目原样保留，脏数据仍会被过滤（类型上 Clip 与 Record<string,unknown> 结构兼容，
  // 这里显式收窄以满足签名）。
  const library = useMemo<ClipLibrary>(
    () =>
      injectedLibrary
        ? toClipLibrary(injectedLibrary as unknown as { clips?: Array<Record<string, unknown>> })
        : toClipLibrary(manifest),
    [injectedLibrary],
  );

  // 情绪匹配器（AV-04：内部维护最近播放窗口，自动避重复）；library 变化时重建
  const matcher = useMemo(() => createAvatarMatcher(library), [library]);

  // 当前应播片段（state/emotion/rotationTick 变化 → 重新决策）
  const currentClip = useMemo<Clip | null>(
    () => pickClipForState(matcher, state, emotion),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rotationTick 为手动轮换触发信号
    [matcher, state, emotion, rotationTick],
  );

  const play = useCallback((nextEmotion?: Emotion) => {
    if (nextEmotion) setEmotion(nextEmotion);
    setState('speaking');
  }, []);

  const stop = useCallback(() => setState('idle'), []);

  const listen = useCallback(() => setState('listening'), []);

  const next = useCallback(() => {
    // 手动轮换：把当前片段记入已播（fresh 池排除 → 下次决策换新片段），再触发重算
    const current = pickClipForState(matcher, state, emotion);
    if (current) matcher.markPlayed(current.id);
    setRotationTick((t) => t + 1);
  }, [matcher, state, emotion]);

  const reset = useCallback(() => {
    matcher.reset();
    setRotationTick((t) => t + 1); // 清记忆后重算（回到新鲜池随机）
  }, [matcher]);

  return {
    state,
    emotion,
    library,
    currentClip,
    hasAssets: library.clips.length > 0,
    setState,
    setEmotion,
    play,
    stop,
    listen,
    next,
    reset,
  };
}

export default useAvatar;

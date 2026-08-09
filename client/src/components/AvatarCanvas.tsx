/**
 * client/src/components/AvatarCanvas.tsx —— 数字人画布组件（CL-01）
 *
 * 职责：用 <video> 播放情绪匹配的素材片段，随语音会话状态切换
 * （idle / speaking / listening），让赛博女友"看得见"。
 *
 * 依赖：AV-01 clip-matcher + AV-04 emotion-matcher（选片）+ AV-02 manifest（素材库，经 library prop 注入）。
 * 规格：docs/tasks/CL-01-avatar-canvas.md
 * 红线：纯展示组件，无持久化、无后端调用。
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Clip, ClipLibrary, Emotion } from '../../../avatar/clip-matcher.ts';
import { createAvatarMatcher, pickClipForState, type AvatarState } from './avatar-canvas-core.ts';

export type { AvatarState } from './avatar-canvas-core.ts';

export interface AvatarCanvasProps {
  /** 当前会话状态（来自 useVoice Hook / voice-shell status 事件） */
  state: AvatarState;
  /** 当前情绪（来自 voice-shell emotion 事件，驱动选片） */
  emotion: Emotion;
  /** 素材库（AV-02 manifest 数据；缺省/为空时降级占位） */
  library?: ClipLibrary;
  /** 状态切换时是否自动播放对应片段（默认 true） */
  playOnState?: boolean;
  /** 循环播放（默认 false，播完轮换下一片段） */
  loop?: boolean;
  className?: string;
  /** 占位替换内容（可选，缺省用内置卡通形象） */
  fallback?: ReactNode;
}

/** 内置降级形象：SVG 卡通脸 + 状态文字（素材缺失时保底，不黑屏不崩溃） */
function FallbackAvatar({ state }: { state: AvatarState }) {
  const label = { idle: '待机中', speaking: '说话中', listening: '聆听中' }[state];
  return (
    <div className="avatar-fallback" aria-label={`数字人占位 · ${label}`}>
      <svg viewBox="0 0 120 120" width="96" height="96" role="img" aria-hidden="true">
        <circle cx="60" cy="60" r="52" fill="#f6c9d8" />
        <circle cx="44" cy="52" r="6" fill="#5b3a44" />
        <circle cx="76" cy="52" r="6" fill="#5b3a44" />
        <path d="M46 74 Q60 86 74 74" stroke="#5b3a44" strokeWidth="4" fill="none" strokeLinecap="round" />
        <circle cx="60" cy="24" r="8" fill="#e8a0b8" />
        <circle cx="60" cy="18" r="5" fill="#fff" opacity="0.8" />
      </svg>
      <span className="avatar-fallback-label">{label}</span>
    </div>
  );
}

/**
 * AvatarCanvas：数字人素材画布。
 * 播放策略：state/emotion 变化 → pickClipForState 选片 → video 切换播放；
 * listening 态暂停（保留当前帧）；播完（!loop）轮换下一片段；
 * 无素材 / 加载失败 → 降级占位。
 */
export function AvatarCanvas({
  state,
  emotion,
  library,
  playOnState = true,
  loop = false,
  className,
  fallback,
}: AvatarCanvasProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [clip, setClip] = useState<Clip | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  // 素材匹配器：library 变化时重建（AV-04 带状态轮换，自动避重）
  const matcher = useMemo<ReturnType<typeof createAvatarMatcher>>(
    () => createAvatarMatcher(library ?? { clips: [] }),
    [library],
  );

  // 状态/情绪变化 → 选片（id 未变则不触发重播）
  useEffect(() => {
    const next = pickClipForState(matcher, state, emotion);
    setClip((prev) => (prev?.id === next?.id ? prev : next));
    setLoadFailed(false);
  }, [matcher, state, emotion]);

  // 播放控制：clip 变化 → 换 src；listening / playOnState=false → 暂停
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!clip) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      return;
    }
    if (video.getAttribute('src') !== clip.src) {
      video.src = clip.src;
      video.load();
    }
    if (playOnState && state !== 'listening') {
      void video.play().catch(() => {
        /* 自动播放被浏览器拦截时静默，等待交互后由用户触发 */
      });
    } else {
      video.pause();
    }
  }, [clip, state, playOnState]);

  // 播完（非循环）：若仍在 speaking 则轮换下一片段，否则保持当前帧
  const handleEnded = useCallback(() => {
    if (loop) return;
    if (state === 'speaking') {
      setClip(pickClipForState(matcher, state, emotion));
    }
  }, [loop, state, emotion, matcher]);

  const hasVideo = clip !== null && !loadFailed;

  return (
    <div className={['avatar-canvas', className ?? ''].filter(Boolean).join(' ')} data-state={state}>
      <video
        ref={videoRef}
        className="avatar-video"
        muted
        playsInline
        preload="auto"
        loop={loop}
        onEnded={handleEnded}
        onError={() => setLoadFailed(true)}
        style={{ visibility: hasVideo ? 'visible' : 'hidden' }}
      />
      {!hasVideo && (fallback ?? <FallbackAvatar state={state} />)}
      <span className="avatar-state-badge">{state}</span>
    </div>
  );
}

export default AvatarCanvas;

/**
 * client/src/components/CaptionBar.tsx —— 字幕条组件（CL-04）
 *
 * 职责：受控展示字幕文本（S2S 副文本 / 用户转写），叠在数字人画布底部。
 * 纯展示组件：文本累积逻辑在 caption-core（父组件 useRef 持有缓冲，
 * 订阅 useVoice onSubtitle / onUserTranscript 事件驱动），本组件只渲染。
 *
 * 依赖：caption-core（核心）+ §2.1 subtitle/user_transcript 事件（VS-03/05）。
 * 红线：无持久化、无内部状态累积（受控组件，text 由父组件喂入）。
 */

export type CaptionTone = 'assistant' | 'user';

export interface CaptionBarProps {
  /** 当前字幕文本（受控；父组件从 CaptionBuffer.text 喂入） */
  text: string;
  /** 是否显示（默认 text 非空即显示；可被父组件强制隐藏） */
  visible?: boolean;
  /** 展示 tone（assistant=AI 副文本 / user=用户转写，样式区分） */
  tone?: CaptionTone;
  className?: string;
}

export function CaptionBar({ text, visible, tone = 'assistant', className }: CaptionBarProps) {
  const show = visible ?? text.length > 0;
  if (!show) return null;
  return (
    <div
      className={['caption-bar', `caption-${tone}`, className ?? ''].filter(Boolean).join(' ')}
      aria-live="polite"
      aria-label="字幕"
    >
      <span className="caption-text">{text}</span>
    </div>
  );
}

export default CaptionBar;

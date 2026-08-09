/**
 * client/src/components/VoiceWaveform.tsx —— 情绪波形组件（CL-05）
 *
 * 职责：能量 → 波形柱状动画。支持两种驱动模式：
 *  ① 受控模式：energy prop（0~1，外部喂入，如 useVoice onEnergy 播放能量）
 *  ② 自驱动模式：source.getEnergy()（AudioAnalyser 等，组件内 rAF 轮询）
 * 内部统一走 waveform-core（clampEnergy → emaSmooth → energyToBars）渲染。
 *
 * 依赖：waveform-core.ts（CL-05 核心）+ CL-08 computeEnergy（能量源侧）。
 * 红线：纯展示组件，无持久化；rAF 循环卸载自动取消（StrictMode 安全）。
 */

import { useEffect, useRef, useState } from 'react';
import { emaSmooth, energyToBars, isSilent } from './waveform-core.ts';

/** 自驱动能量源（AudioAnalyser / 自定义 getter） */
export interface WaveformEnergySource {
  /** 返回当前能量（0~1，RMS；组件内部会 clamp） */
  getEnergy(): number;
}

export interface VoiceWaveformProps {
  /** 受控模式：外部能量 0~1（未传则走 source 自驱动） */
  energy?: number;
  /** 自驱动模式：能量源（rAF 轮询 getEnergy） */
  source?: WaveformEnergySource;
  /** 会话是否激活（未激活 → 平滑回落到静音基线，防"幽灵波形"） */
  active?: boolean;
  /** 柱数量（默认 24） */
  barCount?: number;
  /** EMA 平滑系数（默认 0.35） */
  smoothAlpha?: number;
  /** 静音阈值（默认 0.02，低于视为静默显示基线） */
  silentThreshold?: number;
  className?: string;
}

export function VoiceWaveform({
  energy,
  source,
  active = true,
  barCount = 24,
  smoothAlpha = 0.35,
  silentThreshold = 0.02,
  className,
}: VoiceWaveformProps) {
  // 平滑状态（跨帧持有；渲染只读快照，不每帧 setState 抖动）
  const smoothedRef = useRef(0);
  const [bars, setBars] = useState<number[]>(() => energyToBars(0, barCount));
  // 最新 energy prop（rAF 循环内读取，避免重建 effect）
  const energyPropRef = useRef(energy);
  energyPropRef.current = energy;

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const raw = source ? source.getEnergy() : (energyPropRef.current ?? 0);
      const target = active ? raw : 0; // 未激活 → 回落静音基线
      smoothedRef.current = emaSmooth(smoothedRef.current, target, smoothAlpha);
      const next = energyToBars(smoothedRef.current, barCount);
      // 每帧比较避免无意义重渲染（能量静默时 bars 全 0 且不变）
      setBars((prev) => {
        if (prev.length === next.length && prev.every((v, i) => v === next[i])) return prev;
        return next;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [source, active, barCount, smoothAlpha]);

  const silent = isSilent(smoothedRef.current, silentThreshold) || !active;

  return (
    <div
      className={['voice-waveform', silent ? 'wave-silent' : '', className ?? ''].filter(Boolean).join(' ')}
      data-active={active}
      aria-hidden="true"
    >
      {bars.map((h, i) => (
        <span key={i} className="wave-bar" style={{ height: `${Math.max(6, h * 100)}%` }} />
      ))}
    </div>
  );
}

export default VoiceWaveform;

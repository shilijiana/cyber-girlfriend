/**
 * client/src/components/waveform-core.ts —— VoiceWaveform 纯逻辑核心（CL-05）
 *
 * 职责：把「能量 → 波形柱状」的映射抽成零 React / DOM 依赖的纯函数，
 * 便于 node 直接自检；VoiceWaveform.tsx 只做 rAF 采样 + 渲染。
 *
 * 数据流：
 *   AudioAnalyser（或外部喂入）→ 能量 0~1（computeEnergy，CL-08）
 *     → emaSmooth 平滑防抖 → energyToBars 柱状包络 → 渲染
 *
 * 设计点：
 *  - emaSmooth：指数移动平均（attack/decay 共用系数，简单够用）
 *  - energyToBars：余弦包络（中间高、两边低）+ 确定性伪随机抖动（LCG，
 *    同 seed 同结果 → 可测；默认 seed 固定 → 视觉效果稳定不闪烁）
 *  - 静音判定：能量低于阈值视为静默（显示基线）
 *
 * 红线：纯函数，无状态（平滑状态由组件 ref 持有）、无持久化。
 */

/** 能量钳制到 [0,1]（NaN/Infinity → 0；防脏数据污染渲染） */
export function clampEnergy(e: number): number {
  if (!Number.isFinite(e)) return 0;
  return Math.max(0, Math.min(1, e));
}

/**
 * 指数平滑（EMA）：prev ← prev + alpha * (next - prev)。
 * alpha ∈ [0,1]（外部传入被钳制）；平滑后能量不越界 [0,1]。
 * 用于波形防抖：能量跳变 → 柱高渐变，视觉柔和。
 */
export function emaSmooth(prev: number, next: number, alpha = 0.35): number {
  const a = Math.max(0, Math.min(1, alpha));
  return clampEnergy(prev + a * (clampEnergy(next) - prev));
}

/** 静音判定：能量低于阈值视为静默（默认 0.02） */
export function isSilent(energy: number, threshold = 0.02): boolean {
  return clampEnergy(energy) < threshold;
}

/** LCG 伪随机数发生器（确定性：同 seed 同序列，测试可断言） */
function lcg(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000; // [0,1)
  };
}

/**
 * 能量 → count 根柱高度（每根 0~1）。
 * 包络：余弦曲线 0→1→0（中间高两边低，像语音波形）；
 * 抖动：LCG(seed) 确定性伪随机（±15%），同参数同结果（可测）。
 * energy=0 → 全 0（静音基线）；energy=1 → 包络最大值。
 */
export function energyToBars(energy: number, count: number, seed = 7): number[] {
  const n = Math.max(1, Math.floor(count));
  const e = clampEnergy(energy);
  const rand = lcg(seed);
  const bars: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1); // 0~1 从左到右
    const envelope = 0.5 - 0.5 * Math.cos(2 * Math.PI * t); // 余弦包络 0→1→0：中间高两端低
    const jitter = 0.85 + 0.3 * rand(); // 0.85~1.15
    bars.push(Math.max(0, Math.min(1, e * envelope * jitter)));
  }
  return bars;
}

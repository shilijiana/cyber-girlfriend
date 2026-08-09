/**
 * client/src/components/waveform-core-test.ts —— CL-05 自检脚本
 *
 * 运行：node --experimental-strip-types client/src/components/waveform-core-test.ts
 * 覆盖验收点：
 *  1. clampEnergy（边界 / NaN / Infinity）
 *  2. emaSmooth（收敛 / 不越界 / alpha 钳制）
 *  3. energyToBars（长度 / 全 0 / 余弦包络中间高 / 确定性 / 值域 / count 边界）
 *  4. isSilent（阈值判定）
 *
 * 说明：VoiceWaveform 是 React 组件（rAF 渲染在浏览器侧），逻辑核心为纯函数
 * （waveform-core），node 直测核心（与 CL-03/04 同模式）；React 绑定由 tsc + build 验证。
 */

import { clampEnergy, emaSmooth, energyToBars, isSilent } from './waveform-core.ts';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.error(`  ❌ ${name}${detail ? ` —— ${detail}` : ''}`);
  }
}

// ---------- 1. clampEnergy ----------
console.log('\n[1] clampEnergy');
{
  check('0 保持', clampEnergy(0) === 0);
  check('0.5 保持', clampEnergy(0.5) === 0.5);
  check('1 保持', clampEnergy(1) === 1);
  check('负值 → 0', clampEnergy(-0.3) === 0);
  check('超 1 → 1', clampEnergy(1.7) === 1);
  check('NaN → 0', clampEnergy(Number.NaN) === 0);
  check('Infinity → 0', clampEnergy(Infinity) === 0);
}

// ---------- 2. emaSmooth ----------
console.log('\n[2] emaSmooth');
{
  check('初始平滑到目标（alpha=1 直达）', emaSmooth(0, 0.8, 1) === 0.8);
  check('alpha=0 保持原值', emaSmooth(0.5, 0.9, 0) === 0.5);
  const s1 = emaSmooth(0, 1, 0.5);
  const s2 = emaSmooth(s1, 1, 0.5);
  check('指数收敛趋势（递增）', s1 === 0.5 && s2 > s1 && s2 < 1, `s1=${s1} s2=${s2}`);
  check('平滑不越界 [0,1]', [0, 0.99, 1].every((p) => {
    const v = emaSmooth(p, -5, 0.5);
    return v >= 0 && v <= 1;
  }));
  check('alpha 越界钳制', emaSmooth(0, 0.8, 5) === 0.8 && emaSmooth(0, 0.8, -1) === 0);
  check('NaN 输入 → 0', emaSmooth(0, Number.NaN) === 0);
}

// ---------- 3. energyToBars ----------
console.log('\n[3] energyToBars');
{
  const zero = energyToBars(0, 5);
  check('energy=0 → 全 0（静音基线）', zero.every((v) => v === 0), JSON.stringify(zero));

  const full = energyToBars(1, 5);
  check('长度为 count', full.length === 5, `实际 ${full.length}`);
  check('余弦包络：中间最高', full[2] >= full[0] && full[2] >= full[1] && full[2] >= full[3] && full[2] >= full[4], JSON.stringify(full));
  check('包络：两端最低（左）', full[0] <= full[1], JSON.stringify(full));
  check('包络：两端最低（右）', full[4] <= full[3], JSON.stringify(full));
  check('值域 [0,1]', full.every((v) => v >= 0 && v <= 1), JSON.stringify(full));

  const again = energyToBars(1, 5, 7);
  check('确定性：同 seed 同结果', JSON.stringify(full) === JSON.stringify(again));

  const diffSeed = energyToBars(1, 5, 42);
  check('不同 seed 不同序列', JSON.stringify(full) !== JSON.stringify(diffSeed));

  const mid = energyToBars(0.5, 5);
  check('半能量：全柱 ≤ 满能量对应柱', mid.every((v, i) => v <= full[i] + 1e-9), JSON.stringify(mid));

  check('count=1 返回单柱', energyToBars(1, 1).length === 1);
  check('count 负值 → 下限 1', energyToBars(1, -3).length === 1);
  check('energy 越界钳制（不崩）', energyToBars(3, 3).every((v) => v <= 1) && energyToBars(-1, 3).every((v) => v >= 0));
}

// ---------- 4. isSilent ----------
console.log('\n[4] isSilent');
{
  check('0 静默', isSilent(0));
  check('低于阈值静默', isSilent(0.01));
  check('默认阈值 0.02：0.02 不静默', !isSilent(0.02));
  check('0.5 不静默', !isSilent(0.5));
  check('自定义阈值', isSilent(0.3, 0.5) && !isSilent(0.3, 0.1));
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
if (failed > 0) {
  throw new Error(`CL-05 自检失败：${failed} 项未通过`);
}
console.log('CL-05 自检全部通过 ✅');

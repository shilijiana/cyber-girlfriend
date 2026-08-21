/**
 * client/src/components/avatar-canvas-test.ts —— CL-01 自检脚本
 *
 * 运行：node --experimental-strip-types client/src/components/avatar-canvas-test.ts
 * 覆盖验收点：
 *  1. 组件渲染（core 选片函数可用 + manifest 消费）
 *  2. 状态切换（speaking → 情绪片段；idle → neutral 兜底）
 *  3. 情绪换片（emotion 变化 → 对应情绪片段）
 *  4. 无素材降级（library 空 → null，不崩溃）
 *  5. 轮换（连续 pick 不重复）
 */

import manifest from '../../../avatar/manifest.json' with { type: 'json' };
import {
  createAvatarMatcher,
  pickClipForState,
  toClipLibrary,
  FALLBACK_ORDER,
} from './avatar-canvas-core.ts';

const library = toClipLibrary(manifest);

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

// ---------- 1. manifest 可用（AV-02/AV-03 数据能消费） ----------
console.log('\n[1] manifest 消费');
check('manifest 归一化后 6 条真实片段（AV-03 素材）', library.clips.length === 6, `实际 ${library.clips.length}`);
const emotions = new Set(library.clips.map((c) => c.emotion));
check(
  '五情绪全覆盖',
  ['happy', 'gentle', 'serious', 'surprise', 'neutral'].every((e) => emotions.has(e as never)),
  [...emotions].join(','),
);

// ---------- 2. 状态切换（2026-08-21：任何状态都按情绪选片） ----------
console.log('\n[2] 状态切换');
{
  const matcher = createAvatarMatcher(library);
  const speaking = pickClipForState(matcher, 'speaking', 'happy');
  check('speaking+happy → happy 片段', speaking?.emotion === 'happy', speaking?.emotion);
  const idle = pickClipForState(matcher, 'idle', 'happy');
  check('idle+happy → happy 片段（情绪即时生效，不落 neutral 兜底）', idle?.emotion === 'happy', idle?.emotion);
  const listening = pickClipForState(matcher, 'listening', 'happy');
  check('listening+happy → happy 片段（聆听时也按情绪选片）', listening?.emotion === 'happy', listening?.emotion);
  // 该情绪无素材 → 兜底（构造只有 neutral 的库验证）
  const neutralOnly = createAvatarMatcher({ clips: library.clips.filter((c) => c.emotion === 'neutral') });
  const fallback = pickClipForState(neutralOnly, 'idle', 'happy');
  check('happy 无素材 → neutral 兜底', fallback?.emotion === 'neutral', fallback?.emotion);
}

// ---------- 3. 情绪换片 ----------
console.log('\n[3] 情绪换片');
{
  const matcher = createAvatarMatcher(library);
  const e1 = pickClipForState(matcher, 'speaking', 'happy');
  const e2 = pickClipForState(matcher, 'speaking', 'serious');
  check('happy → serious 换片', e1?.emotion === 'happy' && e2?.emotion === 'serious', `${e1?.emotion}→${e2?.emotion}`);
  // 同情绪连续 pick：neutral 池 2 条 → 连续 2 次确定性不重复（第 3 次回退全池属预期；AV-03 素材 neutral 有 2 条）
  const matcher2 = createAvatarMatcher(library);
  const first = pickClipForState(matcher2, 'speaking', 'neutral');
  const second = pickClipForState(matcher2, 'speaking', 'neutral');
  check(
    '同情绪连续 2 次不重复（素材量内避重）',
    first !== null && second !== null && first.id !== second.id,
    `${first?.id} → ${second?.id}`,
  );
}

// ---------- 4. 无素材降级 ----------
console.log('\n[4] 无素材降级');
{
  const matcher = createAvatarMatcher({ clips: [] });
  check('空库 speaking → null', pickClipForState(matcher, 'speaking', 'happy') === null);
  check('空库 idle → null', pickClipForState(matcher, 'idle', 'happy') === null);
  check('空库 listening → null', pickClipForState(matcher, 'listening', 'happy') === null);
  check('FALLBACK_ORDER 覆盖全部情绪', FALLBACK_ORDER.length === 5);
  check('toClipLibrary(null) → 空库', toClipLibrary(null).clips.length === 0);
  const dirty = toClipLibrary({
    clips: [
      { id: 'ok', emotion: 'happy', durationSec: 1, src: 'a.mp4' },
      { id: 'bad1', emotion: 'nope', durationSec: 1, src: 'b.mp4' }, // 非法情绪 → 过滤
      { id: 'bad2', src: 'c.mp4' }, // 缺字段 → 过滤
    ],
  });
  check('脏数据过滤（非法情绪/缺字段）', dirty.clips.length === 1, `实际 ${dirty.clips.length}`);
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
if (failed > 0) {
  throw new Error(`CL-01 自检失败：${failed} 项未通过`);
}
console.log('CL-01 自检全部通过 ✅');

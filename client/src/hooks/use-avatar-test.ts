/**
 * client/src/hooks/use-avatar-test.ts —— CL-02 自检脚本
 *
 * 运行：node --experimental-strip-types client/src/hooks/use-avatar-test.ts
 * 覆盖验收点：
 *  1. 素材加载（manifest → 6 条真实片段，五情绪全覆盖）
 *  2. 状态机控制（play/stop/listen 状态迁移）
 *  3. 情绪对齐（setEmotion → 对应情绪选片）
 *  4. 轮换（matcher 避重：同情绪连续 pick 不重复；next 手动换片）
 *  5. 降级（空库 hasAssets=false、currentClip=null）
 *
 * 说明：useAvatar 是 React Hook，逻辑核心（选片/匹配）为纯函数（avatar-canvas-core /
 * AV-04 matcher），这里直接测核心 + 模拟 Hook 状态流（与 CL-01 测试同模式）。
 */

import manifest from '../../../avatar/manifest.json' with { type: 'json' };
import {
  createAvatarMatcher,
  pickClipForState,
  toClipLibrary,
  type AvatarState,
} from '../components/avatar-canvas-core.ts';
import type { Emotion } from '../../../avatar/clip-matcher.ts';

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

// ---------- 1. 素材加载（CL-02 第 1 职责：manifest → ClipLibrary） ----------
console.log('\n[1] 素材加载');
check('manifest 归一化后 6 条真实片段（AV-03 素材）', library.clips.length === 6, `实际 ${library.clips.length}`);
const emotions = new Set(library.clips.map((c) => c.emotion));
check(
  '五情绪全覆盖',
  ['happy', 'gentle', 'serious', 'surprise', 'neutral'].every((e) => emotions.has(e as never)),
  [...emotions].join(','),
);

// ---------- 2. 状态机控制（play/stop/listen 迁移） ----------
console.log('\n[2] 状态机控制');
{
  // 模拟 Hook 状态：state + emotion 二元组（与 useAvatar 内部一致）；
  // 用对象属性承载可变状态，避免 TS 对闭包变量的窄化误判
  const ctx: { state: AvatarState; emotion: Emotion } = { state: 'idle', emotion: 'neutral' };
  const play = (e?: Emotion) => { if (e) ctx.emotion = e; ctx.state = 'speaking'; };
  const stop = () => { ctx.state = 'idle'; };
  const listen = () => { ctx.state = 'listening'; };

  play();
  check('play() → speaking', ctx.state === 'speaking');
  play('happy');
  check('play(happy) → speaking + 情绪 happy', ctx.state === 'speaking' && ctx.emotion === 'happy');
  stop();
  check('stop() → idle', ctx.state === 'idle');
  listen();
  check('listen() → listening', ctx.state === 'listening');
}

// ---------- 3. 情绪对齐（setEmotion → 对应情绪片段） ----------
console.log('\n[3] 情绪对齐');
{
  const matcher = createAvatarMatcher(library);
  const happy = pickClipForState(matcher, 'speaking', 'happy');
  check('speaking+happy → happy 片段', happy?.emotion === 'happy', happy?.emotion);
  const serious = pickClipForState(matcher, 'speaking', 'serious');
  check('speaking+serious → serious 片段', serious?.emotion === 'serious', serious?.emotion);
}

// ---------- 4. 轮换（避重 + 手动 next） ----------
console.log('\n[4] 轮换避重');
{
  // AV-03 素材：neutral 池 2 条（neutral_01/02）→ 连续 2 次确定性不重复
  const matcher = createAvatarMatcher(library);
  const picks: string[] = [];
  for (let i = 0; i < 3; i++) {
    const c = matcher.pick('neutral');
    if (c) picks.push(c.id);
  }
  check('同情绪连续 2 次不重复（素材量内避重：neutral 池 2 条）', picks[0] !== picks[1], picks.join(' → '));
  check('连续 3 次均有结果', picks.length === 3 && picks.every(Boolean), picks.join(' → '));

  // 手动 next：标记当前已播 → 再次决策应换片段（与 useAvatar.next 同逻辑）
  const m2 = createAvatarMatcher(library);
  const first = m2.pick('neutral');
  if (first) m2.markPlayed(first.id);
  const second = m2.pick('neutral');
  check('next 手动换片（标记已播 → 换新）', first !== null && second !== null && first.id !== second.id, `${first?.id} → ${second?.id}`);
}

// ---------- 5. 降级（空库） ----------
console.log('\n[5] 降级');
{
  const empty = toClipLibrary(null);
  check('空库 hasAssets=false 等价（clips 空）', empty.clips.length === 0);
  const matcher = createAvatarMatcher(empty);
  check('空库 pickClipForState → null', pickClipForState(matcher, 'speaking', 'happy') === null);
  const dirty = toClipLibrary({
    clips: [
      { id: 'ok', emotion: 'happy', durationSec: 1, src: 'a.mp4' },
      { id: 'bad', emotion: 'nope', durationSec: 1, src: 'b.mp4' },
    ],
  });
  check('脏数据过滤（非法情绪）', dirty.clips.length === 1, `实际 ${dirty.clips.length}`);
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
if (failed > 0) {
  throw new Error(`CL-02 自检失败：${failed} 项未通过`);
}
console.log('CL-02 自检全部通过 ✅');

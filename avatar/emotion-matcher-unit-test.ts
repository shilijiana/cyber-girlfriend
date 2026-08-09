/**
 * avatar/emotion-matcher-unit-test.ts —— AV-04 情绪匹配与轮换自检（零依赖、无 API 额度）
 *
 * 验收项（docs/tasks/AV-04-emotion-matcher.md §5）：
 *   1. 情绪选片：pick('happy') 返回 happy 片段；无素材情绪返回 null
 *   2. 避连续重复：连续 5 次 pick('happy') 不出现同一 id 两次（素材 >= 窗口 5，确定性成立）
 *   3. 全播过轮换：某情绪片段全部播过 → 回退全池，仍返回非 null
 *   4. 状态重置：reset() 后播放记忆清空，重新从新鲜池开始
 *   5. 零依赖：纯 TS 零第三方依赖（复用 clip-matcher 类型）
 *
 * 补充覆盖：
 *   6. 窗口滑动：recentlyPlayedWindow=2 时，pick 3 次只保留最近 2 个
 *   7. markPlayed 手动记录：手动记录进窗口
 *   8. getRecent 快照：返回副本，外部修改不影响内部状态
 *   9. 注入自定义 matcher：可选注入复用（不强制 AV-01 内部实现）
 *
 * 运行：node --experimental-strip-types avatar/emotion-matcher-unit-test.ts
 */

import { createEmotionMatcher } from './emotion-matcher.ts';
import type { Clip, ClipLibrary } from './clip-matcher.ts';

const RESULTS: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string): void {
  RESULTS.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

// ---------------------------------------------------------------- 测试素材库

function makeClip(id: string, emotion: Clip['emotion'], durationSec = 3): Clip {
  return { id, emotion, durationSec, src: `/assets/avatars/speaking/${emotion}/${id}.mp4` };
}

/** happy 素材 5 个（>= 默认窗口 5），gentle 素材 2 个（全播过回退场景），无 serious 素材（null 场景） */
function makeLibrary(): ClipLibrary {
  return {
    clips: [
      makeClip('happy-1', 'happy'),
      makeClip('happy-2', 'happy'),
      makeClip('happy-3', 'happy'),
      makeClip('happy-4', 'happy'),
      makeClip('happy-5', 'happy'),
      makeClip('gentle-1', 'gentle'),
      makeClip('gentle-2', 'gentle'),
    ],
  };
}

// ------------------------------------------------------------------ 验收 1：情绪选片

{
  const m = createEmotionMatcher({ library: makeLibrary() });
  const clip = m.pick('happy');
  check('1a 情绪选片：pick(happy) 返回 happy 片段', clip !== null && clip.emotion === 'happy', clip?.id);
  check('1b 情绪选片：选中后自动记录播放', m.getRecent().includes(clip!.id), `recent=${m.getRecent().join(',')}`);
  const none = m.pick('serious');
  check('1c 无素材情绪返回 null（降级 Live2D）', none === null);
}

// ------------------------------------------------------------------ 验收 2：避连续重复（素材 >= 窗口）

{
  const m = createEmotionMatcher({ library: makeLibrary() });
  const ids: string[] = [];
  for (let i = 0; i < 5; i++) {
    const clip = m.pick('happy');
    if (clip) ids.push(clip.id);
  }
  const unique = new Set(ids).size;
  check('2 避连续重复：连续 5 次 pick(happy) 无重复 id', ids.length === 5 && unique === 5, `ids=${ids.join(',')}`);
}

// ------------------------------------------------------------------ 验收 3：全播过回退全池轮换

{
  const m = createEmotionMatcher({ library: makeLibrary() });
  let allNonNull = true;
  const ids: string[] = [];
  for (let i = 0; i < 10; i++) {
    const clip = m.pick('gentle'); // 仅 2 个素材，10 次必然全部播过 → 回退全池
    if (!clip) allNonNull = false;
    else ids.push(clip.id);
  }
  const usedBoth = new Set(ids).size === 2;
  check('3 全播过轮换：素材耗尽后回退全池，10 次全部非 null', allNonNull, `ids=${ids.join(',')}`);
  check('3b 全播过轮换：两个 gentle 素材均被用到', usedBoth);
}

// ------------------------------------------------------------------ 验收 4：状态重置

{
  const m = createEmotionMatcher({ library: makeLibrary() });
  const first = m.pick('happy');
  m.pick('happy');
  m.reset();
  check('4a 状态重置：reset() 后播放记忆清空', m.getRecent().length === 0);
  const after = m.pick('happy');
  // 重置后 fresh 池更大：若重置前 recent 里有 after.id，说明没清干净
  const resetEffective = first !== null && after !== null && !m.getRecent().slice(0, -1).includes(after.id);
  check('4b 状态重置：重置后重新从新鲜池开始（不残留旧记忆）', resetEffective, `after=${after?.id}`);
}

// ------------------------------------------------------------------ 补充 6：窗口滑动

{
  const m = createEmotionMatcher({ library: makeLibrary(), recentlyPlayedWindow: 2 });
  m.pick('happy'); // recent=[happy-?]
  m.pick('happy'); // recent=[?,?]
  m.pick('happy'); // 窗口 2 → 只保留最近 2 个
  check('6 窗口滑动：recentlyPlayedWindow=2，3 次 pick 后只保留 2 个', m.getRecent().length === 2, `recent=${m.getRecent().join(',')}`);
}

// ------------------------------------------------------------------ 补充 7：markPlayed 手动记录

{
  const m = createEmotionMatcher({ library: makeLibrary(), recentlyPlayedWindow: 3 });
  m.markPlayed('manual-clip');
  check('7 markPlayed：手动记录进入窗口', m.getRecent().includes('manual-clip'), `recent=${m.getRecent().join(',')}`);
}

// ------------------------------------------------------------------ 补充 8：getRecent 快照

{
  const m = createEmotionMatcher({ library: makeLibrary() });
  m.pick('happy');
  const snap = m.getRecent();
  snap.length = 0; // 外部清空快照
  check('8 getRecent：返回副本，外部修改不影响内部状态', m.getRecent().length === 1, `recent=${m.getRecent().join(',')}`);
}

// ------------------------------------------------------------------ 补充 9：注入自定义 matcher

{
  const calls: string[] = [];
  const fakeMatcher = {
    pickClip: (emotion: Clip['emotion']) => {
      calls.push(emotion);
      return makeClip('fake-1', emotion);
    },
    buildQueue: () => [] as Clip[],
  };
  const m = createEmotionMatcher({ library: makeLibrary(), matcher: fakeMatcher });
  const clip = m.pick('neutral');
  check('9 注入自定义 matcher：可复用/替换底层选片', clip?.id === 'fake-1' && calls.includes('neutral'), clip?.id);
}

// ------------------------------------------------------------------ 汇总

const failed = RESULTS.filter((r) => !r.pass);
console.log(`\n=== AV-04 自检：${RESULTS.length - failed.length}/${RESULTS.length} 通过 ===`);
if (failed.length > 0) {
  console.log('失败项：' + failed.map((f) => f.name).join(' | '));
  process.exit(1);
}

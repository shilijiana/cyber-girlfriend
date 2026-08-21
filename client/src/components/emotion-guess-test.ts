/**
 * client/src/components/emotion-guess-test.ts —— 情绪猜测器自检（node 直跑）
 *
 * 用法：node --experimental-strip-types src/components/emotion-guess-test.ts
 * 断言：各情绪关键词命中 + 平局优先级 + 无命中 neutral + 空文本 neutral。
 */

import { guessEmotion } from './emotion-guess.ts';
import type { Emotion } from '../../../avatar/clip-matcher.ts';

let pass = 0;
let fail = 0;

function check(name: string, text: string, expected: Emotion): void {
  const got = guessEmotion(text);
  if (got === expected) {
    pass += 1;
    console.log(`  ✓ ${name} → ${got}`);
  } else {
    fail += 1;
    console.error(`  ✗ ${name} → ${got}（期望 ${expected}）: "${text}"`);
  }
}

console.log('emotion-guess 自检：');

// 基本命中
check('开心词', '哈哈哈，太开心了！', 'happy');
check('开心词2', '今天真的超棒，好喜欢！', 'happy');
check('温柔词', '小呆会温柔地陪着你，抱抱～', 'gentle');
check('难过词', '看到您难过，小呆心里也酸酸的', 'serious');
check('难过词2', '对不起，这件事真的很糟糕', 'serious');
check('惊讶词', '哇，没想到居然是你！', 'surprise');
check('惊讶词2', '天哪，真的吗？太意外了！', 'surprise');

// 平局优先级（同时命中多个情绪词 → 按 happy > gentle > serious > surprise）
check('平局 happy优先', '哈哈哈好开心，但也好难过', 'happy');
check('平局 gentle优先', '温柔地亲亲你，虽然有点难过', 'gentle');
check('平局 serious优先', '别担心，认真处理这个麻烦', 'serious');
check('平局 surprise后置', '哇，虽然好难过', 'serious'); // surprise 优先级最低，同分时让给 serious

// 兜底
check('无情绪词', '请帮我查一下明天的天气', 'neutral');
check('空文本', '', 'neutral');
check('纯符号', '???', 'neutral');

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail > 0) {
  throw new Error(`emotion-guess 自检失败：${fail} 项未通过`);
}
console.log('emotion-guess 自检全部通过 ✅');

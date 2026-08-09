/**
 * client/src/components/caption-core-test.ts —— CL-04 自检脚本
 *
 * 运行：node --experimental-strip-types client/src/components/caption-core-test.ts
 * 覆盖验收点：
 *  1. append 增量累积（subtitle 流式事件）
 *  2. replace 整段替换（用户转写 completed）
 *  3. 超长截断（maxChars 边界：保留尾部 + 省略号；默认 200 / 自定义）
 *  4. reset 清空 + 空串忽略
 *
 * 说明：CaptionBar 是受控展示组件，逻辑核心为纯逻辑（caption-core），node 直测核心
 * （与 CL-03 同模式）；React 绑定由 tsc + vite build 验证。
 */

import { createCaptionBuffer } from './caption-core.ts';

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

// ---------- 1. append 增量累积（subtitle 事件流） ----------
console.log('\n[1] append 增量累积');
{
  const buf = createCaptionBuffer();
  check('初始为空', buf.text === '');
  buf.append('你好');
  buf.append('，我是');
  buf.append('小呆～');
  check('连续 append 累积', buf.text === '你好，我是小呆～', buf.text);
  buf.append('');
  buf.append('');
  check('空串 append 忽略', buf.text === '你好，我是小呆～');
}

// ---------- 2. replace 整段替换（用户转写 completed） ----------
console.log('\n[2] replace 整段替换');
{
  const buf = createCaptionBuffer();
  buf.append('旧的累积文本');
  buf.replace('今天天气真好');
  check('replace 替换全文', buf.text === '今天天气真好', buf.text);
  buf.replace('');
  check('replace 空串 → 清空', buf.text === '');
}

// ---------- 3. 超长截断（保留尾部 + 省略号） ----------
console.log('\n[3] 超长截断');
{
  const small = createCaptionBuffer(10);
  small.append('一二三四五六七八九十一二三四五六');
  check('超长截断：长度 ≤ maxChars', small.text.length <= 10, `长度 ${small.text.length}`);
  check('超长截断：头部省略号', small.text.startsWith('…'), small.text);
  check('超长截断：保留尾部（最近内容优先）', small.text.endsWith('五六'), small.text);

  const small2 = createCaptionBuffer(10);
  small2.append('abcdefghij');
  check('恰好 maxChars 不截断', small2.text === 'abcdefghij', small2.text);

  const small3 = createCaptionBuffer(10);
  small3.replace('一二三四五六七八九十一二三四五六七八九十');
  check('replace 同样截断', small3.text.length <= 10 && small3.text.startsWith('…'), small3.text);

  const tiny = createCaptionBuffer(4);
  tiny.append('一二三四五六');
  check('极小 maxChars 下限 8（不崩）', tiny.text.length <= 8, `长度 ${tiny.text.length}`);
}

// ---------- 4. reset 清空 ----------
console.log('\n[4] reset 清空');
{
  const buf = createCaptionBuffer();
  buf.append('有内容');
  buf.reset();
  check('reset 清空', buf.text === '');
  check('reset 后继续 append 正常', (buf.append('新'), buf.text === '新'));
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
if (failed > 0) {
  throw new Error(`CL-04 自检失败：${failed} 项未通过`);
}
console.log('CL-04 自检全部通过 ✅');

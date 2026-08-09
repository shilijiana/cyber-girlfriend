/**
 * client/src/components/chat-core-test.ts —— CL-03 自检脚本
 *
 * 运行：node --experimental-strip-types client/src/components/chat-core-test.ts
 * 覆盖验收点：
 *  1. 消息模型与 id 生成（createMessageId 唯一性 / addUserMessage trim 过滤）
 *  2. 消息流（addPending → resolvePending 成功/失败 / markError）
 *  3. sendChatMessage（fake fetch：请求格式 / 结果解析 / 非 2xx / 网络异常兜底）
 *
 * 说明：ChatUI 是 React 组件，逻辑核心为纯函数（chat-core），node 直测核心
 * （与 CL-01/02 测试同模式）；React 绑定由 tsc + vite build 验证。
 */

import {
  addPending,
  addUserMessage,
  createMessageId,
  markError,
  resolvePending,
  sendChatMessage,
  type ChatMessage,
} from './chat-core.ts';

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

// ---------- 1. 消息模型与 id ----------
console.log('\n[1] 消息模型与 id 生成');
{
  const ids = new Set(Array.from({ length: 50 }, () => createMessageId('u')));
  check('createMessageId 连续 50 次不重复', ids.size === 50, `实际 ${ids.size}`);
  check('前缀生效', Array.from(ids)[0]?.startsWith('u-') === true);
}

// ---------- 2. 消息流 ----------
console.log('\n[2] 消息流');
{
  const t0 = Date.now();
  const base: ChatMessage[] = [];

  const withUser = addUserMessage(base, '  你好呀  ');
  check('addUserMessage 追加用户消息（trim）', withUser.length === 1 && withUser[0].role === 'user' && withUser[0].text === '你好呀');
  check('addUserMessage 空文本不产生消息', addUserMessage(base, '   ').length === 0);

  const withPending = addPending(withUser, 'fixed-pending');
  check('addPending 追加 assistant 占位', withPending.length === 2 && withPending[1].pending === true && withPending[1].role === 'assistant');

  const ok = resolvePending(withPending, 'fixed-pending', { ok: true, reply: '你好呀！', personaId: 'xiaodai', durationMs: 123 });
  check('resolvePending 成功填充', ok[1].text === '你好呀！' && ok[1].pending === false && ok[1].error === false);

  const fail = resolvePending(withPending, 'fixed-pending', { ok: false, reply: '请求失败（HTTP 500）', personaId: 'xiaodai', durationMs: 0 });
  check('resolvePending 失败标记 error', fail[1].text === '请求失败（HTTP 500）' && fail[1].error === true);

  const err = markError(withPending, 'fixed-pending', '网络异常');
  check('markError 手动失败兜底', err[1].text === '网络异常' && err[1].error === true && err[1].pending === false);

  const stale = resolvePending(withUser, 'no-such-pending', { ok: true, reply: 'x', personaId: '', durationMs: 0 });
  check('resolvePending 占位不存在原样返回', stale.length === 1 && stale[0].text === '你好呀');

  check('原始数组不被修改（纯函数）', base.length === 0 && withUser[0].text === '你好呀', JSON.stringify(withUser));
  void t0;
}

// ---------- 3. sendChatMessage（fake fetch） ----------
console.log('\n[3] sendChatMessage');
{
  // 3.1 成功：请求格式 + 结果解析
  // 注：用 const 对象承载捕获（IIFE 内赋值外部 let 会让 TS 控制流推断为 never）
  const captured: { url: string; init: RequestInit } = { url: '', init: {} };
  const fakeOk = (async (_url: string, init?: RequestInit) => {
    captured.url = _url;
    captured.init = init ?? {};
    return new Response(JSON.stringify({ reply: '好的老板！', personaId: 'xiaodai', ok: true, durationMs: 42 }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;

  const okResult = await sendChatMessage({ text: '你好', personaId: 'xiaodai', apiUrl: '/api/chat', fetchImpl: fakeOk });
  check('成功：ok=true + reply/personaId/durationMs 解析', okResult.ok && okResult.reply === '好的老板！' && okResult.personaId === 'xiaodai' && okResult.durationMs === 42);
  check('请求方法 POST + 路径正确', captured.init.method === 'POST' && captured.url === '/api/chat', captured.url);
  const body = JSON.parse(String(captured.init.body)) as { message: string; personaId: string };
  check('请求体 {message, personaId}', body.message === '你好' && body.personaId === 'xiaodai', JSON.stringify(body));

  // 3.2 非 2xx → ok:false + 友好文案
  const fake500 = (async () => new Response('boom', { status: 500 })) as typeof fetch;
  const bad = await sendChatMessage({ text: 'hi', fetchImpl: fake500 });
  check('HTTP 500 → ok:false + 状态码文案', !bad.ok && bad.reply.includes('500'), bad.reply);

  // 3.3 响应结构异常（reply 缺失）→ ok:false + 兜底文案
  const fakeGarbage = (async () => new Response(JSON.stringify({ whatever: 1 }), { status: 200 })) as typeof fetch;
  const garbage = await sendChatMessage({ text: 'hi', fetchImpl: fakeGarbage });
  check('结构异常 → ok:false + 空回复兜底', !garbage.ok && garbage.reply.includes('空回复'), garbage.reply);

  // 3.4 网络异常 → ok:false + 异常文案（不抛错）
  const fakeNet = (async () => {
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;
  const net = await sendChatMessage({ text: 'hi', fetchImpl: fakeNet });
  check('网络异常 → ok:false + 友好文案（不抛错）', !net.ok && net.reply.includes('发送失败'), net.reply);

  // 3.5 abort 信号透传
  const controller = new AbortController();
  let sawSignal = false;
  const fakeAbort = (async (_url: string, init?: RequestInit) => {
    sawSignal = init?.signal === controller.signal;
    controller.abort();
    throw new DOMException('Aborted', 'AbortError');
  }) as typeof fetch;
  const aborted = await sendChatMessage({ text: 'hi', fetchImpl: fakeAbort, signal: controller.signal });
  check('signal 透传 + abort 兜底 ok:false', sawSignal && !aborted.ok, aborted.reply);
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
if (failed > 0) {
  throw new Error(`CL-03 自检失败：${failed} 项未通过`);
}
console.log('CL-03 自检全部通过 ✅');

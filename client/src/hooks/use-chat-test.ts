/**
 * client/src/hooks/use-chat-test.ts —— CL-07 自检脚本
 *
 * 运行：node --experimental-strip-types client/src/hooks/use-chat-test.ts
 * 覆盖验收点（聚焦 CL-07 Hook 层语义，消息/请求核心复用 CL-03 chat-core，
 *   chat-core 自身纯函数已在 chat-core-test.ts 覆盖，此处验证集成链路）：
 *  1. 消息流：user → pending 占位 → resolve 成功（正常回复）
 *  2. 业务降级：HTTP 200 ok:false → 气泡展示降级 reply（error 标记）
 *  3. 网络异常：sendChatMessage 兜底 ok:false + 友好文案（不抛错）
 *  4. 请求体构造：{message, personaId}（契约 §2.1，mock fetch 捕获）
 *  5. resolvePending 只更新目标 pending（并发安全，不误伤其他消息）
 *  6. 空消息过滤（addUserMessage trim 后不产生空消息）
 *
 * 说明：useChat 是 React Hook，状态流由 commitMessages 统一归约，这里用与
 *   Hook 相同的「messagesRef + commitMessages」模式模拟（与 CL-01/02 测试同模式）。
 */

import {
  addPending,
  addUserMessage,
  resolvePending,
  sendChatMessage,
  type ChatMessage,
} from '../components/chat-core.ts';

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

// 简易 mock fetch：按场景返回响应
function mockFetch(
  scenario:
    | { kind: 'ok'; reply: string; ok?: boolean }
    | { kind: 'http-error'; status: number }
    | { kind: 'network-error' },
): typeof fetch {
  return (async () => {
    if (scenario.kind === 'network-error') {
      throw new TypeError('Failed to fetch');
    }
    if (scenario.kind === 'http-error') {
      return { ok: false, status: scenario.status, json: async () => ({}) } as unknown as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ reply: scenario.reply, ok: scenario.ok !== false, personaId: 'xiaodai', durationMs: 123 }),
    } as unknown as Response;
  }) as typeof fetch;
}

// 模拟 Hook 内部：messagesRef + commitMessages（与 useChat 同构）
function createChatState() {
  const state: { messages: ChatMessage[] } = { messages: [] };
  const commit = (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    state.messages = updater(state.messages);
  };
  return { state, commit };
}

// ---------- 1. 消息流：user → pending → resolve 成功 ----------
console.log('\n[1] 成功路径（user → pending → 回复）');
{
  const { state, commit } = createChatState();
  const withUser = addUserMessage(state.messages, '你好', 'u1');
  const withPending = addPending(withUser);
  const pendingId = withPending[withPending.length - 1].id;
  commit(() => withPending);
  check('user 消息已追加', state.messages[0]?.role === 'user' && state.messages[0]?.text === '你好');
  check('pending 占位已追加', state.messages[1]?.role === 'assistant' && state.messages[1]?.pending === true);
  check('pendingId 取到', pendingId.length > 0, pendingId);

  const result = await sendChatMessage({
    text: '你好',
    fetchImpl: mockFetch({ kind: 'ok', reply: '你好呀！', ok: true }),
  });
  commit((prev) => resolvePending(prev, pendingId, result));
  check('resolve 成功：文本填充', state.messages[1]?.text === '你好呀！', state.messages[1]?.text);
  check('resolve 成功：pending 清除', state.messages[1]?.pending === false);
  check('resolve 成功：无 error 标记', state.messages[1]?.error !== true);
  check('user 消息不受影响', state.messages[0]?.text === '你好');
}

// ---------- 2. 业务降级（HTTP 200 但 ok:false） ----------
console.log('\n[2] 业务降级（Hermes 不可用等）');
{
  const { state, commit } = createChatState();
  const withPending = addPending(addUserMessage(state.messages, 'hi', 'u2'));
  const pendingId = withPending[withPending.length - 1].id;
  commit(() => withPending);

  const result = await sendChatMessage({
    text: 'hi',
    fetchImpl: mockFetch({ kind: 'ok', reply: '（Hermes 不可用，已用基础模式回复）', ok: false }),
  });
  commit((prev) => resolvePending(prev, pendingId, result));
  check('降级：ok:false 被透传', result.ok === false);
  check('降级：气泡展示服务端降级 reply', state.messages[1]?.text === '（Hermes 不可用，已用基础模式回复）');
  check('降级：error 标记（区分正常回复）', state.messages[1]?.error === true);
}

// ---------- 3. 网络异常（sendChatMessage 兜底不抛错） ----------
console.log('\n[3] 网络异常兜底');
{
  const { state, commit } = createChatState();
  const withPending = addPending(addUserMessage(state.messages, 'hi', 'u3'));
  const pendingId = withPending[withPending.length - 1].id;
  commit(() => withPending);

  const result = await sendChatMessage({
    text: 'hi',
    fetchImpl: mockFetch({ kind: 'network-error' }),
  });
  commit((prev) => resolvePending(prev, pendingId, result));
  check('网络异常：不抛错，返回 ok:false', result.ok === false);
  check('网络异常：友好文案含原因', /发送失败/.test(result.reply), result.reply);
  check('网络异常：气泡 error 标记 + 文案', state.messages[1]?.error === true && /发送失败/.test(state.messages[1]?.text ?? ''));

  // HTTP 非 2xx
  const http = await sendChatMessage({ text: 'hi', fetchImpl: mockFetch({ kind: 'http-error', status: 500 }) });
  check('HTTP 500：ok:false + HTTP 文案', http.ok === false && /HTTP 500/.test(http.reply), http.reply);
}

// ---------- 4. 请求体构造（契约 §2.1） ----------
console.log('\n[4] 请求体构造');
{
  let captured = '';
  const capturingFetch = (async (_url: string, init?: RequestInit) => {
    captured = String(init?.body);
    return { ok: true, status: 200, json: async () => ({ reply: 'r', ok: true, personaId: 'xiaodai', durationMs: 1 }) } as unknown as Response;
  }) as typeof fetch;

  await sendChatMessage({ text: '契约校验', personaId: 'xiaodai', fetchImpl: capturingFetch });
  const sent = JSON.parse(captured) as { message: string; personaId: string };
  check('发送体 = {message, personaId}', sent.message === '契约校验' && sent.personaId === 'xiaodai', captured);

  let captured2 = '';
  const capturingFetch2 = (async (_url: string, init?: RequestInit) => {
    captured2 = String(init?.body);
    return { ok: true, status: 200, json: async () => ({ reply: 'r', ok: true, personaId: '', durationMs: 1 }) } as unknown as Response;
  }) as typeof fetch;
  await sendChatMessage({ text: '无 persona', fetchImpl: capturingFetch2 });
  const sent2 = JSON.parse(captured2) as { message: string; personaId?: string };
  check('无 personaId → 请求体不带该字段', !('personaId' in sent2) || sent2.personaId === undefined, captured2);
}

// ---------- 5. resolvePending 只更新目标 pending（并发安全） ----------
console.log('\n[5] 并发安全');
{
  const m1 = { id: 'a1', role: 'assistant' as const, text: '旧回复', ts: 1 };
  const m2 = { id: 'a2', role: 'assistant' as const, text: '', ts: 2, pending: true };
  const next = resolvePending([m1, m2], 'a2', { ok: true, reply: '新回复', personaId: 'x', durationMs: 1 });
  check('仅目标 pending 被填充', next[0].text === '旧回复' && next[1].text === '新回复');
  check('非 pending 消息保持原样', next[0].pending !== true);
  const noMatch = resolvePending([m1, m2], 'a-不存在', { ok: false, reply: 'err', personaId: 'x', durationMs: 0 });
  check('pending 已不存在（竞态）→ 原样返回', noMatch[1].text === '' && noMatch[1].pending === true);
}

// ---------- 6. 空消息过滤 ----------
console.log('\n[6] 空消息过滤');
{
  const before = [{ id: 'x', role: 'assistant' as const, text: '已有', ts: 1 }];
  const after = addUserMessage(before, '   ');
  check('空白消息不产生新条目', after.length === 1 && after[0].id === 'x');
  const ok = addUserMessage(before, '有效消息', 'u9');
  check('有效消息正常追加', ok.length === 2 && ok[1].role === 'user' && ok[1].text === '有效消息');
}

console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
if (failed > 0) {
  throw new Error(`CL-07 自检失败：${failed} 项未通过`);
}
console.log('CL-07 自检全部通过 ✅');

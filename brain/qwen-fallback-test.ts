/**
 * brain/qwen-fallback-test.ts —— M5-02 Qwen 文本降级通道自检（零依赖、不发真实网络）
 *
 * 验收项（M5-02 错误处理与降级）：
 *   1. 成功路径：ok:true + output 取 choices[0].message.content（trim）
 *   2. 请求构造：POST 兼容端点、Bearer 鉴权、system=context + user=instruction、model=qwen-plus
 *   3. HTTP 非 2xx → ok:false + error 含状态码
 *   4. 业务错误（data.error）→ ok:false + error 取 message
 *   5. 空回复（content 缺失/空串）→ ok:false
 *   6. 无 API Key → ok:false（不发起请求）
 *   7. 超时（fetch 挂起 + 短超时）→ ok:false + AbortController 触发
 *   8. 长回复截断（> 16KB 只保留前部）
 *   9. 无 context 时只发 user 消息（system 可缺省）
 *
 * 运行：node --experimental-strip-types brain/qwen-fallback-test.ts
 */

import { runQwenChat } from './qwen-fallback.ts';

const RESULTS: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string): void {
  RESULTS.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

// ---------------------------------------------------------------- 工具：mock fetch

interface MockFetchState {
  calls: Array<{ url: string; init: RequestInit }>;
  responder: (init: RequestInit) => Response | Promise<Response>;
  /** 若设置，则 fetch 永远挂起（测超时） */
  hang?: boolean;
}

function makeMockFetch(state: MockFetchState): typeof fetch {
  return ((input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    state.calls.push({ url: String(input), init: init ?? {} });
    // 模拟真实 fetch：signal 触发 abort 时 reject（测超时路径）
    const signal = init?.signal;
    if (signal) {
      return new Promise<Response>((resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new Error('AbortError: The operation was aborted.'));
        });
        if (state.hang) return; // 挂起，等待 abort
        Promise.resolve(state.responder(init ?? {})).then(resolve, reject);
      });
    }
    if (state.hang) return new Promise<Response>(() => undefined); // 永不 resolve（无 signal 场景，理论不可达）
    return Promise.resolve(state.responder(init ?? {}));
  }) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** 解析被 mock 的请求体（init.body 是 JSON 字符串） */
function parseBody(init: RequestInit): { model?: string; messages?: unknown[] } {
  return typeof init.body === 'string' ? (JSON.parse(init.body) as { model?: string; messages?: unknown[] }) : {};
}

// ---------------------------------------------------------------- 1：成功路径 + 2：请求构造

{
  const state: MockFetchState = {
    calls: [],
    responder: () =>
      jsonResponse({ choices: [{ message: { role: 'assistant', content: '  你好呀，老板～  ' } }] }),
  };
  const result = await runQwenChat(
    { instruction: '今天天气如何？', context: '你是小呆，活泼可爱的 AI 少女。' },
    { apiKey: 'sk-test', fetchImpl: makeMockFetch(state) },
  );

  check('1 成功路径：ok=true 且 output 为 content（trim）', result.ok && result.output === '你好呀，老板～', result.output);
  check('1b 成功路径：durationMs >= 0', result.durationMs >= 0, `${result.durationMs}ms`);

  const call = state.calls[0];
  check('2a 请求 URL：兼容端点', call?.url === 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', call?.url);
  check('2b 请求方法：POST', call?.init.method === 'POST');
  const auth = (call?.init.headers as Record<string, string> | undefined)?.['Authorization'];
  check('2c Bearer 鉴权', auth === 'Bearer sk-test', auth);

  const body = parseBody(call?.init ?? {});
  check('2d model=qwen-plus', body.model === 'qwen-plus', body.model);
  const roles = (body.messages ?? []).map((m) => (m as { role: string }).role);
  check('2e 消息结构：[system, user]', roles.length === 2 && roles[0] === 'system' && roles[1] === 'user', roles.join(','));
  const sys = (body.messages?.[0] as { content?: string } | undefined)?.content;
  check('2f system = context（人设 instructions）', sys === '你是小呆，活泼可爱的 AI 少女。');
}

// ---------------------------------------------------------------- 3：HTTP 非 2xx

{
  const state: MockFetchState = { calls: [], responder: () => jsonResponse({ error: { message: 'nope' } }, 401) };
  const result = await runQwenChat({ instruction: 'hi' }, { apiKey: 'sk-test', fetchImpl: makeMockFetch(state) });
  check('3 HTTP 401 → ok=false 且 error 含状态码', !result.ok && result.error?.includes('401') === true, result.error);
}

// ---------------------------------------------------------------- 4：业务错误

{
  const state: MockFetchState = {
    calls: [],
    responder: () => jsonResponse({ error: { message: 'Invalid model' } }, 200),
  };
  const result = await runQwenChat({ instruction: 'hi' }, { apiKey: 'sk-test', fetchImpl: makeMockFetch(state) });
  check('4 业务错误 → ok=false 且 error=message', !result.ok && result.error === 'Invalid model', result.error);
}

// ---------------------------------------------------------------- 5：空回复

{
  const state: MockFetchState = { calls: [], responder: () => jsonResponse({ choices: [{ message: { content: '' } }] }) };
  const result = await runQwenChat({ instruction: 'hi' }, { apiKey: 'sk-test', fetchImpl: makeMockFetch(state) });
  check('5 空回复 → ok=false', !result.ok && result.error === 'Qwen 降级返回空回复', result.error);
}

// ---------------------------------------------------------------- 6：无 API Key

{
  const state: MockFetchState = { calls: [], responder: () => jsonResponse({ choices: [{ message: { content: 'x' } }] }) };
  const result = await runQwenChat({ instruction: 'hi' }, { apiKey: '', fetchImpl: makeMockFetch(state) });
  check('6 无 API Key → ok=false 且不发请求', !result.ok && state.calls.length === 0, result.error);
}

// ---------------------------------------------------------------- 7：超时（fetch 挂起 + 短超时）

{
  const state: MockFetchState = { calls: [], responder: () => jsonResponse({ choices: [{ message: { content: 'x' } }] }), hang: true };
  const result = await runQwenChat(
    { instruction: 'hi' },
    { apiKey: 'sk-test', timeoutMs: 50, fetchImpl: makeMockFetch(state) },
  );
  check('7 超时 → ok=false 且 error 含 abort', !result.ok && /abort|超时/i.test(result.error ?? ''), result.error);
}

// ---------------------------------------------------------------- 8：长回复截断

{
  const long = '好'.repeat(20_000);
  const state: MockFetchState = {
    calls: [],
    responder: () => jsonResponse({ choices: [{ message: { content: long } }] }),
  };
  const result = await runQwenChat({ instruction: 'hi' }, { apiKey: 'sk-test', fetchImpl: makeMockFetch(state) });
  check('8 长回复截断（<= 16384）', result.ok && result.output.length <= 16_384, `${result.output.length} chars`);
}

// ---------------------------------------------------------------- 9：无 context 只发 user

{
  const state: MockFetchState = {
    calls: [],
    responder: () => jsonResponse({ choices: [{ message: { content: 'ok' } }] }),
  };
  const result = await runQwenChat({ instruction: 'hi' }, { apiKey: 'sk-test', fetchImpl: makeMockFetch(state) });
  const body = parseBody(state.calls[0]?.init ?? {});
  const roles = (body.messages ?? []).map((m) => (m as { role: string }).role);
  check('9 无 context → 只发 user 消息', result.ok && roles.length === 1 && roles[0] === 'user', roles.join(','));
}

// ---------------------------------------------------------------- 汇总

const failed = RESULTS.filter((r) => !r.pass);
console.log(`\n${failed.length === 0 ? '🎉' : '❌'} qwen-fallback 自检 ${RESULTS.length - failed.length}/${RESULTS.length} 通过`);
if (failed.length > 0) {
  console.log('失败项：', failed.map((f) => f.name).join('、'));
  process.exit(1);
}

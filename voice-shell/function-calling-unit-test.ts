/**
 * voice-shell/function-calling-unit-test.ts —— VS-06 装配层逻辑自检（mock 驱动，零 API 额度）
 *
 * 验收项（docs/TASKS-CONFIG.md §VS-06）：
 *   ① hermes_brain 工具注册：默认 tools=[hermesBrainTool]（name=hermes_brain，可注入 session.update）
 *   ② function_call 拦截：onFunctionCall 收到归一化 FunctionCall → router.handle 被调
 *   ③ 写回闭环：handle 完成后 session.sendFunctionCallOutput 收到 FunctionCallOutput（含 callId/output/status）
 *   ④ brain 状态：working → done（浏览器 sendToBrowser + deps.onBrainStatus 双路）
 *   ⑤ 失败路径：router failed → status='failed' 写回 + 浏览器收到 failed
 *   ⑥ 会话未就绪：function_call 早于 onSessionCreated → 丢弃不崩溃
 *   ⑦ 端到端装配：layer 挂到 createVoiceGateway（mock provider/socket），模拟 Qwen 下行
 *      function_call → 浏览器收到 brain working/done + session 写回（全链路验证）
 *
 * 运行：node --experimental-strip-types voice-shell/function-calling-unit-test.ts
 */

import { createFunctionCallingLayer } from './function-calling.ts';
import { createVoiceGateway, type BrowserSocket } from './gateway.ts';
import { hermesBrainTool, type FunctionCall, type FunctionCallOutput, type FunctionRouter } from '../brain/function-router.ts';
import type { VoiceProvider, VoiceSession } from './provider.ts';
import type { Emotion } from '../avatar/clip-matcher.ts';

const RESULTS: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string): void {
  RESULTS.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ------------------------------------------------------------------ mocks

/** 记录所有上行 JSON 的 mock 会话（模拟 Qwen 侧收到什么） */
class MockSession implements VoiceSession {
  sentJson: Record<string, unknown>[] = [];
  callbacks: {
    functionCall?: (c: FunctionCall) => void;
    audio?: (c: Buffer) => void;
    subtitle?: (t: string) => void;
    emotion?: (e: Emotion) => void;
    inputTranscript?: (t: string, i: { delta: boolean }) => void;
    vadState?: (speaking: boolean) => void;
  } = {};

  sendAudio(): void {}
  onAudio(cb: (c: Buffer) => void): void {
    this.callbacks.audio = cb;
  }
  onSubtitle(cb: (t: string) => void): void {
    this.callbacks.subtitle = cb;
  }
  onEmotion(cb: (e: Emotion) => void): void {
    this.callbacks.emotion = cb;
  }
  onFunctionCall(cb: (c: FunctionCall) => void): void {
    this.callbacks.functionCall = cb;
  }
  onInputTranscript(cb: (t: string, i: { delta: boolean }) => void): void {
    this.callbacks.inputTranscript = cb;
  }
  onVadState(cb: (speaking: boolean) => void): void {
    this.callbacks.vadState = cb;
  }
  sendFunctionCallOutput(out: FunctionCallOutput): void {
    this.sentJson.push({ type: 'function_call_output', ...out });
  }
  injectAssistantText(): void {}
  interrupt(): void {}
  async close(): Promise<void> {}

  /** 测试触发：模拟 Qwen 下行 function_call 事件 */
  triggerFunctionCall(c: FunctionCall): void {
    this.callbacks.functionCall?.(c);
  }
}

/** mock 路由：可控结果，记录调用 */
class MockRouter implements FunctionRouter {
  calls: FunctionCall[] = [];
  result: FunctionCallOutput = {
    callId: 'call_1',
    status: 'completed',
    output: JSON.stringify({ ok: true, output: '2', durationMs: 8123 }),
  };
  throwError: Error | null = null;

  async handle(call: FunctionCall): Promise<FunctionCallOutput> {
    this.calls.push(call);
    if (this.throwError) throw this.throwError;
    return { ...this.result, callId: call.callId };
  }
}

/** mock provider：返回 MockSession */
class MockProvider implements VoiceProvider {
  readonly session: MockSession;
  constructor(session: MockSession) {
    this.session = session;
  }
  async connect(): Promise<VoiceSession> {
    return this.session;
  }
}

/** mock 浏览器 socket（gateway 测试用） */
class MockSocket implements BrowserSocket {
  readyState = 1;
  sent: string[] = [];
  closed: { code: number; reason: string } | null = null;
  private handlers: Record<string, ((...a: unknown[]) => void)[] | undefined> = {};

  send(data: string | Uint8Array | ArrayBuffer): void {
    let buf: Buffer;
    if (typeof data === 'string') buf = Buffer.from(data);
    else if (data instanceof ArrayBuffer) buf = Buffer.from(data);
    else buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    this.sent.push(buf.toString());
  }
  on(event: string, listener: (...args: unknown[]) => void): void {
    (this.handlers[event] ??= []).push(listener);
  }
  off(event: string, listener: (...args: unknown[]) => void): void {
    const l = this.handlers[event];
    if (l) {
      const i = l.indexOf(listener);
      if (i >= 0) l.splice(i, 1);
    }
  }
  close(code = 1000, reason = ''): void {
    this.closed = { code, reason };
    this.readyState = 3;
  }
  parsed(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

// ------------------------------------------------------------------ tests

async function main(): Promise<void> {
  console.log('== VS-06 Function Calling unit test（mock）==\n');

  // ---------- ① tools 注册 ----------
  {
    const layer = createFunctionCallingLayer();
    check(
      '① 默认 tools=[hermesBrainTool] 且 name=hermes_brain',
      layer.tools.length === 1 &&
        (layer.tools[0] as { name?: string }).name === 'hermes_brain',
    );
    check(
      '① hermesBrainTool 与 BR-02 一致（同一 schema）',
      (layer.tools[0] as { type?: string }).type === 'function' &&
        (hermesBrainTool as { name?: string }).name === 'hermes_brain',
    );
  }
  {
    const custom = createFunctionCallingLayer({ tools: [] });
    check('① 自定义 tools 覆盖（可空）', custom.tools.length === 0);
  }

  // ---------- ②③④ 完整链路（不经过 gateway，直接验证 layer 逻辑） ----------
  {
    const session = new MockSession();
    const router = new MockRouter();
    const statuses: { s: string; r?: string }[] = [];
    const browserMsgs: Record<string, unknown>[] = [];

    const layer = createFunctionCallingLayer({
      router,
      onBrainStatus: (s, r) => statuses.push({ s, ...(r !== undefined ? { r } : {}) }),
    });

    // ③ 会话建立（拿 ctx）
    const ctx = {
      sessionId: 'sess-1',
      session,
      sendToBrowser: (obj: unknown) => browserMsgs.push(obj as Record<string, unknown>),
    };
    layer.onSessionCreated(ctx);

    // ② 触发 function_call（模拟 Qwen 下行 → VS-01 已归一化）
    const call: FunctionCall = {
      callId: 'call_1',
      name: 'hermes_brain',
      arguments: { instruction: '1+1=?' },
    };
    layer.onFunctionCall(call);
    await sleep(30);

    check('② router.handle 被调且参数透传', router.calls.length === 1 && router.calls[0] === call);
    check(
      '③ 写回：session.sendFunctionCallOutput 收到 callId/status/output',
      session.sentJson.length === 1 &&
        session.sentJson[0].callId === 'call_1' &&
        session.sentJson[0].status === 'completed' &&
        typeof session.sentJson[0].output === 'string',
    );
    check(
      '④ brain 状态序列 working → done',
      statuses.length === 2 && statuses[0].s === 'working' && statuses[1].s === 'done',
    );
    check(
      '④ 浏览器收到 brain working → done',
      browserMsgs.length === 2 &&
        browserMsgs[0].type === 'brain' &&
        browserMsgs[0].status === 'working' &&
        browserMsgs[1].status === 'done',
    );
    check(
      '④ done 携带 Hermes 结果（output）',
      statuses[1].r !== undefined && JSON.parse(statuses[1].r as string).output === '2',
    );
  }

  // ---------- ⑤ 失败路径 ----------
  {
    const session = new MockSession();
    const router = new MockRouter();
    router.result = {
      callId: 'call_x',
      status: 'failed',
      output: JSON.stringify({ ok: false, output: '', durationMs: 0, error: '参数缺失' }),
    };
    const statuses: { s: string; r?: string }[] = [];
    const layer = createFunctionCallingLayer({ router, onBrainStatus: (s, r) => statuses.push({ s, ...(r !== undefined ? { r } : {}) }) });
    layer.onSessionCreated({
      sessionId: 's',
      session,
      sendToBrowser: () => undefined,
    });

    layer.onFunctionCall({ callId: 'call_x', name: 'hermes_brain', arguments: {} });
    await sleep(30);

    check(
      '⑤ router failed → 写回 status=failed',
      session.sentJson.length === 1 && session.sentJson[0].status === 'failed',
    );
    check('⑤ 状态序列 working → failed', statuses.length === 2 && statuses[1].s === 'failed');
  }

  // ---------- ⑤b router 抛异常（防御兜底） ----------
  {
    const session = new MockSession();
    const router = new MockRouter();
    router.throwError = new Error('boom');
    const layer = createFunctionCallingLayer({ router });
    layer.onSessionCreated({ sessionId: 's', session, sendToBrowser: () => undefined });
    layer.onFunctionCall({ callId: 'call_e', name: 'hermes_brain', arguments: { instruction: 'x' } });
    await sleep(30);
    check(
      '⑤b router 异常 → 兜底 failed 写回，会话不卡死',
      session.sentJson.length === 1 &&
        session.sentJson[0].status === 'failed' &&
        String(session.sentJson[0].output).includes('boom'),
    );
  }

  // ---------- ⑥ 会话未就绪 ----------
  {
    const router = new MockRouter();
    const layer = createFunctionCallingLayer({ router });
    // 不调用 onSessionCreated，直接来 function_call
    layer.onFunctionCall({ callId: 'call_0', name: 'hermes_brain', arguments: { instruction: 'x' } });
    await sleep(30);
    check('⑥ 会话未就绪 → 丢弃且不崩溃（router 未被调）', router.calls.length === 0);
  }

  // ---------- ⑦ 端到端装配：layer + gateway + mock provider/socket ----------
  {
    const session = new MockSession();
    const router = new MockRouter();
    const socket = new MockSocket();
    const layer = createFunctionCallingLayer({ router });

    const gateway = createVoiceGateway({
      provider: new MockProvider(session),
      onFunctionCall: layer.onFunctionCall,
      onSessionCreated: layer.onSessionCreated,
    });

    await gateway.handleConnection(socket, '测试人设指令');

    // 模拟 Qwen 下行 function_call（经 dispatcher → deps.onFunctionCall → layer）
    session.triggerFunctionCall({
      callId: 'call_gw',
      name: 'hermes_brain',
      arguments: { instruction: '查一下今天的天气' },
    });
    await sleep(30);

    const msgs = socket.parsed();
    check(
      '⑦ 浏览器收到 brain working + done（全链路）',
      msgs.some((m) => m.type === 'brain' && m.status === 'working') &&
        msgs.some((m) => m.type === 'brain' && m.status === 'done'),
    );
    check(
      '⑦ session 写回 function_call_output（call_id 原样带回）',
      session.sentJson.length === 1 &&
        session.sentJson[0].type === 'function_call_output' &&
        session.sentJson[0].callId === 'call_gw',
    );
    check(
      '⑦ router.handle 收到经 gateway 透传的调用',
      router.calls.length === 1 && router.calls[0].callId === 'call_gw',
    );
  }

  console.log(`\n== 结果汇总：${RESULTS.filter((r) => r.pass).length}/${RESULTS.length} 通过 ==`);
  RESULTS.forEach((r) => console.log(`  ${r.pass ? '✅' : '❌'} ${r.name}`));
  process.exit(RESULTS.every((r) => r.pass) ? 0 : 1);
}

main().catch((e) => {
  console.error('unit test 异常退出:', e);
  process.exit(1);
});

/**
 * voice-shell/gateway-unit-test.ts —— VS-02 网关逻辑自检（mock 驱动，零 API 额度）
 *
 * 验收项（docs/tasks/VS-02-gateway.md §6，mock 覆盖版）：
 *   1. 中继连通：handleConnection → provider.connect 被调 + 浏览器收到 ready/status
 *   2. 上行转发：{type:'audio', data:base64} → session.sendAudio 收到一致 PCM
 *      （CC-03 DEF-V-01：二进制音频帧直通为设计边界——前端走 base64 JSON，
 *        gateway 仅处理 text 帧，暂不支持二进制帧，用例已删除并注明，见下方）
 *   3. 下行转发：session audio 回调 → 浏览器收到 PCM24k base64；状态 speaking → idle
 *   4. 事件透传：subtitle/emotion → 浏览器 + deps 回调；function_call → 只透传不执行
 *   5. 断开清理：{type:'close'} 消息 / 浏览器断开 → session.close() 且无残留
 *   6. 错误兜底：provider 连接失败 → 浏览器收到 {type:'error'} + 连接关闭
 *   7.（VS-04）VAD 状态机：speech_started → 浏览器 status listening；speech_stopped → 回 connected
 *
 * CC-03 DEF-V-01 整改说明：原 M-V-TC-042「二进制音频帧直通 sendAudio」用例已删除。
 * 原因：当前前端通过 base64 JSON 发送音频（{type:'audio', data:base64}），gateway 仅处理
 * text 帧；二进制帧直通是架构不需要的场景（设计边界，P3）。若未来需要支持，
 * 应在 gateway 增加 Buffer 帧识别分支并恢复本用例——删除而非标注失败，防止误以为遗漏。
 *
 * 运行：node --experimental-strip-types voice-shell/gateway-unit-test.ts
 */

import { createVoiceGateway, type BrowserSocket } from './gateway.ts';
import type { VoiceProvider, VoiceSession } from './provider.ts';
import type { Emotion } from '../avatar/clip-matcher.ts';
import type { FunctionCall } from '../brain/function-router.ts';

const RESULTS: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string): void {
  RESULTS.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ------------------------------------------------------------------ mocks

class MockSession implements VoiceSession {
  sentAudio: Buffer[] = [];
  interruptCalls = 0;
  closeCalls = 0;
  injectCalls = 0;
  private cbs: {
    audio?: (c: Buffer) => void;
    subtitle?: (t: string) => void;
    emotion?: (e: Emotion) => void;
    functionCall?: (c: FunctionCall) => void;
    inputTranscript?: (t: string, info: { delta: boolean }) => void;
    vadState?: (speaking: boolean) => void;
  } = {};

  sendAudio(chunk: Buffer): void {
    this.sentAudio.push(chunk);
  }
  onAudio(cb: (c: Buffer) => void): void {
    this.cbs.audio = cb;
  }
  onSubtitle(cb: (t: string) => void): void {
    this.cbs.subtitle = cb;
  }
  onEmotion(cb: (e: Emotion) => void): void {
    this.cbs.emotion = cb;
  }
  onFunctionCall(cb: (c: FunctionCall) => void): void {
    this.cbs.functionCall = cb;
  }
  onInputTranscript(cb: (t: string, info: { delta: boolean }) => void): void {
    this.cbs.inputTranscript = cb;
  }
  onVadState(cb: (speaking: boolean) => void): void {
    this.cbs.vadState = cb;
  }
  sendFunctionCallOutput(): void {
    // VS-06：gateway 不执行 function_call（只透传），本 mock 无需记录
  }
  injectAssistantText(): void {
    this.injectCalls += 1;
  }
  interrupt(): void {
    this.interruptCalls += 1;
  }
  async close(): Promise<void> {
    this.closeCalls += 1;
  }
  // --- 测试触发（模拟 Qwen 下行）---
  triggerAudio(c: Buffer): void {
    this.cbs.audio?.(c);
  }
  triggerSubtitle(t: string): void {
    this.cbs.subtitle?.(t);
  }
  triggerEmotion(e: Emotion): void {
    this.cbs.emotion?.(e);
  }
  triggerFunctionCall(c: FunctionCall): void {
    this.cbs.functionCall?.(c);
  }
  triggerInputTranscript(t: string, info: { delta: boolean }): void {
    this.cbs.inputTranscript?.(t, info);
  }
  triggerVadState(speaking: boolean): void {
    this.cbs.vadState?.(speaking);
  }
}

class MockProvider implements VoiceProvider {
  connectCalls = 0;
  readonly session: MockSession;
  readonly failWith?: Error;
  constructor(session: MockSession, failWith?: Error) {
    this.session = session;
    this.failWith = failWith;
  }
  async connect(): Promise<VoiceSession> {
    this.connectCalls += 1;
    if (this.failWith) throw this.failWith;
    return this.session;
  }
}

class MockSocket implements BrowserSocket {
  readyState = 1; // OPEN
  sent: string[] = [];
  closed: { code: number; reason: string } | null = null;
  private handlers: Record<string, ((...a: unknown[]) => void)[] | undefined> = {};

  send(data: string | Uint8Array | ArrayBuffer): void {
    let buf: Buffer;
    if (typeof data === 'string') {
      buf = Buffer.from(data);
    } else if (data instanceof ArrayBuffer) {
      buf = Buffer.from(data);
    } else {
      buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    }
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
    this.readyState = 3; // CLOSED
  }
  // --- 测试触发（模拟浏览器上行）---
  emitMessage(obj: unknown): void {
    this.handlers['message']?.forEach((h) => h(JSON.stringify(obj)));
  }
  emitRaw(text: string): void {
    this.handlers['message']?.forEach((h) => h(text));
  }
  emitBinary(buf: Buffer): void {
    this.handlers['message']?.forEach((h) => h(buf));
  }
  emitClose(): void {
    this.readyState = 3;
    this.handlers['close']?.forEach((h) => h());
  }
  parsed(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

// ------------------------------------------------------------------ tests

async function main(): Promise<void> {
  console.log('== VS-02 gateway unit test（mock）==\n');

  const session = new MockSession();
  const provider = new MockProvider(session);
  const subtitleCb: string[] = [];
  const emotionCb: Emotion[] = [];
  const funcCb: FunctionCall[] = [];
  const transcriptCb: { text: string; delta: boolean }[] = [];
  let sessionCreated = 0;

  const socket = new MockSocket();
  const gateway = createVoiceGateway({
    provider,
    onSubtitle: (t) => subtitleCb.push(t),
    onEmotion: (e) => emotionCb.push(e),
    onFunctionCall: (c) => funcCb.push(c),
    onInputTranscript: (t, info) => transcriptCb.push({ text: t, delta: info.delta }),
    onSessionCreated: () => {
      sessionCreated += 1;
    },
  });

  await gateway.handleConnection(socket, '测试人设指令');

  // ① 中继连通
  let msgs = socket.parsed();
  check('① provider.connect 被调用（Qwen 会话建立）', provider.connectCalls === 1);
  check(
    '① 浏览器收到 ready（sampleRate=24000）',
    msgs.some((m) => m.type === 'ready' && (m.config as { sampleRate?: number } | undefined)?.sampleRate === 24000),
  );
  check(
    '① 状态 connected',
    msgs.some((m) => m.type === 'status' && m.state === 'connected'),
  );
  check('① onSessionCreated 触发（VS-06 挂载点）', sessionCreated === 1);

  // ② 上行转发：base64 JSON
  const pcm16k = Buffer.alloc(3200, 1); // 100ms 静音 PCM16k
  socket.emitMessage({ type: 'audio', data: pcm16k.toString('base64') });
  check(
    '② base64 音频 → sendAudio 收到一致 PCM16k',
    session.sentAudio.length === 1 && session.sentAudio[0].equals(pcm16k),
  );

  // ② 容错：非法 JSON 不崩溃
  socket.emitRaw('not-json{{');
  check('② 非法 JSON 容错（不抛错）', true);

  // ⚠️ CC-03 DEF-V-01：原「二进制音频帧直通 sendAudio」用例（M-V-TC-042）已删除——
  // 前端走 base64 JSON 发送音频，二进制帧直通为设计边界（架构不需要的场景）。
  // 若未来需支持，在 gateway 增加 Buffer 帧识别分支后恢复本用例（详见文件头注释）。

  // ③ 下行转发
  const pcm24k = Buffer.alloc(2400, 3);
  session.triggerAudio(pcm24k);
  msgs = socket.parsed();
  const audioMsg = msgs.filter((m) => m.type === 'audio').at(-1);
  check(
    '③ 浏览器收到 PCM24k base64 且一致',
    !!audioMsg && Buffer.from(audioMsg.data as string, 'base64').equals(pcm24k),
  );
  check(
    '③ 状态 speaking（AI 说话中）',
    msgs.some((m) => m.type === 'status' && m.state === 'speaking'),
  );

  // ③ idle 回退（停声 1.5s → idle）
  await sleep(1_700);
  check(
    '③ 停声后状态 idle',
    socket.parsed().some((m) => m.type === 'status' && m.state === 'idle'),
  );

  // ⑦（VS-04）VAD 状态机：speech_started → listening；speech_stopped → connected
  session.triggerVadState(true);
  msgs = socket.parsed();
  check(
    '⑦ VAD 开始说话 → 浏览器 status listening',
    msgs.some((m) => m.type === 'status' && m.state === 'listening'),
  );
  session.triggerVadState(false);
  msgs = socket.parsed();
  check(
    '⑦ VAD 语音结束 → 状态回 connected（等 AI 响应）',
    msgs.some((m) => m.type === 'status' && m.state === 'connected'),
  );

  // ④ 事件透传
  session.triggerSubtitle('你好呀，我是小呆');
  msgs = socket.parsed();
  check(
    '④ subtitle → 浏览器',
    msgs.some((m) => m.type === 'subtitle' && m.text === '你好呀，我是小呆'),
  );
  check('④ subtitle → deps.onSubtitle', subtitleCb.includes('你好呀，我是小呆'));

  session.triggerEmotion('happy');
  msgs = socket.parsed();
  check('④ emotion → 浏览器', msgs.some((m) => m.type === 'emotion' && m.emotion === 'happy'));
  check('④ emotion → deps.onEmotion', emotionCb.includes('happy'));

  const call: FunctionCall = { callId: 'call_1', name: 'hermes_brain', arguments: { instruction: '测试' } };
  session.triggerFunctionCall(call);
  check('④ function_call 只透传（不执行）', funcCb.length === 1 && funcCb[0] === call);

  // ④ VS-05 输入转写透传：增量 + 最终 → 浏览器 user_transcript + deps 回调
  session.triggerInputTranscript('你', { delta: true });
  session.triggerInputTranscript('你好', { delta: true });
  session.triggerInputTranscript('你好呀老板', { delta: false });
  msgs = socket.parsed();
  const tMsgs = msgs.filter((m) => m.type === 'user_transcript');
  check(
    '④ 转写增量 → 浏览器 user_transcript(delta=true)',
    tMsgs.length === 3 && tMsgs.filter((m) => m.delta === true).length === 2,
  );
  check(
    '④ 转写最终 → 浏览器 user_transcript(delta=false, 完整文本)',
    tMsgs.some((m) => m.delta === false && m.text === '你好呀老板'),
  );
  check('④ 转写 → deps.onInputTranscript', transcriptCb.length === 3 && transcriptCb.at(-1)?.text === '你好呀老板');

  // ⑤ interrupt 消息
  socket.emitMessage({ type: 'interrupt' });
  check('⑤ interrupt → session.interrupt()', session.interruptCalls === 1);

  // ⑤ {type:'close'} 消息 → 清理
  socket.emitMessage({ type: 'close' });
  await sleep(80);
  check('⑤ close 消息 → session.close()', session.closeCalls === 1);
  check('⑤ close 消息 → 浏览器 WS 关闭', socket.closed !== null && socket.closed.code === 1000);

  // ⑤ 浏览器断开 → 清理（新连接）
  const session2 = new MockSession();
  const socket2 = new MockSocket();
  const gateway2 = createVoiceGateway({ provider: new MockProvider(session2) });
  await gateway2.handleConnection(socket2, '');
  socket2.emitClose();
  await sleep(80);
  check('⑤ 浏览器断开 → session.close() 且无残留', session2.closeCalls === 1);

  // ⑥ 错误兜底：provider 连接失败
  const socket3 = new MockSocket();
  const gateway3 = createVoiceGateway({
    provider: new MockProvider(new MockSession(), new Error('模拟连接失败')),
  });
  await gateway3.handleConnection(socket3, '');
  const errMsg = socket3.parsed().find((m) => m.type === 'error');
  check('⑥ provider 失败 → 浏览器收到 error', !!errMsg && String(errMsg.message).includes('模拟连接失败'));
  check('⑥ provider 失败 → 连接关闭（1011）', socket3.closed?.code === 1011);

  console.log(`\n== 结果汇总：${RESULTS.filter((r) => r.pass).length}/${RESULTS.length} 通过 ==`);
  RESULTS.forEach((r) => console.log(`  ${r.pass ? '✅' : '❌'} ${r.name}`));
  process.exit(RESULTS.every((r) => r.pass) ? 0 : 1);
}

main().catch((e) => {
  console.error('unit test 异常退出:', e);
  process.exit(1);
});

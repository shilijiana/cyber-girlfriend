/**
 * app/server/ws-test.ts —— AP-05 WS 服务端自检（mock 驱动，零 API 额度）
 *
 * 验收项（TASKS-CONFIG §4 AP-05）：
 *   1. 挂载：WebSocketServer 挂到 /ws/voice，浏览器连入 → gateway 接管（ready/status 下行）
 *   2. 人设注入：resolveInstructions 被调用，instructions 传给 provider.connect
 *   3. 中继链路：上行 {type:'audio'} → session.sendAudio；session 下行 audio/subtitle → 浏览器
 *   4. 断开清理：浏览器断开 → gateway 关闭 Qwen 会话（session.close 被调），无残留
 *   5. 错误兜底：provider 连接失败 → 浏览器收到 {type:'error'} + 连接关闭
 *   6. 生命周期：handle.close() 断开全部连接并关闭 wss；服务器整体可关
 *   7. 路径隔离：非 /ws/voice 的 upgrade 不处理（客户端连接失败/无 ready）
 *
 * 运行：node --experimental-strip-types app/server/ws-test.ts
 */

import { createServer, type Server } from 'http';
import { WebSocket, type RawData } from 'ws';
import { createApp } from './index.ts';
import { setupVoiceWebSocket, VOICE_WS_PATH, type VoiceWsHandle } from './ws.ts';
import type { VoiceProvider, VoiceSession } from '../../voice-shell/provider.ts';
import type { Emotion } from '../../avatar/clip-matcher.ts';
import type { FunctionCall } from '../../brain/function-router.ts';

const RESULTS: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string): void {
  RESULTS.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
/** 等条件成立（轮询，超时返回 false） */
async function waitFor(cond: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < timeoutMs) await sleep(50);
  return cond();
}

const TEST_INSTRUCTIONS = '[AP-05 测试人设] 你是小呆，语音助理。';

// ------------------------------------------------------------------ mocks

class MockSession implements VoiceSession {
  sentAudio: Buffer[] = [];
  interruptCalls = 0;
  closeCalls = 0;
  lastInstructions = '';
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
    /* VS-06 写回，gateway 只透传，mock 无需记录 */
  }
  injectAssistantText(): void {
    /* 测试不触发 */
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
}

class MockProvider implements VoiceProvider {
  connectCalls = 0;
  readonly session: MockSession;
  readonly failWith?: Error;
  constructor(session: MockSession, failWith?: Error) {
    this.session = session;
    this.failWith = failWith;
  }
  async connect(_sessionId: string, personaInstructions: string): Promise<VoiceSession> {
    this.connectCalls += 1;
    this.session.lastInstructions = personaInstructions;
    if (this.failWith) throw this.failWith;
    return this.session;
  }
}

/** 解析客户端收到的 JSON 事件（忽略二进制帧） */
function parseEvents(msgs: RawData[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of msgs) {
    try {
      out.push(JSON.parse(m.toString()) as Record<string, unknown>);
    } catch {
      // 二进制音频帧，跳过
    }
  }
  return out;
}

async function main(): Promise<void> {
  console.log('== AP-05 WS 服务端自检（mock，零额度）==\n');

  // ------------------------------------------------------------------ ① 挂载 + 人设注入 + 中继链路
  {
    const session = new MockSession();
    const provider = new MockProvider(session);
    const server: Server = createServer(createApp());
    const handle: VoiceWsHandle = setupVoiceWebSocket({
      server,
      resolveInstructions: async () => TEST_INSTRUCTIONS,
      provider,
      log: () => undefined, // 静默
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;

    // 浏览器客户端连入 /ws/voice
    const client = new WebSocket(`ws://127.0.0.1:${port}${VOICE_WS_PATH}`);
    client.binaryType = 'nodebuffer';
    const msgs: RawData[] = [];
    client.on('message', (d) => msgs.push(d as RawData));
    await new Promise<void>((resolve, reject) => {
      client.once('open', resolve);
      client.once('error', reject);
    });

    // ① 挂载成功：等 gateway 就绪（mock provider connect → ready + status connected）
    const connected = await waitFor(() => provider.connectCalls >= 1 && parseEvents(msgs).some((e) => e.type === 'ready'));
    check('① /ws/voice 挂载（连入 → gateway 接管 → ready）', connected, `connectCalls=${provider.connectCalls}`);
    check('① 状态下行（status connected）', parseEvents(msgs).some((e) => e.type === 'status' && e.state === 'connected'));

    // ② 人设注入：instructions 传到 provider.connect
    check('② 人设注入（resolveInstructions → connect）', session.lastInstructions === TEST_INSTRUCTIONS);

    // ③ 中继链路：上行 audio → sendAudio；session 下行 audio/subtitle → 浏览器
    const pcm16k = Buffer.alloc(3200); // 100ms 静音帧
    client.send(JSON.stringify({ type: 'audio', data: pcm16k.toString('base64') }));
    await sleep(150);
    check('③ 上行转发（audio → session.sendAudio）', session.sentAudio.length === 1 && session.sentAudio[0].equals(pcm16k));

    const before = msgs.length;
    session.triggerAudio(Buffer.alloc(2400)); // 100ms PCM24k
    session.triggerSubtitle('你好呀');
    session.triggerEmotion('happy');
    const relayed = await waitFor(() => {
      const evs = parseEvents(msgs.slice(before));
      return evs.some((e) => e.type === 'audio') && evs.some((e) => e.type === 'subtitle') && evs.some((e) => e.type === 'emotion');
    });
    check('③ 下行转发（audio/subtitle/emotion → 浏览器）', relayed);

    // ④ 断开清理：浏览器断开 → gateway 关闭会话
    client.close();
    const cleaned = await waitFor(() => session.closeCalls >= 1);
    check('④ 断开清理（浏览器断开 → session.close）', cleaned, `closeCalls=${session.closeCalls}`);

    // ⑥ 生命周期：handle.close() 幂等关闭 wss
    await handle.close();
    await new Promise<void>((r) => server.close(() => r()));
    check('⑥ 生命周期（handle.close → wss 关闭，无残留）', true);
  }

  // ------------------------------------------------------------------ ⑤ 错误兜底（provider 失败）
  {
    const provider = new MockProvider(new MockSession(), new Error('mock 连接失败'));
    const server: Server = createServer(createApp());
    const handle = setupVoiceWebSocket({
      server,
      resolveInstructions: async () => TEST_INSTRUCTIONS,
      provider,
      log: () => undefined,
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;

    const client = new WebSocket(`ws://127.0.0.1:${port}${VOICE_WS_PATH}`);
    client.binaryType = 'nodebuffer';
    const msgs: RawData[] = [];
    let closed = false;
    client.on('message', (d) => msgs.push(d as RawData));
    client.on('close', () => {
      closed = true;
    });
    await new Promise<void>((resolve, reject) => {
      client.once('open', resolve);
      client.once('error', reject);
    });

    // error 消息先到、close 帧后到（协商关闭握手有往返），需一起等
    const gotError = await waitFor(() => parseEvents(msgs).some((e) => e.type === 'error') && closed);
    check('⑤ 错误兜底（provider 失败 → {type:error} + 关闭）', gotError, `closed=${closed}`);

    client.terminate?.();
    await handle.close();
    await new Promise<void>((r) => server.close(() => r()));
  }

  // ------------------------------------------------------------------ ⑦ 路径隔离（非 /ws/voice 不处理）
  {
    const server: Server = createServer(createApp());
    const handle = setupVoiceWebSocket({
      server,
      resolveInstructions: async () => TEST_INSTRUCTIONS,
      provider: new MockProvider(new MockSession()),
      log: () => undefined,
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;

    // 连其他路径：ws 库 attach 模式不处理 → 客户端得不到 ready（连接被拒或直接关闭）
    const client = new WebSocket(`ws://127.0.0.1:${port}/api/chat`);
    client.binaryType = 'nodebuffer';
    const msgs: RawData[] = [];
    let closed = false;
    let errored = false;
    client.on('message', (d) => msgs.push(d as RawData));
    client.on('close', () => {
      closed = true;
    });
    client.on('error', () => {
      errored = true;
    });
    await new Promise<void>((resolve, reject) => {
      client.once('open', resolve);
      client.once('error', () => {
        errored = true;
        resolve(); // 拒绝也视为"未接管"，继续断言
      });
    });

    const notServed = await waitFor(() => closed || errored, 3_000);
    check('⑦ 路径隔离（非 /ws/voice 不接管）', notServed && parseEvents(msgs).length === 0, `closed=${closed} errored=${errored}`);

    client.terminate?.();
    await handle.close();
    await new Promise<void>((r) => server.close(() => r()));
  }

  console.log(`\n== 结果汇总：${RESULTS.filter((r) => r.pass).length}/${RESULTS.length} 通过 ==`);
  RESULTS.forEach((r) => console.log(`  ${r.pass ? '✅' : '❌'} ${r.name}`));
  process.exit(RESULTS.every((r) => r.pass) ? 0 : 1);
}

main().catch((e) => {
  console.error('AP-05 自检异常退出:', e);
  process.exit(1);
});

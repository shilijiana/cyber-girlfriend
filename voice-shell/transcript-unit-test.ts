/**
 * voice-shell/transcript-unit-test.ts —— VS-05 输入转写单测（mock WebSocket，零 API 额度）
 *
 * 验收项（docs/TASKS-CONFIG.md VS-05）：
 *   1. session.update 注入 input_audio_transcription（enabled + fun-asr）
 *   2. conversation.item.input_audio_transcription.delta → onInputTranscript(delta=true, 增量文本)
 *   3. conversation.item.input_audio_transcription.completed → onInputTranscript(delta=false, 完整转写)
 *   4. delta 事件内嵌 emotion → emotion 回调仍触发（协议无独立 emotion 事件，双兼容）
 *   5. close 后回调清理（不再触发）
 *
 * 运行：node --experimental-strip-types voice-shell/transcript-unit-test.ts
 * 说明：替换全局 WebSocket 为 mock，不消耗 API 额度；Key 用假值即可。
 */

import { createQwenAudioClient } from './qwen-audio-client.ts';
import type { Emotion } from '../avatar/clip-matcher.ts';

const RESULTS: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string): void {
  RESULTS.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

// ------------------------------------------------------------------ mock WebSocket

class MockWebSocket {
  static OPEN = 1;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sent: string[] = [];
  closed = false;

  constructor(_url: string, _protocols?: unknown) {
    this.readyState = 0; // CONNECTING
    // 客户端 openConnection 后（onopen/onmessage 已赋值）自动回放服务端握手事件
    setImmediate(() => this.connectServer());
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(code = 1000, _reason = ''): void {
    this.closed = true;
    this.readyState = 3;
    this.onclose?.({ code, reason: String(_reason) });
  }
  // --- 测试触发（模拟 Qwen 服务端下行 JSON 事件）---
  emitServerEvent(ev: unknown): void {
    this.onmessage?.({ data: JSON.stringify(ev) });
  }
  // --- 连接就绪模拟：open → session.created → session.updated ---
  connectServer(): void {
    this.readyState = 1;
    this.onopen?.();
    this.emitServerEvent({ type: 'session.created', session: { id: 'sess_mock_001' } });
    this.emitServerEvent({ type: 'session.updated' });
  }
  sentJson(): Array<Record<string, unknown>> {
    return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>);
  }
}

let mockWs: MockWebSocket | null = null;
(globalThis as unknown as { WebSocket: unknown }).WebSocket = class extends MockWebSocket {
  constructor(url: string, protocols?: unknown) {
    super(url, protocols);
    mockWs = this;
  }
} as unknown as typeof WebSocket;

// ------------------------------------------------------------------ tests

async function main(): Promise<void> {
  console.log('== VS-05 transcript unit test（mock WebSocket）==\n');

  const provider = createQwenAudioClient({ apiKey: 'test-key' });
  const session = await provider.connect('transcript-test', '测试人设指令');

  check('① WS 连接建立（mock session.updated）', !!mockWs && mockWs.readyState === 1);

  // ① session.update 载荷校验：input_audio_transcription 注入
  const updateMsg = mockWs!.sentJson().find((m) => m.type === 'session.update');
  const it = (updateMsg?.session as { input_audio_transcription?: { enabled?: boolean; model?: string } } | undefined)
    ?.input_audio_transcription;
  check(
    '① session.update 注入 input_audio_transcription（enabled+fun-asr）',
    !!it && it.enabled === true && it.model === 'fun-asr',
    JSON.stringify(it),
  );

  // ②③ 转写回调收集
  const transcriptCb: { text: string; delta: boolean }[] = [];
  const emotionCb: Emotion[] = [];
  session.onInputTranscript((t, info) => {
    transcriptCb.push({ text: t, delta: info.delta });
    console.log(`  [input_transcript] delta=${info.delta} text="${t}"`);
  });
  session.onEmotion((e) => emotionCb.push(e));

  // ② delta 增量事件
  mockWs!.emitServerEvent({ type: 'conversation.item.input_audio_transcription.delta', delta: '你' });
  mockWs!.emitServerEvent({ type: 'conversation.item.input_audio_transcription.delta', delta: '你好' });
  check(
    '② delta 事件 → 回调 delta=true 增量',
    transcriptCb.length === 2 && transcriptCb.every((c) => c.delta === true) && transcriptCb[0].text === '你',
    `收到 ${transcriptCb.length} 条增量`,
  );

  // ③ completed 最终转写
  mockWs!.emitServerEvent({
    type: 'conversation.item.input_audio_transcription.completed',
    transcript: '你好呀老板',
  });
  check(
    '③ completed 事件 → 回调 delta=false 完整转写',
    transcriptCb.length === 3 && transcriptCb[2].delta === false && transcriptCb[2].text === '你好呀老板',
  );

  // ④ delta 内嵌 emotion（协议无独立 emotion 事件，双兼容）
  mockWs!.emitServerEvent({ type: 'conversation.item.input_audio_transcription.delta', delta: '好', emotion: 'happy' });
  check('④ 转写 delta 内嵌 emotion → emotion 回调仍触发', emotionCb.includes('happy'), `emotions=${emotionCb.join(',')}`);

  // ④ 容错：空文本不回调
  const before = transcriptCb.length;
  mockWs!.emitServerEvent({ type: 'conversation.item.input_audio_transcription.delta', delta: '' });
  mockWs!.emitServerEvent({ type: 'conversation.item.input_audio_transcription.completed', transcript: '' });
  check('④ 空文本增量/转写不触发回调', transcriptCb.length === before);

  // ⑤ close 后回调清理
  await session.close();
  const beforeClose = transcriptCb.length;
  mockWs!.emitServerEvent({ type: 'conversation.item.input_audio_transcription.delta', delta: '残留' });
  check('⑤ close 后回调清理（不再触发）', transcriptCb.length === beforeClose);

  console.log(`\n== 结果汇总：${RESULTS.filter((r) => r.pass).length}/${RESULTS.length} 通过 ==`);
  RESULTS.forEach((r) => console.log(`  ${r.pass ? '✅' : '❌'} ${r.name}`));
  process.exit(RESULTS.every((r) => r.pass) ? 0 : 1);
}

main().catch((e) => {
  console.error('transcript unit test 异常退出:', e);
  process.exit(1);
});

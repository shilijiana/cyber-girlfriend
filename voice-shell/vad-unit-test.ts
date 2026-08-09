/**
 * voice-shell/vad-unit-test.ts —— VS-04 VAD 与打断单测（mock WebSocket，零 API 额度）
 *
 * 验收项（docs/TASKS-CONFIG.md VS-04）：
 *   1. session.update 默认注入 turn_detection:{type:'server_vad', threshold, silence_duration_ms}
 *   2. input_audio_buffer.speech_started → onVadState(true)（用户开始说话）
 *   3. input_audio_buffer.speech_stopped → onVadState(false)（语音结束）
 *   4. 容错：turnDetection:null → push-to-talk（turn_detection 置 null，不启用 server_vad）
 *   5. close 后回调清理（不再触发）
 *
 * 运行：node --experimental-strip-types voice-shell/vad-unit-test.ts
 * 说明：替换全局 WebSocket 为 mock，不消耗 API 额度；Key 用假值即可。
 */

import { createQwenAudioClient } from './qwen-audio-client.ts';

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
    this.emitServerEvent({ type: 'session.created', session: { id: 'sess_mock_vad' } });
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
  console.log('== VS-04 VAD unit test（mock WebSocket）==\n');

  const provider = createQwenAudioClient({ apiKey: 'test-key' });
  const session = await provider.connect('vad-test', '测试人设指令');

  check('① WS 连接建立（mock session.updated）', !!mockWs && mockWs.readyState === 1);

  // ① session.update 载荷校验：turn_detection 默认 server_vad + 参数
  const updateMsg = mockWs!.sentJson().find((m) => m.type === 'session.update');
  const td = (updateMsg?.session as { turn_detection?: Record<string, unknown> } | undefined)?.turn_detection;
  check(
    '① session.update 注入 turn_detection:{type:"server_vad"}',
    !!td && td.type === 'server_vad',
    JSON.stringify(td),
  );
  check(
    '① server_vad 含 threshold + silence_duration_ms（官方推荐 400-800ms）',
    typeof td?.threshold === 'number' &&
      typeof td?.silence_duration_ms === 'number' &&
      (td.silence_duration_ms as number) >= 400 &&
      (td.silence_duration_ms as number) <= 800,
    JSON.stringify(td),
  );

  // ②③ VAD 回调收集
  const vadCb: boolean[] = [];
  session.onVadState((speaking) => {
    vadCb.push(speaking);
    console.log(`  [vad_state] speaking=${speaking}`);
  });

  // ② speech_started → true
  mockWs!.emitServerEvent({ type: 'input_audio_buffer.speech_started', item_id: 'item_vad_1', audio_start_ms: 1200 });
  check(
    '② speech_started 事件 → onVadState(true)',
    vadCb.length === 1 && vadCb[0] === true,
    `vadCb=${vadCb.join(',')}`,
  );

  // ③ speech_stopped → false
  mockWs!.emitServerEvent({ type: 'input_audio_buffer.speech_stopped', item_id: 'item_vad_1', audio_end_ms: 3400 });
  check(
    '③ speech_stopped 事件 → onVadState(false)',
    vadCb.length === 2 && vadCb[1] === false,
    `vadCb=${vadCb.join(',')}`,
  );

  // ③ 容错：smart_turn 的 speech_stopped 带 reason=turn_invalid 也只归 false（不崩溃）
  mockWs!.emitServerEvent({
    type: 'input_audio_buffer.speech_stopped',
    item_id: 'item_vad_2',
    audio_end_ms: 4000,
    reason: 'turn_invalid',
  });
  check('③ speech_stopped 带 reason 容错（不崩溃，仍回 false）', vadCb.at(-1) === false);

  // ④ push-to-talk 模式：turnDetection:null → turn_detection 置 null（不启用 server_vad）
  await session.close();
  const provider2 = createQwenAudioClient({ apiKey: 'test-key', turnDetection: null });
  const session2 = await provider2.connect('vad-test-ptt', '测试人设指令');
  const updateMsg2 = mockWs!.sentJson().find((m) => m.type === 'session.update');
  const td2 = (updateMsg2?.session as { turn_detection?: unknown } | undefined)?.turn_detection;
  check('④ turnDetection:null → session 配 push-to-talk（turn_detection 为 null）', td2 === null, JSON.stringify(td2));

  // ⑤ close 后回调清理
  const beforeClose = vadCb.length;
  await session2.close();
  mockWs!.emitServerEvent({ type: 'input_audio_buffer.speech_started', item_id: 'item_vad_3' });
  check('⑤ close 后回调清理（不再触发）', vadCb.length === beforeClose);

  console.log(`\n== 结果汇总：${RESULTS.filter((r) => r.pass).length}/${RESULTS.length} 通过 ==`);
  RESULTS.forEach((r) => console.log(`  ${r.pass ? '✅' : '❌'} ${r.name}`));
  process.exit(RESULTS.every((r) => r.pass) ? 0 : 1);
}

main().catch((e) => {
  console.error('vad unit test 异常退出:', e);
  process.exit(1);
});

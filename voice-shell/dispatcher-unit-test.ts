/**
 * voice-shell/dispatcher-unit-test.ts —— VS-03 双路分发器自检（mock 驱动，零 API 额度）
 *
 * 验收项（docs/TASKS-CONFIG.md §VS-03，mock 覆盖版）：
 *   1. 音频→播放：bind 后 session.triggerAudio → 消费者 onAudio 收到一致 PCM
 *   2. 副文本→字幕：triggerSubtitle → onSubtitle 收到增量文本
 *   3. 情绪→数字人：triggerEmotion → onEmotion 收到情绪（驱动选片）
 *   4. 多消费者：两路消费者都收到同一事件（双路分发核心）
 *   5. VAD 状态（VS-04）：triggerVadState → onVadState(speaking)
 *   6. function_call 只透传：triggerFunctionCall → onFunctionCall 收到，不执行
 *   7. 退订：subscribe 返回的退订函数 → 之后不再收到（幂等重复调用无副作用）
 *   8. 错误隔离：某消费者回调抛错 → 其他消费者仍收到 + 广播不中断
 *   9. dispose 幂等：重复调用无异常，清空后不再广播
 *  10. 重新 bind：绑定新会话 → 旧会话事件不再广播
 *
 * 运行：node --experimental-strip-types voice-shell/dispatcher-unit-test.ts
 */

import { createVoiceDispatcher, type VoiceConsumer } from './dispatcher.ts';
import type { VoiceSession } from './provider.ts';
import type { Emotion } from '../avatar/clip-matcher.ts';
import type { FunctionCall } from '../brain/function-router.ts';

const RESULTS: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string): void {
  RESULTS.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

// ------------------------------------------------------------------ mock session

class MockSession implements VoiceSession {
  sentAudio: Buffer[] = [];
  private cbs: {
    audio?: (c: Buffer) => void;
    subtitle?: (t: string) => void;
    emotion?: (e: Emotion) => void;
    vadState?: (speaking: boolean) => void;
    functionCall?: (c: FunctionCall) => void;
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
  onVadState(cb: (speaking: boolean) => void): void {
    this.cbs.vadState = cb;
  }
  onFunctionCall(cb: (c: FunctionCall) => void): void {
    this.cbs.functionCall = cb;
  }
  onInputTranscript(): void {
    // VS-05：dispatcher 不消费，mock 置空
  }
  sendFunctionCallOutput(): void {
    // VS-06：dispatcher 不写回，mock 置空
  }
  injectAssistantText(): void {
    // 无关
  }
  interrupt(): void {
    // 无关
  }
  async close(): Promise<void> {
    // 无关
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
  triggerVadState(s: boolean): void {
    this.cbs.vadState?.(s);
  }
  triggerFunctionCall(c: FunctionCall): void {
    this.cbs.functionCall?.(c);
  }
}

// ------------------------------------------------------------------ helpers

function makeCollector(): {
  consumer: VoiceConsumer;
  audio: Buffer[];
  subtitle: string[];
  emotion: Emotion[];
  vad: boolean[];
  calls: FunctionCall[];
} {
  const audio: Buffer[] = [];
  const subtitle: string[] = [];
  const emotion: Emotion[] = [];
  const vad: boolean[] = [];
  const calls: FunctionCall[] = [];
  const consumer: VoiceConsumer = {
    onAudio: (c) => audio.push(c),
    onSubtitle: (t) => subtitle.push(t),
    onEmotion: (e) => emotion.push(e),
    onVadState: (s) => vad.push(s),
    onFunctionCall: (c) => calls.push(c),
  };
  return { consumer, audio, subtitle, emotion, vad, calls };
}

// ------------------------------------------------------------------ tests

async function main(): Promise<void> {
  console.log('== VS-03 dispatcher unit test（mock）==\n');

  // ① 音频→播放 / ② 副文本→字幕 / ③ 情绪→数字人（三路分发）
  {
    const session = new MockSession();
    const d = createVoiceDispatcher();
    const a = makeCollector();
    d.subscribe(a.consumer);
    d.bind(session);

    const pcm = Buffer.alloc(2400, 7);
    session.triggerAudio(pcm);
    check('① 音频 → onAudio 收到一致 PCM24k', a.audio.length === 1 && a.audio[0].equals(pcm));

    session.triggerSubtitle('你好呀');
    session.triggerSubtitle('，我是小呆');
    check('② 副文本 → onSubtitle 收到增量文本', a.subtitle.length === 2 && a.subtitle.join('') === '你好呀，我是小呆');

    session.triggerEmotion('happy');
    check('③ 情绪 → onEmotion 收到 happy', a.emotion.length === 1 && a.emotion[0] === 'happy');

    // ⑤ VAD 状态（VS-04）
    session.triggerVadState(true);
    session.triggerVadState(false);
    check('⑤ VAD → onVadState(true/false)', a.vad.length === 2 && a.vad[0] === true && a.vad[1] === false);

    // ⑥ function_call 只透传
    const call: FunctionCall = { callId: 'call_1', name: 'hermes_brain', arguments: { instruction: '测试' } };
    session.triggerFunctionCall(call);
    check('⑥ function_call 只透传（不执行）', a.calls.length === 1 && a.calls[0] === call);

    d.dispose();
  }

  // ④ 多消费者：两路消费者都收到同一事件（双路分发核心）
  {
    const session = new MockSession();
    const d = createVoiceDispatcher();
    const a = makeCollector();
    const b = makeCollector();
    d.subscribe(a.consumer);
    d.subscribe(b.consumer);
    d.bind(session);

    session.triggerSubtitle('双路');
    session.triggerEmotion('gentle');
    check(
      '④ 双消费者同收 subtitle（广播 = 订阅顺序）',
      a.subtitle.length === 1 && b.subtitle.length === 1 && a.subtitle[0] === b.subtitle[0],
    );
    check('④ 双消费者同收 emotion', a.emotion.length === 1 && b.emotion.length === 1);

    d.dispose();
  }

  // ⑦ 退订：退订后不再收到；幂等
  {
    const session = new MockSession();
    const d = createVoiceDispatcher();
    const a = makeCollector();
    const b = makeCollector();
    d.subscribe(a.consumer);
    const unsubscribe = d.subscribe(b.consumer);
    d.bind(session);

    session.triggerSubtitle('第一波');
    check('⑦ 退订前两路都收到', a.subtitle.length === 1 && b.subtitle.length === 1);

    unsubscribe();
    unsubscribe(); // 幂等
    session.triggerSubtitle('第二波');
    check('⑦ 退订后 A 仍收（另一路不受影响）', a.subtitle.length === 2);
    check('⑦ 退订后 B 不再收到', b.subtitle.length === 1);

    d.dispose();
  }

  // ⑧ 错误隔离：某消费者抛错不影响其他消费者与后续广播
  {
    const session = new MockSession();
    const d = createVoiceDispatcher();
    const a = makeCollector();
    const b = makeCollector();
    d.subscribe({
      ...a.consumer,
      onSubtitle: () => {
        throw new Error('模拟消费者故障');
      },
    });
    d.subscribe(b.consumer);
    d.bind(session);

    session.triggerSubtitle('容错');
    check('⑧ 抛错消费者 A 异常被隔离（不中断）', true);
    check('⑧ B 消费者仍收到（错误隔离生效）', b.subtitle.length === 1 && b.subtitle[0] === '容错');

    // 后续广播不中断
    session.triggerEmotion('serious');
    check('⑧ 后续广播不受影响（emotion → B）', b.emotion.length === 1 && b.emotion[0] === 'serious');

    d.dispose();
  }

  // ⑨ dispose 幂等 + 清空后不再广播
  {
    const session = new MockSession();
    const d = createVoiceDispatcher();
    const a = makeCollector();
    d.subscribe(a.consumer);
    d.bind(session);

    session.triggerSubtitle('清空前');
    d.dispose();
    d.dispose(); // 幂等
    session.triggerSubtitle('清空后');
    check('⑨ dispose 后不再广播', a.subtitle.length === 1 && a.subtitle[0] === '清空前');
    check('⑨ dispose 幂等（重复调用无异常）', true);

    // dispose 后可复用：重新订阅 + bind
    const session2 = new MockSession();
    d.subscribe(a.consumer);
    d.bind(session2);
    session2.triggerSubtitle('复用成功');
    check('⑨ dispose 后可复用（重新订阅+bind）', a.subtitle.at(-1) === '复用成功');

    d.dispose();
  }

  // ⑩ 重新 bind：旧会话事件不再广播
  {
    const sessionA = new MockSession();
    const sessionB = new MockSession();
    const d = createVoiceDispatcher();
    const a = makeCollector();
    d.subscribe(a.consumer);
    d.bind(sessionA);
    d.bind(sessionB); // 重绑到 B

    sessionA.triggerSubtitle('旧会话事件');
    sessionB.triggerSubtitle('新会话事件');
    check('⑩ 重绑后旧会话事件不再广播', a.subtitle.length === 1 && a.subtitle[0] === '新会话事件');

    d.dispose();
  }

  console.log(`\n== 结果汇总：${RESULTS.filter((r) => r.pass).length}/${RESULTS.length} 通过 ==`);
  RESULTS.forEach((r) => console.log(`  ${r.pass ? '✅' : '❌'} ${r.name}`));
  process.exit(RESULTS.every((r) => r.pass) ? 0 : 1);
}

main().catch((e) => {
  console.error('unit test 异常退出:', e);
  process.exit(1);
});

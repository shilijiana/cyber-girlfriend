/**
 * voice-shell/smoke-test.ts —— VS-01 验收试跑脚本（临时，真实连接）
 *
 * 验收项（docs/tasks/VS-01-qwen-audio-client.md §6）：
 *   1. WS 连接成功（session.created 返回 session_id）
 *   2. 人设注入（session.update → session.updated）
 *   3. 音频上行（sendAudio 发送 PCM 16k 无报错）
 *   4. 事件回调（injectAssistantText 触发 subtitle + audio 事件）
 *   5. 断线重连（模拟网络中断后自动重连并重新注入）
 *
 * 运行：node --experimental-strip-types voice-shell/smoke-test.ts
 * 注意：真实调用 Qwen-Audio，会消耗 API 额度；Key 从 config/loader.ts 读，不硬编码。
 */

import { createQwenAudioClient } from './qwen-audio-client.ts';
import type { VoiceSession } from './provider.ts';

const RESULTS: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string): void {
  RESULTS.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

/** 小睡封装 */
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log('== VS-01 smoke test ==\n');
  const provider = createQwenAudioClient();
  const persona = [
    '[角色卡]',
    '你是小呆，18 岁的 AI 少女，老板的语音助理。说话活泼可爱、简洁口语化。',
    '',
    '[测试要求]',
    '回答尽量简短，50 字以内。',
  ].join('\n');

  const collected: { subtitle: string[]; audioBytes: number; serverSessionId: string } = {
    subtitle: [],
    audioBytes: 0,
    serverSessionId: '',
  };

  let session: VoiceSession;
  // ① 连接 + 人设注入（内部：session.created → session.update → session.updated）
  try {
    session = await provider.connect('smoke-test', persona);
    check('① WS 连接成功（session.created/updated）', true);
    check('② 人设注入成功（session.updated）', true);
    collected.serverSessionId = (session as { getServerSessionId?: () => string }).getServerSessionId?.() ?? '';
  } catch (e) {
    check('① WS 连接成功（session.created/updated）', false, String(e));
    check('② 人设注入成功（session.updated）', false, String(e));
    return;
  }

  session.onSubtitle((t) => {
    collected.subtitle.push(t);
    console.log(`  [subtitle] ${t}`);
  });
  session.onAudio((chunk) => {
    collected.audioBytes += chunk.length;
  });
  session.onFunctionCall((call) => {
    console.log(`  [function_call] ${call.name} args=${JSON.stringify(call.arguments)}`);
  });
  session.onEmotion((e) => console.log(`  [emotion] ${e}`));

  // ④ 注入文本 → 触发推理 → 收集 subtitle + audio（等 12s）
  console.log('\n④ injectAssistantText 触发对话…');
  session.injectAssistantText('你好呀，用一句话介绍一下你自己吧');
  await sleep(12_000);
  check(
    '④ 事件回调（收到 subtitle）',
    collected.subtitle.length > 0,
    `subtitle 片段数=${collected.subtitle.length}，完整文本="${collected.subtitle.join('')}"`,
  );
  check('④ 事件回调（收到下行音频 audio）', collected.audioBytes > 0, `audio 字节=${collected.audioBytes}`);

  // ③ 音频上行：发 100ms 静音 PCM16k（16bit 单声道 = 16000*2*0.1 = 3200 字节）
  console.log('\n③ sendAudio 上行静音帧…');
  const silence = Buffer.alloc(3200);
  session.sendAudio(silence);
  await sleep(500);
  check('③ 音频上行无报错（sendAudio 静音帧）', true);

  // ⑤ 断线重连：模拟网络中断（关闭底层 WS，观察自动重连 + 重新注入 + 可继续对话）
  console.log('\n⑤ 断线重连测试…');
  const rawWs = (session as { ws?: { close: (c: number) => void } }).ws;
  if (rawWs) {
    const subtitleBefore = collected.subtitle.length;
    rawWs.close(4001);
    await sleep(6_000); // 等退避 1s + 重连 + session.update → session.updated
    const serverIdAfter = (session as { getServerSessionId?: () => string }).getServerSessionId?.() ?? '';
    check(
      '⑤ 断线后自动重连',
      serverIdAfter.length > 0 && serverIdAfter !== collected.serverSessionId,
      `重连后新 session_id=${serverIdAfter}${collected.serverSessionId ? `（旧=${collected.serverSessionId.slice(0, 12)}…）` : ''}`,
    );
    // 重连后继续对话，验证人设注入已恢复
    console.log('  [重连后] 再次触发对话…');
    session.injectAssistantText('我刚才说了什么来着？');
    await sleep(5_000);
    const newSubtitle = collected.subtitle.slice(subtitleBefore).join('');
    check('⑤ 重连后人设注入恢复（可继续对话）', newSubtitle.length > 0, `新 subtitle="${newSubtitle.slice(0, 60)}"`);
  } else {
    check('⑤ 断线后自动重连', false, '无法访问底层 WS');
  }

  // 收尾
  await session.close();
  console.log(`\n== 结果汇总：${RESULTS.filter((r) => r.pass).length}/${RESULTS.length} 通过 ==`);
  RESULTS.forEach((r) => console.log(`  ${r.pass ? '✅' : '❌'} ${r.name}`));
  process.exit(RESULTS.every((r) => r.pass) ? 0 : 1);
}

main().catch((e) => {
  console.error('smoke test 异常退出:', e);
  process.exit(1);
});

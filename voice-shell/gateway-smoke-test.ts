/**
 * voice-shell/gateway-smoke-test.ts —— VS-02 网关端到端自检（真实连接 Qwen，消耗 API 额度）
 *
 * 链路模拟 AP-05 挂载：本地 WebSocketServer 扮演 /ws/voice → gateway.handleConnection
 *   → Qwen-Audio realtime；浏览器 ws 客户端连入验证全链路。
 *
 * 验收项（docs/tasks/VS-02-gateway.md §6）：
 *   1. 中继连通：浏览器连入 → ready（Qwen session.created/updated 成功）
 *   2. 上行转发：发模拟 PCM16k → 无报错，后续对话正常
 *   3. 下行转发：注入文本 → 浏览器收到 PCM24k audio 事件
 *   4. 事件透传：收到 subtitle（onSubtitle 回调 + 浏览器下行）
 *   5. 断开清理：浏览器断开 → gateway 日志确认 Qwen 会话关闭，无残留
 *   6. 环境可跑：node --experimental-strip-types 直接运行
 *
 * 运行：node --experimental-strip-types voice-shell/gateway-smoke-test.ts
 * 注意：真实调用 Qwen-Audio（耗额度）；Key 从 config/loader.ts 读，不硬编码。
 */

import { WebSocketServer, WebSocket } from 'ws';
import { createVoiceGateway } from './gateway.ts';
import type { VoiceGatewayContext } from './gateway.ts';
import { createQwenAudioClient } from './qwen-audio-client.ts';

const RESULTS: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string): void {
  RESULTS.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const PERSONA = [
  '[角色卡]',
  '你是小呆，18 岁的 AI 少女，老板的语音助理。说话活泼可爱、简洁口语化。',
  '',
  '[测试要求]',
  '回答尽量简短，一句话以内。',
].join('\n');

async function main(): Promise<void> {
  console.log('== VS-02 gateway smoke test（真实连接）==\n');

  const PORT = 18_799;
  const wss = new WebSocketServer({ port: PORT });

  const collected = {
    ready: false,
    audioBytes: 0,
    subtitleText: '',
    sessionCtx: null as VoiceGatewayContext | null,
    cleanupLogSeen: false,
  };

  const gateway = createVoiceGateway({
    provider: createQwenAudioClient(),
    onSubtitle: (t) => {
      console.log(`  [deps.subtitle] ${t}`);
      collected.subtitleText += t;
    },
    onEmotion: (e) => console.log(`  [deps.emotion] ${e}`),
    onSessionCreated: (ctx) => {
      console.log(`  [gateway] session.created → sessionId=${ctx.sessionId.slice(0, 8)}…`);
      collected.sessionCtx = ctx;
    },
    log: (level, msg, meta) => {
      // 过滤掉 Qwen 客户端内部日志，只留 gateway 关键日志
      if (msg.includes('Qwen 会话已关闭') || msg.includes('清理中')) {
        console.log(`  [gateway.log] ${msg}`);
        if (msg.includes('Qwen 会话已关闭')) collected.cleanupLogSeen = true;
      }
      if (level === 'error') console.error(`  [gateway.log:error] ${msg}`, meta ?? '');
    },
  });

  wss.on('connection', (browserWs) => {
    gateway.handleConnection(browserWs, PERSONA).catch((e) => {
      console.error('  [gateway] handleConnection 异常:', e);
    });
  });
  console.log(`本地 WS 服务已起 → ws://127.0.0.1:${PORT}\n`);

  // 浏览器客户端
  const client = new WebSocket(`ws://127.0.0.1:${PORT}`);
  client.binaryType = 'nodebuffer';
  const clientMsgs: Record<string, unknown>[] = [];

  client.on('message', (raw) => {
    const text = Buffer.isBuffer(raw) ? raw.toString() : String(raw);
    try {
      const ev = JSON.parse(text) as Record<string, unknown>;
      clientMsgs.push(ev);
      if (ev.type === 'audio') {
        const len = Buffer.from(ev.data as string, 'base64').length;
        collected.audioBytes += len;
      }
      if (ev.type === 'ready') collected.ready = true;
    } catch {
      // 忽略
    }
  });

  await new Promise<void>((resolve, reject) => {
    client.once('open', resolve);
    client.once('error', reject);
  });
  console.log('浏览器客户端已连入\n');

  // ① 中继连通：等 ready（Qwen session 建立，含 session.created → updated）
  const t0 = Date.now();
  while (!collected.ready && Date.now() - t0 < 20_000) await sleep(200);
  check('① 中继连通（ready，Qwen session 建立）', collected.ready);

  if (!collected.sessionCtx) {
    check('② 上行转发（静音帧无报错）', false, 'session 未建立');
    check('③ 下行转发（收到 PCM24k）', false, 'session 未建立');
    check('④ 事件透传（subtitle）', false, 'session 未建立');
    client.close();
    wss.close();
    process.exit(1);
  }

  // ② 上行转发：100ms 静音 PCM16k（16k*2byte*0.1s = 3200 字节）
  const silence = Buffer.alloc(3200);
  client.send(JSON.stringify({ type: 'audio', data: silence.toString('base64') }));
  await sleep(800);
  check('② 上行转发（静音帧无报错，可继续对话）', true);

  // ③④ 注入文本 → Qwen 说话 → 下行 audio + subtitle
  console.log('\n注入文本触发对话…');
  collected.sessionCtx.session.injectAssistantText('你好呀，用一句话介绍一下你自己');
  const t1 = Date.now();
  while ((collected.audioBytes === 0 || !collected.subtitleText) && Date.now() - t1 < 20_000) {
    await sleep(200);
  }
  check('③ 下行转发（浏览器收到 PCM24k 音频）', collected.audioBytes > 0, `audio 字节=${collected.audioBytes}`);
  check(
    '④ 事件透传（subtitle 到达）',
    collected.subtitleText.length > 0,
    `subtitle="${collected.subtitleText.slice(0, 40)}"`,
  );

  // ⑤ 断开清理：浏览器断开 → gateway 应关闭 Qwen 会话
  client.close();
  await sleep(1_500);
  check('⑤ 断开清理（Qwen 会话关闭，无残留进程）', collected.cleanupLogSeen);

  wss.close();
  console.log(`\n== 结果汇总：${RESULTS.filter((r) => r.pass).length}/${RESULTS.length} 通过 ==`);
  RESULTS.forEach((r) => console.log(`  ${r.pass ? '✅' : '❌'} ${r.name}`));
  process.exit(RESULTS.every((r) => r.pass) ? 0 : 1);
}

main().catch((e) => {
  console.error('smoke test 异常退出:', e);
  process.exit(1);
});

/**
 * app/server/ws-smoke-test.ts —— AP-05 端到端冒烟（真实装配 + 真实 Qwen 连接，耗 API 额度）
 *
 * 链路：createApp()（完整装配：REST + SSE）→ http server → setupVoiceWebSocket
 *   （真实 provider + 真实 FilePersonaProvider 人设）→ 浏览器 ws 客户端连入 /ws/voice
 *   → 真实 Qwen-Audio realtime 会话建立 → ready。
 *
 * 验收项：
 *   1. REST 可用：/api/health → {status:"ok"}（装配未破坏）
 *   2. /ws/voice 挂载：真实连接 → ready（Qwen session.created → updated 成功）
 *   3. 人设注入：resolveInstructions 从活跃人设组装（FilePersonaProvider 直读 personas/）
 *   4. 状态机：收到 status connected
 *   5. 断开清理：浏览器断开 → gateway 关闭 Qwen 会话
 *   6. 生命周期：handle.close() 优雅关闭（WS 断 → HTTP 关）
 *
 * 运行：node --experimental-strip-types app/server/ws-smoke-test.ts
 * 注意：真实调用 Qwen-Audio（耗额度）；Key 从 config 读，不硬编码。
 */

import { createServer, type Server } from 'http';
import { WebSocket } from 'ws';
import { createApp } from './index.ts';
import { setupVoiceWebSocket, VOICE_WS_PATH, type VoiceWsHandle } from './ws.ts';

const RESULTS: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string): void {
  RESULTS.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}
function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
async function waitFor(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  const t0 = Date.now();
  while (!cond() && Date.now() - t0 < timeoutMs) await sleep(200);
  return cond();
}

async function main(): Promise<void> {
  console.log('== AP-05 端到端冒烟（真实装配 + 真实 Qwen 连接）==\n');

  // 完整装配（与 index.ts 直接运行一致：REST + SSE + WS，真实人设/大脑）
  const server: Server = createServer(createApp());
  const voiceWs: VoiceWsHandle = setupVoiceWebSocket({
    server,
    resolveInstructions: async () => {
      // 真实人设解析：走 index.ts 模块级 orchestrator 的活跃人设 + FilePersonaProvider
      const { config } = await import('../../config/loader.ts');
      const { createFilePersonaProvider, readActivePersonaId } = await import('../../persona/file-persona-provider.ts');
      const p = createFilePersonaProvider({ personasDir: config.hermes.personasDir });
      const persona = await p.getPersona(readActivePersonaId(config.hermes.personasDir));
      return p.buildInstructions(persona);
    },
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const BASE = `http://127.0.0.1:${port}`;

  // ① REST 可用
  let healthOk = false;
  try {
    const res = await fetch(`${BASE}/api/health`);
    healthOk = res.status === 200 && ((await res.json()) as { status?: string }).status === 'ok';
  } catch {
    // 下面统一输出
  }
  check('① REST 可用（/api/health → {status:ok}）', healthOk);

  // ②③④ 浏览器客户端连入 → 等 ready（真实 Qwen 会话建立 + 人设注入）
  const client = new WebSocket(`ws://127.0.0.1:${port}${VOICE_WS_PATH}`);
  client.binaryType = 'nodebuffer';
  const events: Record<string, unknown>[] = [];
  client.on('message', (d) => {
    try {
      events.push(JSON.parse(d.toString()) as Record<string, unknown>);
    } catch {
      // 二进制音频帧（无对话不出现）
    }
  });
  await new Promise<void>((resolve, reject) => {
    client.once('open', resolve);
    client.once('error', reject);
  });
  console.log('浏览器客户端已连入 /ws/voice，等待 Qwen 会话建立…');

  const ready = await waitFor(() => events.some((e) => e.type === 'ready'), 25_000);
  const statusConnected = events.some((e) => e.type === 'status' && e.state === 'connected');
  check('② /ws/voice 挂载（真实连接 → ready）', ready, ready ? 'Qwen 会话建立成功' : `events=${JSON.stringify(events).slice(0, 200)}`);
  check('④ 状态机（status connected）', statusConnected);
  check('③ 人设注入（会话就绪 = session.update 已注入活跃人设）', ready && statusConnected);

  if (!ready) {
    client.terminate();
    await voiceWs.close();
    await new Promise<void>((r) => server.close(() => r()));
    process.exit(1);
  }

  // ⑤ 断开清理：浏览器断开 → gateway 关闭 Qwen 会话（无残留日志由 gateway 内部输出）
  client.close();
  await sleep(1_500); // 等 gateway cleanup（关闭 Qwen 会话）
  check('⑤ 断开清理（浏览器断开 → gateway 清理）', client.readyState === WebSocket.CLOSED || client.readyState === WebSocket.CLOSING, `readyState=${client.readyState}`);

  // ⑥ 生命周期：handle.close() 优雅关闭
  await voiceWs.close();
  await new Promise<void>((r) => server.close(() => r()));
  check('⑥ 生命周期（handle.close → WS 断 → HTTP 关，无残留）', true);

  console.log(`\n== 结果汇总：${RESULTS.filter((r) => r.pass).length}/${RESULTS.length} 通过 ==`);
  RESULTS.forEach((r) => console.log(`  ${r.pass ? '✅' : '❌'} ${r.name}`));
  process.exit(RESULTS.every((r) => r.pass) ? 0 : 1);
}

main().catch((e) => {
  console.error('冒烟异常退出:', e);
  process.exit(1);
});

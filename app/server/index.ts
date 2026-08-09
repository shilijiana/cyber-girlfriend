/**
 * app/server/index.ts —— Express 装配（AP-01 骨架 + AP-02 Orchestrator 接入）
 *
 * 职责：中间件、REST 路由挂载、SSE 骨架、条件 listen（测试友好）。
 * AP-02 变更：装配 Core Orchestrator（注入默认占位人设 + brainRunner），
 *   并传给 createApiRouter 实现 /api/chat 完整链路。
 *
 * 模块边界：仅应用壳，不直接 import persona/brain 实现（通过 orchestrator 注入）。
 */
import express from 'express';
import type { Express } from 'express';
import { config, maskKey } from '../../config/loader.ts';
import { createApiRouter } from './routes.ts';
import { createOrchestrator } from './orchestrator.ts';
import {
  createFilePersonaProvider,
  readActivePersonaId,
} from '../../persona/file-persona-provider.ts';
import { brainRunner } from '../../brain/hermes-runner.ts';

export function createApp(): Express {
  const app = express();

  // 中间件
  app.use(express.json());

  // 编排层装配：PS-03 文件化人设（读 personas/ 目录，active.txt 持久化切换）
  // 设计依据：docs/research/hermes-capabilities-review.md §3.1 / §3.7
  const personaProvider = createFilePersonaProvider({
    personasDir: config.hermes.personasDir,
  });
  const orchestrator = createOrchestrator({
    personaProvider,
    brainRunner,
    defaultPersonaId: readActivePersonaId(config.hermes.personasDir), // 重启后沿用 active.txt
  });

  // REST API（/api 前缀）
  app.use('/api', createApiRouter(config, orchestrator));

  // SSE 骨架：/api/events 事件通道（AP-02 Orchestrator 后续在此推送状态/字幕/情绪）
  setupSse(app);

  return app;
}

/**
 * SSE 骨架：单客户端事件流 + 心跳防代理超时 + close 清理。
 * 供后续 Orchestrator 推送 {type:'brain'|'subtitle'|'emotion'} 等事件。
 */
function setupSse(app: Express): void {
  app.get('/api/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // 首帧：告知客户端连接就绪
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    // 心跳注释行，避免空闲连接被代理/网关断开
    const heartbeat = setInterval(() => {
      res.write(`: heartbeat\n\n`);
    }, 15_000);

    req.on('close', () => clearInterval(heartbeat));
  });
}

export const app = createApp();

// 仅直接运行时启动（集成测试 import app 时不占端口）
const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('index.ts') || process.argv[1].endsWith('index.js'));

if (isDirectRun) {
  const { port, host } = config.server;
  app.listen(port, host, () => {
    console.log(`[app] 赛博女友 API 已启动 → http://${host}:${port}`);
    console.log(
      `[app] voice: ${config.dashscope.model} | dashscope key: ${maskKey(config.dashscope.apiKey)}`,
    );
    console.log(`[app] SSE 通道: /api/events | REST: /api/*`);
  });
}

export default app;

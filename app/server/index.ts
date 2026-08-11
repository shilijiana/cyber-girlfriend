/**
 * app/server/index.ts —— Express 装配（AP-01 骨架 + AP-02 Orchestrator 接入 + AP-05 WS 挂载）
 *
 * 职责：中间件、REST 路由挂载、SSE 骨架、WS /ws/voice 挂载、条件 listen（测试友好）。
 * AP-02 变更：装配 Core Orchestrator（注入默认占位人设 + brainRunner），
 *   并传给 createApiRouter 实现 /api/chat 完整链路。
 * AP-05 变更：启动改用 http.createServer(app)（WS 共享同一端口），
 *   setupVoiceWebSocket 挂载 /ws/voice（gateway 由 VS-02 提供，本层负责挂载与生命周期），
 *   增加 SIGINT/SIGTERM 优雅关闭（先断 WS → 再关 HTTP）。
 *   personaProvider/orchestrator 提升为模块级单例：REST（createApiRouter）与 WS
 *   （resolveInstructions）共享同一人设状态，切换人设两端一致。
 *
 * CC-01 整改：
 *   - M3：shutdown 防重入（SIGINT+SIGTERM 快速连续触发只关一次）
 *   - L1：isDirectRun 改用 import.meta.url 比对（原 process.argv[1].endsWith 脆弱）
 *   - L2：setTimeout(...).unref() 移除多余可选链（Node 22 必有 unref）
 *   - L3：personaProvider/orchestrator 改懒加载 getter（import 不触发文件 IO，测试友好）
 *   - L4：预热走完整链路（persona instructions + brain），非仅 brain
 *
 * 模块边界：仅应用壳，不直接 import persona/brain 实现（通过 orchestrator 注入）。
 */
import express from 'express';
import type { Express } from 'express';
import { createServer } from 'http';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config, maskKey } from '../../config/loader.ts';
import { createApiRouter } from './routes.ts';
import { createOrchestrator } from './orchestrator.ts';
import { setupVoiceWebSocket } from './ws.ts';
import {
  createFilePersonaProvider,
  readActivePersonaId,
} from '../../persona/file-persona-provider.ts';
import { brainRunner } from '../../brain/hermes-runner.ts';
import { qwenFallbackRunner } from '../../brain/qwen-fallback.ts';
import type { PersonaProvider } from '../../persona/provider.ts';
import type { CoreOrchestrator } from './orchestrator.ts';

// L3：单例懒加载（import 模块不触发文件 IO；首次真正调用才读 personas 目录/active.txt）
let personaProvider: PersonaProvider | null = null;
function getPersonaProvider(): PersonaProvider {
  personaProvider ??= createFilePersonaProvider({
    personasDir: config.hermes.personasDir,
  });
  return personaProvider;
}
let orchestrator: CoreOrchestrator | null = null;
function getOrchestrator(): CoreOrchestrator {
  orchestrator ??= createOrchestrator({
    personaProvider: getPersonaProvider(),
    brainRunner,
    fallbackRunner: qwenFallbackRunner, // M5-02：Hermes 不可用 → 降级纯 Qwen 文本对话
    defaultPersonaId: readActivePersonaId(config.hermes.personasDir), // 重启后沿用 active.txt
  });
  return orchestrator;
}

/**
 * Hermes 冷启动预热（启动即调用，避免用户首次对话等待）。
 * 原理：Hermes 是每次 spawn 新进程的 one-shot 模型（BR-01），首次调用含
 *   Python 启动 + 模型加载 + 工具注册的固定冷启动成本（实测 12~23s）。
 *   本预热在服务 listen 后立即后台触发一次轻量调用，让后续用户请求
 *   复用系统级缓存（模块加载/依赖导入），显著缩短首次对话等待。
 * 设计：
 *   - 异步 fire-and-forget：不阻塞服务启动与 listen 回调
 *   - L4：走完整链路（persona instructions + brain），预热效果等同真实请求
 *   - 轻量指令（无副作用），失败静默（Hermes 不可用时自动走 qwen-fallback，不影响服务）
 */
async function prewarmHermes(): Promise<void> {
  const started = Date.now();
  console.log('[app] Hermes 冷启动预热中…（首次对话免等待）');
  try {
    // L4：先取人设 instructions（完整链路预热），再跑 brain
    const instructions = await resolveInstructions();
    const r = await brainRunner.run({
      instruction: '你好，这是一次启动预热测试，无需执行任何操作，回复"预热完成"即可。',
      context: instructions,
      timeoutMs: 90_000, // 预热给足时间（冷启动 12~23s，留裕量）
    });
    if (r.ok) {
      console.log(`[app] Hermes 预热完成（${Date.now() - started}ms）`);
    } else {
      console.warn(`[app] Hermes 预热未完成（${Date.now() - started}ms）: ${r.error ?? '未知'}`);
    }
  } catch (e) {
    // 预热失败不阻塞服务：Hermes 不可用时 orchestrator 自动降级纯 Qwen
    console.warn(`[app] Hermes 预热失败（不影响服务，将自动降级）: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** 解析当前活跃人设的 Qwen instructions（WS 连接建立时调用，契约 §2.4） */
async function resolveInstructions(): Promise<string> {
  const persona = await getPersonaProvider().getPersona(getOrchestrator().getActivePersonaId());
  return getPersonaProvider().buildInstructions(persona);
}

export function createApp(): Express {
  const app = express();

  // 中间件
  app.use(express.json());

  // 数字人素材静态服务（/avatars → config.avatar.assetsPath）
  // 前端 <video> 通过 /avatars/clips/*.mp4 访问素材，避免 Vite dev server 只服务 client/ 的限制
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const avatarAssetsDir = resolve(projectRoot, config.avatar.assetsPath);
  console.log('[app] avatar 静态服务:', avatarAssetsDir);
  app.use('/avatars', express.static(avatarAssetsDir));

  // REST API（/api 前缀）
  app.use('/api', createApiRouter(config, getOrchestrator()));

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

// L3：不直接导出单例 app（避免 import 时构建触发文件 IO）；提供 getApp() 按需构建
export function getApp(): Express {
  return createApp();
}

// L1：仅直接运行时启动（集成测试 import 不占端口）——
// 用 import.meta.url 与 process.argv[1] 比对（原 endsWith('index.ts') 脆弱：
// 若其他目录也有 index.ts 会被误判）
const isDirectRun =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  const { port, host } = config.server;
  const app = getApp();

  // AP-05：HTTP 与 WS 共享同一端口（http server 承载 Express 与 /ws/voice 升级）
  const server = createServer(app);
  const voiceWs = setupVoiceWebSocket({
    server,
    resolveInstructions,
  });

  // M3：关闭防重入——SIGINT+SIGTERM 快速连续触发时只执行一次优雅关闭
  let shuttingDown = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('[app] 收到关闭信号，正在优雅关闭…');
    voiceWs
      .close()
      .catch(() => undefined)
      .finally(() => {
        server.close(() => process.exit(0));
        // L2：Node 22 的 Timeout 必有 unref，去掉多余可选链
        setTimeout(() => process.exit(0), 4_000).unref();
      });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  server.listen(port, host, () => {
    console.log(`[app] 赛博女友 API 已启动 → http://${host}:${port}`);
    console.log(
      `[app] voice: ${config.dashscope.model} | dashscope key: ${maskKey(config.dashscope.apiKey)}`,
    );
    console.log(`[app] SSE 通道: /api/events | REST: /api/* | WS 语音: /ws/voice`);

    // Hermes 冷启动预热：listen 后立即后台触发，首次对话免等待（失败静默降级）
    void prewarmHermes();
  });
}

export default getApp;

/**
 * app/server/routes.ts —— REST API 路由（AP-01 骨架）
 *
 * 接口契约：docs/architecture/module-contracts.md §2.1（client ↔ app/server）
 * 仅做应用壳：不依赖 persona/brain/voice-shell/avatar 的实现。
 *
 * @param config 来自 config/loader.ts 的 AppConfig，供 AP-03 实现 chat/brain/avatar 时使用
 */
import { Router } from 'express';
import type { AppConfig } from '../../config/loader';

export function createApiRouter(config: AppConfig): Router {
  const router = Router();

  // GET /api/health —— 健康检查（AP-01 验收点）
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // POST /api/chat —— 文本聊天（占位，AP-02/AP-03 实现）
  router.post('/chat', (_req, res) => {
    res.status(501).json({ error: 'AP-03 待实现' });
  });

  // GET /api/brain/status —— Hermes 可用性探测（占位，AP-03 实现）
  router.get('/brain/status', (_req, res) => {
    res.status(501).json({ available: false, error: 'AP-03 待实现' });
  });

  // GET /api/avatar/status —— 数字人引擎状态（占位，AP-03 实现）
  router.get('/avatar/status', (_req, res) => {
    res.status(501).json({ engine: 'none', clipCount: 0, error: 'AP-03 待实现' });
  });

  return router;
}

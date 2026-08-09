/**
 * app/server/routes.ts —— REST API 路由（AP-01 骨架 + AP-02/AP-03 实现）
 *
 * 接口契约：docs/architecture/module-contracts.md §2.1（client ↔ app/server）
 *
 * AP-03 实现：
 *   · POST /api/chat          → Core Orchestrator（§2.7）：persona 取 instructions → brain 执行 → 返回
 *                              响应 {reply, personaId, ok, durationMs}（契约 v1.2）
 *   · GET  /api/brain/status  → 探测 Hermes（`binPath --version`，5s 超时），{available, version}
 *   · GET  /api/avatar/status → 读素材清单 manifest.json，{engine, clipCount}
 *
 * 错误语义（契约 §3.3）：编排层异常 → 4xx/5xx；brain 业务失败（ok:false）→ HTTP 200 友好降级提示。
 * 依赖方向：app/server → orchestrator（内部）/ brain / avatar，禁止反向。
 * 红线：无持久化；密钥走 config（本文件只用 server/avatar 路径配置，无密钥）。
 */
import { Router } from 'express';
import { spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import type { AppConfig } from '../../config/loader.ts';
import type { CoreOrchestrator, ChatRequest } from './orchestrator.ts';

/** GET /api/brain/status 响应（契约 §2.1：{available, version}） */
export interface BrainStatus {
  available: boolean;
  version: string;
}

/** GET /api/avatar/status 响应（契约 §2.1：{engine, clipCount}） */
export interface AvatarStatus {
  engine: string;
  clipCount: number;
}

const PROBE_TIMEOUT_MS = 5_000; // Hermes 探测超时（--version 应毫秒级返回）
const MAX_PROBE_BYTES = 4_096;  // 版本输出上限，防异常刷屏

/**
 * 探测 Hermes 可用性：spawn `binPath --version`，短超时。
 * 退出码 0 且有输出 = 可用；超时 / spawn 失败 / 无输出 = 不可用。
 * 注：探测逻辑自持在应用壳（BR-03 未指派，不越权写 brain 模块）。
 */
export function probeHermes(binPath: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<BrainStatus> {
  return new Promise<BrainStatus>((resolveProbe) => {
    const child = spawn(binPath, ['--version'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let settled = false;

    child.stdout.on('data', (d: Buffer) => {
      if (out.length < MAX_PROBE_BYTES) out += d.toString('utf-8');
    });

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      resolveProbe({ available: false, version: '' });
    }, timeoutMs);

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const version = out.trim();
      resolveProbe({ available: code === 0 && version.length > 0, version });
    });

    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveProbe({ available: false, version: '' });
    });
  });
}

/**
 * 读取数字人素材状态：加载素材清单 manifest.json（约定路径 config.avatar.assetsPath/manifest.json，
 * 结构与 ClipLibrary 一致 {clips: Clip[]}；AV-02 定稿后以该任务为准）。
 * manifest 缺失 / 解析失败 → clipCount 0（前端据此降级），engine 固定当前方案 'clip'。
 */
export function loadAvatarStatus(config: AppConfig): AvatarStatus {
  const manifestPath = resolve(process.cwd(), config.avatar.assetsPath, 'manifest.json');
  try {
    if (existsSync(manifestPath)) {
      const lib = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { clips?: unknown[] };
      return { engine: 'clip', clipCount: Array.isArray(lib.clips) ? lib.clips.length : 0 };
    }
  } catch {
    // manifest 损坏按无素材处理，不阻塞接口（降级路径由前端负责）
  }
  return { engine: 'clip', clipCount: 0 };
}

/** 校验 REST 请求体中的 message 字段，返回 trim 后的消息或 null */
function parseMessage(body: unknown): string | null {
  const message = (body as { message?: unknown } | undefined)?.message;
  if (typeof message !== 'string' || message.trim().length === 0) return null;
  return message.trim();
}

export function createApiRouter(config: AppConfig, orchestrator: CoreOrchestrator): Router {
  const router = Router();

  // GET /api/health —— 健康检查（AP-01 验收点）
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // GET /api/personas —— 人设列表 + 当前活跃（PS-03）
  router.get('/personas', async (_req, res) => {
    try {
      const personas = await orchestrator.listPersonas();
      res.json({ personas, active: orchestrator.getActivePersonaId() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : '人设列表读取失败';
      res.status(500).json({ error: msg });
    }
  });

  // POST /api/persona/switch —— 切换活跃人设（PS-03：写 active.txt，毫秒级，重启保持）
  router.post('/persona/switch', async (req, res) => {
    const id = (req.body as { id?: unknown } | undefined)?.id;
    if (typeof id !== 'string' || id.trim().length === 0) {
      res.status(400).json({ error: 'id 必填（非空字符串）' });
      return;
    }
    const result = await orchestrator.switchPersona(id.trim());
    if (!result.ok) {
      res.status(400).json({ error: result.error ?? '切换失败' });
      return;
    }
    res.json({ ok: true, persona: result.persona });
  });

  // POST /api/chat —— 文本聊天（调试/降级，契约 §2.1 → §2.7 Core Orchestrator 完整链路）
  router.post('/chat', async (req, res) => {
    const message = parseMessage(req.body);
    if (!message) {
      res.status(400).json({ error: 'message 必填（非空字符串）' });
      return;
    }

    const chatReq: ChatRequest = { message };
    const personaId = (req.body as { personaId?: unknown } | undefined)?.personaId;
    if (typeof personaId === 'string' && personaId.trim().length > 0) {
      chatReq.personaId = personaId.trim();
    }

    try {
      const result = await orchestrator.chat(chatReq);
      // 契约 v1.2：brain 业务失败（ok:false）走 HTTP 200，reply 为友好降级提示
      res.json({
        reply: result.reply,
        personaId: result.personaId,
        ok: result.ok,
        durationMs: result.durationMs,
      });
    } catch (err) {
      // 编排层异常（如 persona 不存在）→ 契约 §3.3 转 4xx/5xx
      const msg = err instanceof Error ? err.message : '聊天编排失败';
      const status = msg.includes('人设不存在') ? 400 : 500;
      res.status(status).json({ error: msg });
    }
  });

  // GET /api/brain/status —— Hermes 可用性探测（契约 §2.1）
  router.get('/brain/status', async (_req, res) => {
    res.json(await probeHermes(config.hermes.binPath));
  });

  // GET /api/avatar/status —— 数字人引擎状态（契约 §2.1）
  router.get('/avatar/status', (_req, res) => {
    res.json(loadAvatarStatus(config));
  });

  return router;
}

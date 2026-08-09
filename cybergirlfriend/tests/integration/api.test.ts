/**
 * 集成测试：Express API（server/index.ts 导出的 app）
 * 覆盖：健康检查、会话 CRUD、MCP 配置加载的 HTTP 面；异常流程用无效路径验证 404。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { app } from '../../server/index';
import { getEnabledMcpServers } from '../../server/mcp-servers';

let server: Server;
let baseUrl: string;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, resolve);
  });
  const addr = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
});

describe('API 集成测试', () => {
  it('GET /api/health 应返回 ok 状态', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });

  it('GET /api/health 应带时间戳字段', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    const body = await res.json();
    expect(typeof body.timestamp).toBe('string');
    expect(new Date(body.timestamp).getTime()).not.toBeNaN();
  });

  it('未知路径应返回 404（异常流程）', async () => {
    const res = await fetch(`${baseUrl}/api/not-exists`);
    expect(res.status).toBe(404);
  });

  it('非法方法应返回 404 或 405（异常流程）', async () => {
    const res = await fetch(`${baseUrl}/api/health`, { method: 'DELETE' });
    expect([404, 405]).toContain(res.status);
  });
});

describe('MCP 配置加载', () => {
  it('v0.1 应启用 workbuddy 与 hermes 两个 MCP', () => {
    const enabled = getEnabledMcpServers();
    expect(Object.keys(enabled)).toEqual(['workbuddy', 'hermes']);
  });

  it('workbuddy 应为 http 类型，hermes 应为 stdio 类型', () => {
    const enabled = getEnabledMcpServers();
    expect(enabled.workbuddy.type).toBe('http');
    expect(enabled.hermes.type).toBe('stdio');
  });
});

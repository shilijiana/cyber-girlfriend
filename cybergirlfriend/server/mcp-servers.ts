/**
 * MCP 服务器配置（DESIGN §6）
 * v0.1 启用：workbuddy（HTTP）+ hermes（stdio）
 * v0.2 预留：vscode / codex（与 SDK 自身能力重叠，延后接入）
 * 实际命令/参数以各官方文档最终确认为准
 */

export interface McpServerConfig {
  type: 'stdio' | 'http' | 'sse';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export const mcpServers: Record<string, McpServerConfig> = {
  // Work Buddy：平台能力走 HTTP endpoint（v0.1 启用）
  workbuddy: {
    type: 'http',
    url: process.env.WORKBUDDY_MCP_URL ?? '',
    headers: {
      Authorization: `Bearer ${process.env.WORKBUDDY_MCP_TOKEN ?? ''}`,
    },
  },
  // Hermes agent（NousResearch）：本地 stdio（v0.1 启用）
  hermes: {
    type: 'stdio',
    command: process.env.HERMES_BIN ?? 'hermes',
    args: ['mcp'], // 以 Hermes 官方 MCP 模式文档为准
  },
  // VSCODE：v0.2 启用（与 SDK 自身文件/终端能力重叠，延后）
  // vscode: {
  //   type: 'stdio',
  //   command: 'npx',
  //   args: ['-y', 'vscode-mcp-server'],
  // },
  // CODEX：v0.2 启用（依赖 OpenAI 账号，延后）
  // codex: {
  //   type: 'stdio',
  //   command: process.env.CODEX_BIN ?? 'codex',
  //   args: ['mcp'],
  // },
};

/** 已启用（非空配置）的 MCP 列表 */
export function getEnabledMcpServers(): Record<string, McpServerConfig> {
  return Object.fromEntries(
    Object.entries(mcpServers).filter(([, cfg]) => {
      if (cfg.type === 'http') return Boolean(cfg.url);
      if (cfg.type === 'stdio') return Boolean(cfg.command);
      return Boolean(cfg.url);
    })
  );
}

/**
 * 测试环境预置：在测试用例加载前注入环境变量，保证 MCP 配置可测
 */
process.env.WORKBUDDY_MCP_URL = process.env.WORKBUDDY_MCP_URL ?? 'http://localhost:9999/mcp';
process.env.WORKBUDDY_MCP_TOKEN = process.env.WORKBUDDY_MCP_TOKEN ?? 'test-token';
process.env.HERMES_BIN = process.env.HERMES_BIN ?? 'hermes';

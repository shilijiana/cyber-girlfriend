/**
 * 配置加载器
 * 优先级：config/apikeys.json 文件 > 环境变量 > 默认值
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

export interface AppConfig {
  dashscope: {
    apiKey: string;
    workspaceId: string;
    region: string;
    model: string;
  };
  hermes: {
    binPath: string;
    modelProvider: string;
    apiKey: string;
    baseUrl: string;
  };
  server: {
    port: number;
    host: string;
  };
  avatar: {
    assetsPath: string;
  };
}

const CONFIG_PATH = resolve(process.cwd(), 'config', 'apikeys.json');

export function loadConfig(): AppConfig {
  if (existsSync(CONFIG_PATH)) {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const fileConfig = JSON.parse(raw) as Partial<AppConfig>;
    return mergeWithEnv(fileConfig);
  }
  return mergeWithEnv({});
}

function mergeWithEnv(file: Partial<AppConfig>): AppConfig {
  return {
    dashscope: {
      apiKey: file.dashscope?.apiKey || process.env.DASHSCOPE_API_KEY || '',
      workspaceId: file.dashscope?.workspaceId || process.env.DASHSCOPE_WORKSPACE_ID || '',
      region: file.dashscope?.region || 'cn-beijing',
      model: file.dashscope?.model || 'qwen-audio-3.0-realtime-flash',
    },
    hermes: {
      binPath: file.hermes?.binPath || process.env.HERMES_BIN || 'hermes',
      modelProvider: file.hermes?.modelProvider || process.env.HERMES_MODEL_PROVIDER || 'deepseek',
      apiKey: file.hermes?.apiKey || process.env.HERMES_API_KEY || '',
      baseUrl: file.hermes?.baseUrl || process.env.HERMES_BASE_URL || '',
    },
    server: {
      port: file.server?.port || Number(process.env.PORT) || 3000,
      host: file.server?.host || process.env.HOST || 'localhost',
    },
    avatar: {
      assetsPath: file.avatar?.assetsPath || 'assets/avatars',
    },
  };
}

export const config = loadConfig();

/** 脱敏显示密钥（日志用） */
export function maskKey(key: string): string {
  if (!key || key.length <= 12) return '****';
  return key.slice(0, 8) + '****' + key.slice(-4);
}

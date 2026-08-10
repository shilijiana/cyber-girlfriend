/**
 * 配置加载器（AP-06：环境变量管理）
 * 优先级：config/apikeys.json 文件 > 系统环境变量 > .env.local > .env > 默认值
 *
 * .env 说明（零依赖自实现，ADR-007 轻量化）：
 * - 位置：项目根目录 .env（基准）/ .env.local（本地覆盖，不进 git）
 * - 格式：KEY=VALUE，支持 # 注释、空行、export 前缀、单双引号
 * - 语义：.env.local 覆盖 .env；两者都不覆盖已存在的系统环境变量
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';

// M4：配置文件路径基于项目根目录推导（import.meta.url），不再依赖 process.cwd() 启动目录——
// 从任意子目录启动都能找到 config/apikeys.json 与 .env（审查 CC-01 M4）
const MODULE_DIR = dirname(fileURLToPath(import.meta.url)); // <root>/config
const PROJECT_ROOT = resolve(MODULE_DIR, '..'); // 项目根目录

const CONFIG_PATH = resolve(PROJECT_ROOT, 'config', 'apikeys.json');
const DOTENV_PATHS = ['.env', '.env.local'].map((f) => resolve(PROJECT_ROOT, f));

// M5：personas 目录默认值不再硬编码 Windows 用户路径，用 os.homedir() 动态构建（跨平台）
const DEFAULT_PERSONAS_DIR = resolve(
  homedir(),
  'AppData',
  'Local',
  'hermes',
  'profiles',
  'cyber-girlfriend',
  'personas',
);

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
    /** 专用 profile 名(记忆隔离,见 hermes-capabilities-review §3.2) */
    profile: string;
    /** personas 根目录(人设数据权威源,见 §3.7) */
    personasDir: string;
    /** 工具集白名单(不含 memory,写隔离硬约束) */
    toolsets: string;
  };
  server: {
    port: number;
    host: string;
  };
  avatar: {
    assetsPath: string;
  };
}

/**
 * 解析 .env 文本（轻量实现，覆盖常用语法）
 * 支持：KEY=VALUE、# 注释行、空行、export 前缀、单双引号值、值尾行内注释（" #"）
 */
export function parseDotEnv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const body = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = body.indexOf('=');
    if (eq <= 0) continue; // 缺 = 或 key 为空，跳过
    const key = body.slice(0, eq).trim();
    let value = body.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    if (key) out[key] = value;
  }
  return out;
}

/**
 * 加载 .env / .env.local 到 process.env（仅填充未设置的键）
 * - .env.local 覆盖 .env（本地个性化）
 * - 系统环境变量优先：已存在的键不覆盖（dotenv 惯例）
 * - 文件缺失时静默跳过
 */
export function loadEnvFile(): void {
  const merged: Record<string, string> = {};
  for (const p of DOTENV_PATHS) {
    if (!existsSync(p)) continue;
    const parsed = parseDotEnv(readFileSync(p, 'utf-8'));
    for (const [k, v] of Object.entries(parsed)) merged[k] = v;
  }
  for (const [k, v] of Object.entries(merged)) {
    if (process.env[k] === undefined) process.env[k] = v;
  }
}

export function loadConfig(): AppConfig {
  loadEnvFile(); // AP-06：先注入 .env，再走文件 > 环境变量 > 默认值
  if (existsSync(CONFIG_PATH)) {
    const raw = readFileSync(CONFIG_PATH, 'utf-8');
    const fileConfig = JSON.parse(raw) as Partial<AppConfig>;
    return mergeWithEnv(fileConfig);
  }
  return mergeWithEnv({});
}

function mergeWithEnv(file: Partial<AppConfig>): AppConfig {
  // H2：全部 `||` 改 `??`（仅对 null/undefined 回退，不吞掉 "" / 0 / false 等显式 falsy 值）——
  // 用户显式置空 baseUrl 等字段以禁用自定义端点时，`||` 会错误回退到默认值
  return {
    dashscope: {
      apiKey: file.dashscope?.apiKey ?? process.env.DASHSCOPE_API_KEY ?? '',
      workspaceId: file.dashscope?.workspaceId ?? process.env.DASHSCOPE_WORKSPACE_ID ?? '',
      region: file.dashscope?.region ?? process.env.DASHSCOPE_REGION ?? 'cn-beijing',
      model:
        file.dashscope?.model ??
        process.env.DASHSCOPE_MODEL ??
        'qwen-audio-3.0-realtime-flash',
    },
    hermes: {
      binPath: file.hermes?.binPath ?? process.env.HERMES_BIN ?? 'hermes',
      modelProvider: file.hermes?.modelProvider ?? process.env.HERMES_MODEL_PROVIDER ?? 'deepseek',
      apiKey: file.hermes?.apiKey ?? process.env.HERMES_API_KEY ?? '',
      baseUrl: file.hermes?.baseUrl ?? process.env.HERMES_BASE_URL ?? '',
      profile: file.hermes?.profile ?? process.env.HERMES_PROFILE ?? 'cyber-girlfriend',
      personasDir: file.hermes?.personasDir ?? process.env.HERMES_PERSONAS_DIR ?? DEFAULT_PERSONAS_DIR,
      toolsets: file.hermes?.toolsets ?? process.env.HERMES_TOOLSETS ?? 'terminal,file,web',
    },
    server: {
      // port 保留 `||`：Number(env) 可能解析为 NaN（falsy），需要回退默认 3000
      port: file.server?.port || Number(process.env.PORT) || 3000,
      host: file.server?.host ?? process.env.HOST ?? 'localhost',
    },
    avatar: {
      assetsPath: file.avatar?.assetsPath ?? 'assets/avatars',
    },
  };
}

export const config = loadConfig();

/** 脱敏显示密钥（日志用） */
export function maskKey(key: string): string {
  if (!key || key.length <= 12) return '****';
  return key.slice(0, 8) + '****' + key.slice(-4);
}

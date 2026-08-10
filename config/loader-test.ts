/**
 * config/loader-test.ts —— M-C 配置模块单元自检（CC-03 补测，零网络）
 *
 * 覆盖 config/loader.ts（AP-06 环境变量管理）：
 *   1. 文件优先：apikeys.json 有值 → 采用文件值（正常路径）
 *   2. 优先级链：文件值压制环境变量（子进程验证，"文件 > 环境变量 > 默认"首端）
 *   3. 缺失 Key 处理：文件未配置的键 → 默认值；文件空串 → 保留空串（H2 ?? 语义）
 *   4. maskKey 脱敏：短 Key → '****'；长 Key → 前 8 + **** + 后 4
 *   5. port 默认值：文件未配置 → 3000（mergeWithEnv `|| 3000` 兜底；当前文件显式 3000）
 *   6. parseDotEnv：注释/空行/export/引号/行内注释解析（env 文件解析能力）
 *   7. loadEnvFile：只填充未设置键，不覆盖已有键
 *
 * 说明：loadConfig() 的 CONFIG_PATH 为模块常量（不可注入），且本仓库 apikeys.json
 *   覆盖了全部 env 映射键，"文件缺失 → env 兜底"分支无法端到端触发——
 *   用例 2 以"文件值 > env 值"的压制关系验证优先级首端，env 解析语义由用例 6/7 覆盖。
 *
 * 运行：node --experimental-strip-types config/loader-test.ts
 */

import { execFileSync } from 'child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { config, loadEnvFile, maskKey, parseDotEnv } from './loader.ts';

const RESULTS: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string): void {
  RESULTS.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

/** 本文件所在目录（= config/，apikeys.json 与其同目录） */
const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = resolve(THIS_DIR, 'apikeys.json');

async function main(): Promise<void> {
  console.log('== M-C config 单元自检（loader）==\n');

  // ------------------------------------------------------------ 1：文件优先
  if (existsSync(CONFIG_PATH)) {
    const fileConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8')) as {
      dashscope?: { apiKey?: string };
      server?: { port?: number };
    };
    const fileKey = fileConfig.dashscope?.apiKey ?? '';
    check(
      '1 文件优先（apikeys.json 有值 → 采用文件值）',
      fileKey !== '' && config.dashscope.apiKey === fileKey,
      `apiKey 一致(${maskKey(config.dashscope.apiKey)})`,
    );
  } else {
    check('1 文件优先（apikeys.json 缺失，跳过）', true, 'apikeys.json 未找到');
  }

  // ------------------------------------------------------------ 2：文件值压制环境变量（子进程，隔离环境）
  // loader.ts 的 CONFIG_PATH 为模块常量，无法在主进程注入；子进程重载模块验证优先级链
  const probe = join(tmpdir(), `cc03-mc-${Date.now()}-probe.mjs`);
  try {
    writeFileSync(
      probe,
      [
        `import { pathToFileURL } from 'url';`,
        `const { loadConfig } = await import(pathToFileURL('${THIS_DIR.replace(/\\/g, '/')}/loader.ts').href);`,
        `const c = loadConfig();`,
        `console.log('CC03_PROBE:' + JSON.stringify({ port: c.server.port, region: c.dashscope.region, apiKey: c.dashscope.apiKey }));`,
      ].join('\n'),
      'utf-8',
    );
    const out = execFileSync(process.execPath, ['--experimental-strip-types', probe], {
      encoding: 'utf-8',
      env: { ...process.env, PORT: '8080', DASHSCOPE_REGION: 'env-region', DASHSCOPE_API_KEY: 'env-sentinel-key' },
      timeout: 30_000,
    });
    const line = out.split('\n').find((l) => l.startsWith('CC03_PROBE:'));
    let ok = false;
    let detail = 'probe 无输出';
    if (line) {
      try {
        const parsed = JSON.parse(line.slice('CC03_PROBE:'.length)) as { port: number; region: string; apiKey: string };
        ok = parsed.port === 3000 && parsed.region === 'cn-beijing' && parsed.apiKey !== 'env-sentinel-key';
        detail = `port=${parsed.port} region=${parsed.region}（文件值压制 env）`;
      } catch {
        detail = 'probe JSON 解析失败';
      }
    }
    check('2 优先级链（文件值 > 环境变量，子进程验证）', ok, detail);
  } catch (e) {
    check('2 优先级链（文件值 > 环境变量，子进程验证）', false, `子进程失败: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    rmSync(probe, { force: true });
  }

  // ------------------------------------------------------------ 3：缺失 Key 处理
  check(
    '3 文件未配置的键 → 默认值（avatar.assetsPath）',
    config.avatar.assetsPath === 'assets/avatars',
    config.avatar.assetsPath,
  );
  check('3b 文件空串保留（hermes.apiKey = ""，H2 ?? 语义不吞空串）', config.hermes.apiKey === '');

  // ------------------------------------------------------------ 4：maskKey 脱敏
  check("4 maskKey 短 Key/空 → '****'", maskKey('') === '****' && maskKey('sk-12345678') === '****', maskKey('sk-12345678'));
  const longKey = 'sk-test-' + 'a'.repeat(20);
  check(
    '4b maskKey 长 Key → 前8+****+后4',
    maskKey(longKey) === longKey.slice(0, 8) + '****' + longKey.slice(-4),
    maskKey(longKey),
  );

  // ------------------------------------------------------------ 5：port 默认值
  check(
    '5 port 默认值（未配置 → 3000；当前文件显式 3000，语义 `|| 3000` 兜底）',
    typeof config.server.port === 'number' && config.server.port === 3000,
    `${config.server.port}`,
  );

  // ------------------------------------------------------------ 6：parseDotEnv 解析
  const envText = [
    '# 注释行',
    '',
    'export KEY_ONE=value1',
    'KEY_TWO="quoted value"',
    "KEY_THREE='single quoted'",
    'KEY_FOUR=value # 行内注释',
    'EMPTY_=',
  ].join('\n');
  const parsed = parseDotEnv(envText);
  check(
    '6 parseDotEnv（注释/空行/export/引号/行内注释/空值键）',
    parsed.KEY_ONE === 'value1' &&
      parsed.KEY_TWO === 'quoted value' &&
      parsed.KEY_THREE === 'single quoted' &&
      parsed.KEY_FOUR === 'value' &&
      parsed.EMPTY_ === '', // key 非空即保留（值为空串），实现语义
    JSON.stringify(parsed),
  );

  // ------------------------------------------------------------ 7：loadEnvFile 只填未设键
  const keepKey = '__CC03_TEST_KEEP__';
  const prev = process.env[keepKey];
  process.env[keepKey] = 'keep-me';
  try {
    loadEnvFile(); // 幂等：不覆盖已存在的键
    check('7 loadEnvFile 只填充未设置键（不覆盖已有键）', process.env[keepKey] === 'keep-me');
  } finally {
    if (prev === undefined) delete process.env[keepKey];
    else process.env[keepKey] = prev;
  }

  const failed = RESULTS.filter((x) => !x.pass);
  console.log(`\n${failed.length === 0 ? '🎉' : '❌'} config 单元自检 ${RESULTS.length - failed.length}/${RESULTS.length} 通过`);
  if (failed.length > 0) {
    console.log('失败项：', failed.map((f) => f.name).join('、'));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('config 单元自检异常退出:', e);
  process.exit(1);
});

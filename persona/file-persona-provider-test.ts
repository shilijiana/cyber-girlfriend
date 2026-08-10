/**
 * persona/file-persona-provider-test.ts —— M-P 人设模块单元自检（CC-03 补测，零网络）
 *
 * 覆盖 FilePersonaProvider（PS-03 定稿实现）：
 *   1. listPersonas 返回注册表全部角色（正常路径）
 *   2. getPersona 加载 card → instructions 含角色卡/收尾指令（正常路径）
 *   3. buildInstructions 透传 Hermes 预组装指令（拼接语义）
 *   4. 路径越界防护：personaId 含 ../ 或分隔符 → 拒绝（异常输入）
 *   5. 缺失文件兜底：id 不在注册表 → PersonaNotFoundError；注册表有 id 但 card.md 缺失 → 报错
 *   6. 毫秒级读取：getPersona 耗时 < 100ms（性能）
 *
 * 数据源策略：
 *   - 优先使用真实人设目录（Hermes cyber-girlfriend profile 的 personas/，resolve 规范化——
 *     CC-03 DEF-A-02 同因：正斜杠配置在 Windows 下 H6 startsWith 校验会误拦截）；
 *   - 真实目录不可用时构造临时目录兜底（自包含、可重复）。
 *
 * 运行：node --experimental-strip-types persona/file-persona-provider-test.ts
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { createFilePersonaProvider, readActivePersonaId } from './file-persona-provider.ts';
import { PersonaNotFoundError, type Persona, type PersonaInfo } from './provider.ts';

const RESULTS: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string): void {
  RESULTS.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

/** 真实人设目录（config/loader.ts 默认值，resolve 规范化） */
const REAL_PERSONAS_DIR = resolve(
  process.env.HOME ?? process.env.USERPROFILE ?? '',
  'AppData/Local/hermes/profiles/cyber-girlfriend/personas',
);
const REAL_DIR_EXISTS = existsSync(REAL_PERSONAS_DIR);

/**
 * 构造临时人设目录（真实目录不可用时的兜底数据源）。
 * 返回目录路径；调用方负责 rmSync 清理。
 */
function buildTempPersonasDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cc03-mp-'));
  writeFileSync(
    join(dir, 'personas.json'),
    JSON.stringify({
      version: 1,
      personas: [
        { id: 'xiaodai', name: '小呆', description: '测试人设' },
        { id: 'zhixin-jiejie', name: '知心姐姐', description: '测试人设2' },
      ],
    }),
    'utf-8',
  );
  writeFileSync(join(dir, 'active.txt'), 'xiaodai', 'utf-8');
  mkdirSync(join(dir, 'xiaodai'));
  writeFileSync(join(dir, 'xiaodai', 'card.md'), '你是小呆，18 岁元气 AI 少女（临时目录测试卡）。', 'utf-8');
  writeFileSync(join(dir, 'xiaodai', 'memory.md'), '- [2026-08-11] 测试记忆。', 'utf-8');
  return dir;
}

/** 取可用 personasDir：真实存在 → 真实；否则临时目录（自包含兜底） */
function resolveTestPersonasDir(): { dir: string; isTemp: boolean } {
  if (REAL_DIR_EXISTS) return { dir: REAL_PERSONAS_DIR, isTemp: false };
  console.log('⚠️ 真实人设目录不存在，改用临时目录兜底（自包含模式）');
  return { dir: buildTempPersonasDir(), isTemp: true };
}

async function main(): Promise<void> {
  console.log('== M-P persona 单元自检（FilePersonaProvider）==\n');
  const { dir, isTemp } = resolveTestPersonasDir();
  const p = createFilePersonaProvider({ personasDir: dir });

  try {
    // ------------------------------------------------------------ 1：listPersonas
    const list: PersonaInfo[] = await p.listPersonas();
    const ids = list.map((x) => x.id);
    check('1 listPersonas 返回注册表全部角色', list.length >= 2 && ids.includes('xiaodai'), `ids=${ids.join(',')}`);
    check('1b 列表项含 name/description', list.every((x) => typeof x.name === 'string' && x.name.length > 0 && typeof x.description === 'string'));

    // ------------------------------------------------------------ 2：getPersona 加载 card
    const persona: Persona = await p.getPersona('xiaodai');
    check(
      '2 getPersona 加载 card（instructions 含角色卡/收尾）',
      persona.instructions.includes('[角色卡]') &&
        persona.instructions.includes('[收尾]') &&
        persona.instructions.includes('小呆'),
      `instructions ${persona.instructions.length} 字符`,
    );

    // ------------------------------------------------------------ 3：buildInstructions 拼接
    check(
      '3 buildInstructions 透传 Hermes 预组装指令（拼接语义）',
      p.buildInstructions(persona) === persona.instructions && p.buildInstructions(persona).length > 0,
    );

    // ------------------------------------------------------------ 4：路径越界防护
    let rejectOk = false;
    try {
      await p.getPersona('../x');
    } catch {
      rejectOk = true;
    }
    check('4 路径越界防护：../x 拒绝', rejectOk);
    rejectOk = false;
    try {
      await p.getPersona('a/b');
    } catch {
      rejectOk = true;
    }
    check('4b 路径越界防护：含分隔符 id 拒绝', rejectOk);

    // ------------------------------------------------------------ 5：缺失文件兜底
    let notFoundOk = false;
    try {
      await p.getPersona('ghost-not-exist');
    } catch (e) {
      notFoundOk = e instanceof PersonaNotFoundError;
    }
    check('5 id 不在注册表 → PersonaNotFoundError（带 400 状态码）', notFoundOk);

    // 注册表有 id 但 card.md 缺失 → 抛"角色卡缺失"（临时目录构造，不污染真实数据）
    const ghostDir = mkdtempSync(join(tmpdir(), 'cc03-mp-ghost-'));
    try {
      writeFileSync(
        join(ghostDir, 'personas.json'),
        JSON.stringify({ version: 1, personas: [{ id: 'ghost', name: '幽灵', description: '无卡人设' }] }),
        'utf-8',
      );
      const pg = createFilePersonaProvider({ personasDir: ghostDir });
      let cardMissing = false;
      try {
        await pg.getPersona('ghost');
      } catch (e) {
        cardMissing = e instanceof Error && e.message.includes('角色卡缺失');
      }
      check('5b 注册表有 id 但 card.md 缺失 → 报错（不静默返回空指令）', cardMissing);
    } finally {
      rmSync(ghostDir, { recursive: true, force: true });
    }

    // ------------------------------------------------------------ 6：毫秒级读取（性能）
    const t0 = Date.now();
    await p.getPersona('xiaodai'); // 预热（模块级缓存）
    const t1 = Date.now();
    const rounds = 5;
    let worst = 0;
    for (let i = 0; i < rounds; i += 1) {
      const s = Date.now();
      await p.getPersona('xiaodai');
      worst = Math.max(worst, Date.now() - s);
    }
    check('6 毫秒级读取（最坏耗时 < 100ms）', worst < 100, `${worst}ms（预热 ${t1 - t0}ms）`);
  } finally {
    if (isTemp) rmSync(dir, { recursive: true, force: true }); // 仅清理自建临时目录
  }

  const failed = RESULTS.filter((x) => !x.pass);
  console.log(`\n${failed.length === 0 ? '🎉' : '❌'} persona 单元自检 ${RESULTS.length - failed.length}/${RESULTS.length} 通过`);
  if (failed.length > 0) {
    console.log('失败项：', failed.map((f) => f.name).join('、'));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('persona 单元自检异常退出:', e);
  process.exit(1);
});

/**
 * persona/file-persona-provider.ts —— FilePersonaProvider(PS-03 定稿实现)
 *
 * 2026-08-09 老板拍板:人设数据文件化,存 Hermes 专用 profile home:
 *   <profile-home>/personas/{personas.json, active.txt, <id>/card.md, <id>/memory.md}
 * 赛博女友直接 fs.readFile 读文件(毫秒级);写 memory.md 走 Hermes 指令(file 工具)。
 *
 * 契约对齐:docs/architecture/module-contracts.md §2.4(v1.2)PersonaProvider
 * 设计依据:docs/research/hermes-capabilities-review.md §3.1 / §3.7
 * 替换:PS-02 HermesPersonaProvider(LLM 临场编 JSON:延迟 17s+、切换不持久、人设漂移,已废弃并删除)
 *
 * 模块边界:persona 模块正式实现;零第三方运行时依赖(仅 node:fs/path,ADR-007)。
 * CC-01 整改:
 *   - M10:运行期文件 I/O 全部改异步(fs/promises),不再阻塞事件循环
 *   - M11:readRegistry JSON.parse 错误包装,统一错误前缀(不泄漏内部路径)
 *   - M12:readActivePersonaId 缺省改"注册表第一个 id"(兑现注释承诺),兜底共享常量
 *   - H6:buildClosingInstruction 过滤换行符(防路径注入);getPersona 路径 startsWith 二次校验
 */
import { readFile, writeFile } from 'fs/promises';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import {
  DEFAULT_PERSONA_ID,
  PersonaNotFoundError,
  type Persona,
  type PersonaInfo,
  type PersonaProvider,
} from './provider.ts';

export interface FilePersonaProviderDeps {
  /** personas 根目录(含 personas.json / active.txt / <id>/) */
  personasDir: string;
}

/** 注册表文件结构(与 personas/personas.json 一致) */
interface PersonaRegistryEntry {
  id: string;
  name: string;
  description: string;
  cardFile?: string;
  memoryFile?: string;
  voiceId?: string;
  emotion?: string;
}

interface PersonaRegistry {
  version?: number;
  personas: PersonaRegistryEntry[];
}

/** 人设 id 合法性(防目录穿越) */
const ID_PATTERN = /^[a-z0-9-]+$/;

/** H6：指令文本 sanitize——过滤换行/回车等控制字符，防路径含特殊字符被利用做提示注入 */
function sanitizePathForInstruction(p: string): string {
  return p.replace(/[\n\r\t]/g, ' ');
}

/**
 * 收尾指令模板:驱动 Hermes 写入人设记忆区。
 * 使用绝对路径,防 cwd 漂移导致写错位置。
 * H6:路径先 sanitize(过滤换行/制表符),防注入;memoryFilePath 由调用方保证在 personasDir 内。
 */
export function buildClosingInstruction(id: string, memoryFilePath: string): string {
  const safePath = sanitizePathForInstruction(memoryFilePath);
  return (
    `若对话中出现值得该人设记住的新事实,调用文件工具追加到 ${safePath} 的「近期对话」区` +
    `(格式: - [日期] 内容);若「近期对话」超过 20 条或文件超过 3KB,把旧条目压缩为「长期记忆」摘要。` +
    `不要写入其他任何记忆系统。`
  );
}

/**
 * 读取当前活跃人设 id(独立函数,供装配层初始化 orchestrator 用)。
 * M12:active.txt 缺失/非法时,回退读注册表第一个 id(兑现注释承诺),注册表也失败再兜底共享常量。
 * 注:本函数仅启动装配时调用一次(同步语义),运行期走类内异步方法,不阻塞事件循环。
 */
export function readActivePersonaId(personasDir: string): string {
  try {
    const activePath = resolve(personasDir, 'active.txt');
    if (existsSync(activePath)) {
      const id = readFileSyncSafe(activePath);
      if (id && ID_PATTERN.test(id)) return id;
    }
    // M12:注册表第一个 id 兜底
    const registryPath = resolve(personasDir, 'personas.json');
    if (existsSync(registryPath)) {
      const raw = readFileSyncSafe(registryPath);
      const parsed = JSON.parse(raw) as Partial<PersonaRegistry>;
      if (Array.isArray(parsed.personas) && parsed.personas.length > 0) {
        const first = parsed.personas[0]?.id;
        if (typeof first === 'string' && ID_PATTERN.test(first)) return first;
      }
    }
  } catch {
    // 读取失败按缺省处理
  }
  return DEFAULT_PERSONA_ID;
}

/** 同步读文本(仅 readActivePersonaId 启动装配使用;运行期一律用 fs/promises) */
function readFileSyncSafe(p: string): string {
  return readFileSync(p, 'utf-8');
}

class FilePersonaProviderImpl implements PersonaProvider {
  private readonly personasDir: string;

  constructor(deps: FilePersonaProviderDeps) {
    this.personasDir = deps.personasDir;
  }

  /** M11:异步读注册表;JSON.parse 失败统一包装错误(不泄漏内部文件路径细节) */
  private async readRegistry(): Promise<PersonaRegistry> {
    let raw: string;
    try {
      raw = await readFile(resolve(this.personasDir, 'personas.json'), 'utf-8');
    } catch (e) {
      throw new Error(`人设注册表读取失败:${e instanceof Error ? e.message : String(e)}`);
    }
    let parsed: Partial<PersonaRegistry>;
    try {
      parsed = JSON.parse(raw) as Partial<PersonaRegistry>;
    } catch {
      throw new Error('人设注册表解析失败:personas.json 不是合法 JSON');
    }
    if (!Array.isArray(parsed.personas)) {
      throw new Error('人设注册表格式错误:缺少 personas 数组');
    }
    return { version: parsed.version, personas: parsed.personas };
  }

  /** 校验 id 并返回其目录绝对路径(防目录穿越 + H6 二次校验) */
  private resolveIdDir(id: string): string {
    if (!ID_PATTERN.test(id)) throw new Error(`非法人设 id:${id}`);
    const dir = resolve(this.personasDir, id);
    // H6:路径二次校验——解析结果必须以 personasDir 开头(防 ../ 穿越绕过正则)
    if (!dir.startsWith(this.personasDir)) {
      throw new Error(`非法人设 id:${id}(路径越界)`);
    }
    return dir;
  }

  async listPersonas(): Promise<PersonaInfo[]> {
    const registry = await this.readRegistry();
    return registry.personas.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
    }));
  }

  async getPersona(id: string): Promise<Persona> {
    const meta = (await this.readRegistry()).personas.find((p) => p.id === id);
    if (!meta) throw new PersonaNotFoundError(`人设不存在:${id}`); // M1：带状态码业务错误

    const dir = this.resolveIdDir(id);
    const cardPath = resolve(dir, 'card.md');
    const memoryPath = resolve(dir, 'memory.md');
    if (!existsSync(cardPath)) throw new Error(`人设角色卡缺失:${cardPath}`);

    const card = await readFile(cardPath, 'utf-8');
    const memory = existsSync(memoryPath) ? await readFile(memoryPath, 'utf-8') : '';

    // instructions = 角色卡 + 记忆区 + 收尾指令(驱动 Hermes 沉淀记忆到 memory.md)
    const instructions = [
      '[角色卡]',
      card.trim(),
      '',
      '[人设记忆]',
      memory.trim(),
      '',
      '[收尾]',
      buildClosingInstruction(id, memoryPath),
    ].join('\n');

    return {
      id,
      name: meta.name,
      instructions,
      ...(meta.voiceId || meta.emotion
        ? {
            voiceConfig: {
              ...(meta.voiceId ? { voiceId: meta.voiceId } : {}),
              ...(meta.emotion ? { emotion: meta.emotion } : {}),
            },
          }
        : {}),
    };
  }

  /** Hermes 已预组装 instructions,此处透传(契约 §2.4 语义) */
  buildInstructions(persona: Persona): string {
    return persona.instructions;
  }

  async switchPersona(id: string): Promise<void> {
    const registry = await this.readRegistry();
    if (!registry.personas.some((p) => p.id === id)) {
      throw new PersonaNotFoundError(`人设不存在:${id}`); // M1：带状态码业务错误
    }
    this.resolveIdDir(id); // 校验合法性
    await writeFile(resolve(this.personasDir, 'active.txt'), id, 'utf-8');
  }

  /** 当前活跃人设 id(读 active.txt,缺省注册表第一个) */
  getActivePersonaId(): string {
    return readActivePersonaId(this.personasDir);
  }
}

/** 创建文件化人设 Provider(装配处注入 createOrchestrator) */
export function createFilePersonaProvider(deps: FilePersonaProviderDeps): PersonaProvider {
  return new FilePersonaProviderImpl(deps);
}

export default createFilePersonaProvider;

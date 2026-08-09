/**
 * persona/file-persona-provider.ts —— FilePersonaProvider(PS-03 定稿实现)
 *
 * 2026-08-09 老板拍板:人设数据文件化,存 Hermes 专用 profile home:
 *   <profile-home>/personas/{personas.json, active.txt, <id>/card.md, <id>/memory.md}
 * 赛博女友直接 fs.readFile 读文件(毫秒级);写 memory.md 走 Hermes 指令(file 工具)。
 *
 * 契约对齐:docs/architecture/module-contracts.md §2.4(v1.2)PersonaProvider
 * 设计依据:docs/research/hermes-capabilities-review.md §3.1 / §3.7
 * 替换:PS-02 HermesPersonaProvider(LLM 临场编 JSON:延迟 17s+、切换不持久、人设漂移,已弃用)
 *
 * 模块边界:persona 模块正式实现;零运行时依赖(仅 node:fs/path,ADR-007)。
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { Persona, PersonaInfo, PersonaProvider } from './provider.ts';

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

/**
 * 收尾指令模板:驱动 Hermes 写入人设记忆区。
 * 使用绝对路径,防 cwd 漂移导致写错位置。
 */
export function buildClosingInstruction(id: string, memoryFilePath: string): string {
  return (
    `若对话中出现值得该人设记住的新事实,调用文件工具追加到 ${memoryFilePath} 的「近期对话」区` +
    `(格式: - [日期] 内容);若「近期对话」超过 20 条或文件超过 3KB,把旧条目压缩为「长期记忆」摘要。` +
    `不要写入其他任何记忆系统。`
  );
}

/** 读取当前活跃人设 id(独立函数,供装配层初始化 orchestrator 用) */
export function readActivePersonaId(personasDir: string): string {
  const activePath = resolve(personasDir, 'active.txt');
  try {
    if (existsSync(activePath)) {
      const id = readFileSync(activePath, 'utf-8').trim();
      if (id && ID_PATTERN.test(id)) return id;
    }
  } catch {
    // 读取失败按缺省处理
  }
  return 'xiaodai';
}

class FilePersonaProviderImpl implements PersonaProvider {
  private readonly personasDir: string;

  constructor(deps: FilePersonaProviderDeps) {
    this.personasDir = deps.personasDir;
  }

  private readRegistry(): PersonaRegistry {
    const raw = readFileSync(resolve(this.personasDir, 'personas.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PersonaRegistry>;
    if (!Array.isArray(parsed.personas)) {
      throw new Error('personas.json 格式错误:缺少 personas 数组');
    }
    return { version: parsed.version, personas: parsed.personas };
  }

  /** 校验 id 并返回其目录绝对路径(防目录穿越) */
  private resolveIdDir(id: string): string {
    if (!ID_PATTERN.test(id)) throw new Error(`非法人设 id:${id}`);
    return resolve(this.personasDir, id);
  }

  async listPersonas(): Promise<PersonaInfo[]> {
    return this.readRegistry().personas.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
    }));
  }

  async getPersona(id: string): Promise<Persona> {
    const meta = this.readRegistry().personas.find((p) => p.id === id);
    if (!meta) throw new Error(`人设不存在:${id}`);

    const dir = this.resolveIdDir(id);
    const cardPath = resolve(dir, 'card.md');
    const memoryPath = resolve(dir, 'memory.md');
    if (!existsSync(cardPath)) throw new Error(`人设角色卡缺失:${cardPath}`);

    const card = readFileSync(cardPath, 'utf-8');
    const memory = existsSync(memoryPath) ? readFileSync(memoryPath, 'utf-8') : '';

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
    const registry = this.readRegistry();
    if (!registry.personas.some((p) => p.id === id)) {
      throw new Error(`人设不存在:${id}`);
    }
    this.resolveIdDir(id); // 校验合法性
    writeFileSync(resolve(this.personasDir, 'active.txt'), id, 'utf-8');
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

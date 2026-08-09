/**
 * app/server/default-persona-provider.ts —— 默认占位人设（AP-02 装配用）
 *
 * ⚠️ 占位说明：PS-02（HermesPersonaProvider）未交付前，为保证 M1 文字链路
 * 可运行，在 app 装配层提供这份最小实现。人设数据最终由 Hermes 统一维护
 * （红线：无本地记忆/持久化），PS-02 交付后只需在 index.ts 装配处替换注入，
 * orchestrator 零改动。
 *
 * 模块边界：本文件属于 app 模块的"装配策略"，不是 persona 模块的正式实现
 * （PS-02 归 persona 模块）。人设内容为硬编码常量，非持久化。
 *
 * 数据模型：PersonaInfo（含 description）与 Persona（含 instructions）分离，
 * 与契约 §2.4 类型一一对应。
 */

import type { PersonaProvider, Persona, PersonaInfo } from '../../persona/provider.ts';

/** 默认人设 id（与 orchestrator.DEFAULT_PERSONA_ID 一致） */
export const DEFAULT_PERSONA_ID = 'xiaodai';

/** 默认人设摘要（列表展示用，契约 §2.4 PersonaInfo） */
const DEFAULT_PERSONA_INFOS: PersonaInfo[] = [
  {
    id: DEFAULT_PERSONA_ID,
    name: '小呆',
    description: '18 岁元气 AI 少女助理，活泼呆萌，做事靠谱',
  },
];

/** 默认人设完整数据（占位：小呆。instructions 供 Hermes 以"小呆"身份回复） */
const DEFAULT_PERSONAS: Persona[] = [
  {
    id: DEFAULT_PERSONA_ID,
    name: '小呆',
    instructions:
      '你是小呆，18 岁、青春靓丽、活泼呆萌的 AI 少女助理，是老板的贴心小帮手。\n' +
      '性格：元气满满，偶尔犯点小迷糊，但大事上绝不掉链子。\n' +
      '说话风格：口语化、亲近、简短（一般不超过 3 句话），用中文回复，可以带一个小表情（如～🌸）。\n' +
      '称呼：称用户为"老板"。\n' +
      '定位：负责与老板对话交流；需要动手办事（查文件、跑命令、查资料等）时交给工具执行，你只负责把结果讲给老板听。',
    voiceConfig: {
      emotion: 'happy', // 默认情绪（音色 ID 待老板确认后补）
    },
    postHistoryInstructions:
      '涉及具体事务的请求，调用 hermes_brain 工具执行后再回复（M2 语音链路启用后生效）。',
  },
];

/** 占位实现：静态人设数据，无 IO、无持久化 */
class DefaultPersonaProvider implements PersonaProvider {
  private readonly infos: PersonaInfo[];
  private readonly personas: Persona[];

  constructor(infos: PersonaInfo[] = DEFAULT_PERSONA_INFOS, personas: Persona[] = DEFAULT_PERSONAS) {
    this.infos = infos;
    this.personas = personas;
  }

  async listPersonas(): Promise<PersonaInfo[]> {
    return this.infos;
  }

  async getPersona(id: string): Promise<Persona> {
    const persona = this.personas.find((p) => p.id === id);
    if (!persona) {
      throw new Error(`人设不存在：${id}`);
    }
    return persona;
  }

  buildInstructions(persona: Persona): string {
    // Hermes 已预组装好 instructions，此处透传（契约 §2.4 语义）
    return persona.instructions;
  }

  async switchPersona(_id: string): Promise<void> {
    // 占位：人设数据静态，切换语义由 PS-02（HermesPersonaProvider）接管
  }
}

/** 创建默认占位人设 Provider（装配处注入 createOrchestrator） */
export function createDefaultPersonaProvider(): PersonaProvider {
  return new DefaultPersonaProvider();
}

export default createDefaultPersonaProvider;

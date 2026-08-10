/**
 * persona/provider.ts —— PersonaProvider 抽象接口（PS-01）
 *
 * 职责：定义人设接入的统一抽象。人设数据归 Hermes 统一维护，
 * 赛博女友侧不存角色卡、不做持久化，只保留接口、类型与切换方式。
 *
 * 契约对齐：docs/architecture/module-contracts.md §2.4（v1.2）
 * 实现规划：FilePersonaProvider（PS-03 定稿，读 Hermes 写的人设文件，已交付）
 * 预留实现：HttpPersonaProvider（MCP serve 常驻）
 *
 * 模块边界：纯类型定义 + 类型守卫 + 共享常量，零第三方运行时依赖（ADR-007）。
 */

/** 默认活跃人设 id（L7：共享常量，orchestrator 与 file-persona-provider 统一引用，防重复定义漂移） */
export const DEFAULT_PERSONA_ID = 'xiaodai';

/**
 * M1：人设类业务错误——携带 HTTP 状态码（400），REST 层据 statusCode 转码，
 * 不再依赖错误消息字符串匹配（审查 CC-01 M1：消息措辞变更即失效）。
 * 其他运行期错误（注册表损坏/角色卡缺失等）保持普通 Error → REST 层转 500。
 */
export class PersonaNotFoundError extends Error {
  /** 固定 400：人设不存在属客户端请求错误 */
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'PersonaNotFoundError';
  }
}

/** 人设摘要信息（列表展示用，不携带完整 instructions） */
export interface PersonaInfo {
  id: string;
  name: string;
  description: string;
}

/** 完整人设（instructions 由 Hermes 预组装，此处只透传） */
export interface Persona {
  id: string;
  name: string;
  /** Hermes 预组装好的 instructions 文本（Qwen 人设注入用） */
  instructions: string;
  /** 语音配置（可选）：Qwen-Audio 音色 / 默认情绪 */
  voiceConfig?: {
    /** Qwen-Audio 音色 ID */
    voiceId?: string;
    /** 默认情绪（如 happy/calm/sad） */
    emotion?: string;
  };
  /** 对话后指令（function_call 引导，如"调用 hermes_brain 工具"） */
  postHistoryInstructions?: string;
}

/** 人设接入抽象：赛博女友与 Hermes 人设系统之间的唯一契约 */
export interface PersonaProvider {
  /** 获取可用人设列表 */
  listPersonas(): Promise<PersonaInfo[]>;
  /** 加载指定人设（含 Hermes 预组装的 instructions） */
  getPersona(id: string): Promise<Persona>;
  /** 人设 → Qwen instructions 文本（Hermes 已预组装，此处只做透传/格式化） */
  buildInstructions(persona: Persona): string;
  /** 切换当前活跃人设 */
  switchPersona(id: string): Promise<void>;
}

/**
 * 类型守卫：校验对象是否为 PersonaInfo（供解析 Hermes 返回 JSON 使用）
 * 只校验必要字段，宽容可选字段。
 * L17：id/name/description 追加非空校验（空字符串字段无展示意义，应视为非法）
 */
export function isPersonaInfo(v: unknown): v is PersonaInfo {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    o.id.length > 0 &&
    typeof o.name === 'string' &&
    o.name.length > 0 &&
    typeof o.description === 'string'
  );
}

/**
 * 类型守卫：校验对象是否为 Persona（供 PS-02 解析 Hermes 返回 JSON 使用）
 */
export function isPersona(v: unknown): v is Persona {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.id !== 'string' || typeof o.name !== 'string') return false;
  if (typeof o.instructions !== 'string') return false;
  // voiceConfig / postHistoryInstructions 为可选，宽松校验
  if (o.voiceConfig !== undefined && (typeof o.voiceConfig !== 'object' || o.voiceConfig === null)) {
    return false;
  }
  if (
    o.postHistoryInstructions !== undefined &&
    typeof o.postHistoryInstructions !== 'string'
  ) {
    return false;
  }
  return true;
}

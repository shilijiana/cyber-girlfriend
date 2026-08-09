/**
 * persona/hermes-persona-provider.ts —— HermesPersonaProvider 实现（PS-02）
 *
 * 职责：通过 `hermes -z` 子进程（BR-01 runHermes）向 Hermes 发指令，
 *   获取人设列表 / 加载人设 / 切换人设。人设数据由 Hermes 记忆系统维护，
 *   赛博女友侧零角色卡、零持久化（红线 1）。
 *
 * 契约对齐：docs/architecture/module-contracts.md §2.4（v1.2）PersonaProvider
 * 依赖：PS-01（persona/provider.ts 接口 + 类型守卫）、BR-01（brain/hermes-runner.ts）
 *
 * 实现要点：
 *   - 指令协议：向 Hermes 发"只输出 JSON"的固定指令，解析其 stdout
 *   - 解析容错：容忍 Markdown 代码块（```json）、前后缀文字，提取首个 JSON
 *   - 类型守卫：用 isPersonaInfo / isPersona 校验 Hermes 返回
 *   - voiceConfig 归一化：Hermes 返回 {provider, speaker, emotion, ...} →
 *     契约字段 {voiceId: speaker, emotion}
 *   - 错误语义（契约 §3.3）：方法失败统一抛错，由 app 层转 4xx/5xx
 *   - 依赖最小化：仅复用 brain 的 runner + 本模块类型，零新增依赖（红线 5）
 */

import type { Persona, PersonaInfo, PersonaProvider } from './provider.ts';
import { isPersona, isPersonaInfo } from './provider.ts';
import type { BrainRunner } from '../brain/hermes-runner.ts';
import { runHermes } from '../brain/hermes-runner.ts';

/** 人设查询超时（ms）：Hermes 冷启动 + 记忆检索，60s 足够，避免拖慢编排层 */
const DEFAULT_PERSONA_TIMEOUT_MS = 60_000;

/** HermesPersonaProvider 构造依赖（可注入 runner 便于测试） */
export interface HermesPersonaProviderDeps {
  /** Hermes 执行器，默认 BR-01 runHermes（子进程 hermes -z） */
  runner?: BrainRunner;
  /** 人设查询超时，默认 60s */
  timeoutMs?: number;
}

/**
 * 从 Hermes 输出中提取首个 JSON 值（对象或数组）。
 * 容错：去除 ```json 代码块标记、前后缀解释文字。
 * 提取失败抛错（契约 §3.3：统一抛错，由编排层转错误响应）。
 */
export function extractJson(text: string): unknown {
  // 1) 去掉 ```json ... ``` 代码块围栏
  let body = text.trim();
  const fence = body.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) body = fence[1].trim();

  // 2) 定位首个 { 或 [ 与配对的结束位置（取最后一个 } 或 ]）
  const openIdx = body.search(/[{[]/);
  if (openIdx === -1) {
    throw new Error(`Hermes 输出中未找到 JSON：${body.slice(0, 120)}`);
  }
  const endIdx = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  if (endIdx <= openIdx) {
    throw new Error(`Hermes 输出 JSON 不完整：${body.slice(0, 120)}`);
  }
  const jsonText = body.slice(openIdx, endIdx + 1);
  try {
    return JSON.parse(jsonText);
  } catch (e) {
    throw new Error(`Hermes 输出 JSON 解析失败：${(e as Error).message}`);
  }
}

/**
 * 归一化 Hermes 返回的 voiceConfig 到契约字段。
 * Hermes 人设数据可能形如 {provider:'doubao', speaker:'zh_female_...', emotion:'...', language, speed}，
 * 契约 §2.4 只消费 {voiceId, emotion}，故 speaker → voiceId 映射，其余字段丢弃。
 */
function normalizeVoiceConfig(raw: unknown): Persona['voiceConfig'] {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const o = raw as Record<string, unknown>;
  const voiceId = typeof o.voiceId === 'string' ? o.voiceId : typeof o.speaker === 'string' ? o.speaker : undefined;
  const emotion = typeof o.emotion === 'string' ? o.emotion : undefined;
  if (!voiceId && !emotion) return undefined;
  return {
    ...(voiceId ? { voiceId } : {}),
    ...(emotion ? { emotion } : {}),
  };
}

/** Hermes 人设 Provider 实现（不对外暴露类，统一走工厂函数） */
class HermesPersonaProviderImpl implements PersonaProvider {
  private readonly runner: BrainRunner;
  private readonly timeoutMs: number;

  constructor(deps: HermesPersonaProviderDeps = {}) {
    this.runner = deps.runner ?? { run: runHermes };
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_PERSONA_TIMEOUT_MS;
  }

  /** 列表指令：要求 Hermes 只输出 JSON 数组 */
  private async listFromHermes(): Promise<PersonaInfo[]> {
    const instruction = [
      '你维护着若干"人设"（personas）数据，每个人设含 id（字符串标识）、name（中文名）、description（一句话介绍）。',
      '请列出你当前已知的全部人设。',
      '只输出一个 JSON 数组，不要输出任何解释、Markdown 代码块或多余文字。',
      '格式示例：[{"id":"xiaodai","name":"小呆","description":"18岁元气AI少女助理"}]',
      '如果不知道任何人设，输出空数组 []。',
    ].join('');

    const res = await this.runner.run({ instruction, timeoutMs: this.timeoutMs });
    if (!res.ok) {
      throw new Error(`Hermes 人设查询失败：${res.error ?? '未知错误'}`);
    }
    const parsed = extractJson(res.output);
    if (!Array.isArray(parsed)) {
      throw new Error(`Hermes 人设列表格式错误：期望 JSON 数组，收到 ${typeof parsed}`);
    }
    // 宽松：过滤非法项，至少保留合法人设；全非法视为空列表
    return parsed.filter(isPersonaInfo);
  }

  async listPersonas(): Promise<PersonaInfo[]> {
    return this.listFromHermes();
  }

  async getPersona(id: string): Promise<Persona> {
    const instruction = [
      `请加载人设，id 为 "${id}"。人设数据结构：`,
      'id（字符串）、name（中文名）、instructions（该人设的系统指令文本，必填）、',
      'voiceConfig（可选对象，含 voiceId 音色ID、emotion 默认情绪）、',
      'postHistoryInstructions（可选字符串，对话后指令）。',
      '只输出一个 JSON 对象，不要输出任何解释、Markdown 代码块或多余文字。',
      '如果不存在该人设，只输出 {"error":"not_found"}。',
    ].join('');

    const res = await this.runner.run({ instruction, timeoutMs: this.timeoutMs });
    if (!res.ok) {
      throw new Error(`Hermes 人设加载失败：${res.error ?? '未知错误'}`);
    }
    const parsed = extractJson(res.output);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error(`Hermes 人设格式错误：期望 JSON 对象，收到 ${typeof parsed}`);
    }
    const obj = parsed as Record<string, unknown>;
    if (obj.error === 'not_found') {
      throw new Error(`人设不存在：${id}`);
    }
    if (!isPersona(obj)) {
      throw new Error(`Hermes 人设字段缺失或不合法：${JSON.stringify(obj).slice(0, 200)}`);
    }
    // 归一化 voiceConfig 后返回，保持契约字段纯净
    return {
      id: obj.id,
      name: obj.name,
      instructions: obj.instructions,
      ...(obj.postHistoryInstructions !== undefined
        ? { postHistoryInstructions: obj.postHistoryInstructions }
        : {}),
      ...(normalizeVoiceConfig(obj.voiceConfig)
        ? { voiceConfig: normalizeVoiceConfig(obj.voiceConfig) }
        : {}),
    };
  }

  /** Hermes 已预组装 instructions，此处透传（契约 §2.4 语义） */
  buildInstructions(persona: Persona): string {
    return persona.instructions;
  }

  async switchPersona(id: string): Promise<void> {
    const instruction = [
      `请将当前活跃人设切换为 id 为 "${id}" 的人设，并记住这个切换。`,
      '如果存在该人设，只输出 {"ok":true}；如果不存在，只输出 {"ok":false,"error":"not_found"}。',
      '不要输出任何解释、Markdown 代码块或多余文字。',
    ].join('');

    const res = await this.runner.run({ instruction, timeoutMs: this.timeoutMs });
    if (!res.ok) {
      throw new Error(`Hermes 人设切换失败：${res.error ?? '未知错误'}`);
    }
    const parsed = extractJson(res.output) as { ok?: unknown; error?: unknown };
    if (parsed?.ok !== true) {
      const reason = parsed?.error === 'not_found' ? `人设不存在：${id}` : 'Hermes 未确认切换';
      throw new Error(`Hermes 人设切换失败：${reason}`);
    }
  }
}

/** 创建 Hermes 人设 Provider（装配处注入 createOrchestrator） */
export function createHermesPersonaProvider(
  deps: HermesPersonaProviderDeps = {},
): PersonaProvider {
  return new HermesPersonaProviderImpl(deps);
}

export default createHermesPersonaProvider;

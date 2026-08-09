/**
 * app/server/orchestrator.ts —— Core Orchestrator 编排层（AP-02）
 *
 * 职责：把 M1 文字链路串成一条可验证的链路——
 *   文本聊天请求 → persona 取 instructions → brain 执行 → 返回结果。
 * 依赖注入：只依赖 §2.3 BrainRunner 与 §2.4 PersonaProvider 抽象接口，
 *   不 import 任何具体实现（契约 §3.1：只依赖接口，不依赖实现）。
 *
 * 契约对齐：docs/architecture/module-contracts.md §2.7（v1.2）
 * 模块边界：仅 app/server 内部使用；零运行时依赖（type-only imports，ADR-007）；
 *   无持久化、无本地记忆（红线 1），活跃人设仅存内存（重启即回默认）。
 *
 * 错误语义（契约 §3.3）：
 *   - persona 获取/注入失败 → 向上抛错，由 REST 层转 4xx/5xx
 *   - brain 执行失败（超时/不可用）→ 不抛错，返回 ok:false + 友好降级提示（HTTP 200）
 */

import type { PersonaProvider, PersonaInfo } from '../../persona/provider.ts';
import type { BrainRunner, BrainResult } from '../../brain/hermes-runner.ts';

/** 文本聊天请求（契约 §2.7） */
export interface ChatRequest {
  message: string;     // 用户文本消息（必填）
  personaId?: string;  // 可选：指定人设，缺省用当前活跃人设
}

/** 文本聊天结果（契约 §2.7） */
export interface ChatResult {
  reply: string;       // 最终回复文本（Hermes 结果或降级提示）
  personaId: string;   // 实际使用的人设 id
  ok: boolean;         // 链路是否成功（brain 执行失败为 false）
  durationMs: number;  // 总耗时
  brain?: BrainResult; // brain 原始结果（§2.3），失败时带 error
}

/** 人设切换结果（契约 §2.7） */
export interface SwitchResult {
  ok: boolean;
  persona?: PersonaInfo; // 切换成功时返回新活跃人设摘要
  error?: string;
}

/** Core Orchestrator 编排层接口（契约 §2.7） */
export interface CoreOrchestrator {
  /** 文本聊天主流程：取人设 instructions → brain 执行 → 返回结果 */
  chat(req: ChatRequest): Promise<ChatResult>;
  /** 切换活跃人设（先校验存在性，仅内存状态，无持久化） */
  switchPersona(id: string): Promise<SwitchResult>;
  /** 当前活跃人设 id（初始为默认人设） */
  getActivePersonaId(): string;
}

/** 默认活跃人设 id（与 app 内嵌占位人设一致，PS-02 交付后可改） */
export const DEFAULT_PERSONA_ID = 'xiaodai';

/** 编排层依赖（构造注入，全部为抽象接口） */
export interface OrchestratorDeps {
  personaProvider: PersonaProvider;
  brainRunner: BrainRunner;
  /** 初始活跃人设 id，缺省 DEFAULT_PERSONA_ID */
  defaultPersonaId?: string;
}

/** 编排层实现（不对外暴露，统一走 createOrchestrator 工厂） */
class CoreOrchestratorImpl implements CoreOrchestrator {
  private readonly personaProvider: PersonaProvider;
  private readonly brainRunner: BrainRunner;
  private activePersonaId: string;

  constructor(deps: OrchestratorDeps) {
    this.personaProvider = deps.personaProvider;
    this.brainRunner = deps.brainRunner;
    this.activePersonaId = deps.defaultPersonaId ?? DEFAULT_PERSONA_ID;
  }

  async chat(req: ChatRequest): Promise<ChatResult> {
    const started = Date.now();
    const personaId = req.personaId ?? this.activePersonaId;

    // ① 取人设（含 Hermes 预组装的 instructions）——失败向上抛，由 REST 层转 4xx/5xx
    const persona = await this.personaProvider.getPersona(personaId);
    // ② 人设 → instructions 文本（PersonaProvider 内部透传/格式化）
    const instructions = this.personaProvider.buildInstructions(persona);

    // ③ brain 执行：用户消息为任务，人设 instructions 作为上下文
    const result = await this.brainRunner.run({
      instruction: req.message,
      context: instructions,
    });

    // ④ 收口：brain 失败不抛错，降级为友好提示（契约 §2.7 错误处理）
    return {
      reply: result.ok ? result.output : `（大脑开小差了：${result.error ?? '未知错误'}，稍后再试试？）`,
      personaId,
      ok: result.ok,
      durationMs: Date.now() - started,
      brain: result,
    };
  }

  async switchPersona(id: string): Promise<SwitchResult> {
    // 先校验人设存在，避免切到不存在的 id
    const personas = await this.personaProvider.listPersonas();
    const found = personas.find((p) => p.id === id);
    if (!found) {
      return { ok: false, error: `人设不存在：${id}` };
    }
    await this.personaProvider.switchPersona(id);
    this.activePersonaId = id; // 仅内存状态，重启回默认（无持久化）
    return { ok: true, persona: found };
  }

  getActivePersonaId(): string {
    return this.activePersonaId;
  }
}

/** 创建编排层实例（依赖注入入口，装配处负责提供实现） */
export function createOrchestrator(deps: OrchestratorDeps): CoreOrchestrator {
  return new CoreOrchestratorImpl(deps);
}

export default createOrchestrator;

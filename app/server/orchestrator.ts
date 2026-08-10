/**
 * app/server/orchestrator.ts —— Core Orchestrator 编排层（AP-02）
 *
 * 职责：把 M1 文字链路串成一条可验证的链路——
 *   文本聊天请求 → persona 取 instructions → brain 执行 → 返回结果。
 * 依赖注入：只依赖 §2.3 BrainRunner 与 §2.4 PersonaProvider 抽象接口，
 *   不 import 任何具体实现（契约 §3.1：只依赖接口，不依赖实现）。
 *
 * 契约对齐：docs/architecture/module-contracts.md §2.7（v1.2）
 * 模块边界：仅 app/server 内部使用；运行时仅依赖 persona/provider.ts 的共享常量
 *   （ADR-007：零第三方运行时依赖）；无持久化、无本地记忆（红线 1），
 *   活跃人设仅存内存（重启即回默认）。
 *
 * 错误语义（契约 §3.3）：
 *   - persona 获取/注入失败 → 向上抛错，由 REST 层转 4xx/5xx
 *   - brain 执行失败（超时/不可用）→ 不抛错，返回 ok:false + 友好降级提示（HTTP 200）
 *   - 请求级总超时（H1）→ 不抛错，返回 ok:false + 超时友好提示（HTTP 200）
 */

import { DEFAULT_PERSONA_ID, type PersonaProvider, type PersonaInfo } from '../../persona/provider.ts';
import type { BrainRunner, BrainResult } from '../../brain/hermes-runner.ts';

/** 文本聊天请求（契约 §2.7） */
export interface ChatRequest {
  message: string;     // 用户文本消息（必填）
  personaId?: string;  // 可选：指定人设，缺省用当前活跃人设
}

/** 文本聊天结果（契约 §2.7） */
export interface ChatResult {
  reply: string;       // 最终回复文本（Hermes 结果或 Qwen 降级回答或友好提示）
  personaId: string;   // 实际使用的人设 id
  ok: boolean;         // 链路是否成功（brain 失败但 Qwen 降级成功 → true；双重失败 → false）
  durationMs: number;  // 总耗时
  degraded?: boolean;  // M5-02：true = Hermes 失败降级 Qwen 回答（ok 同时为 true）
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
  /** 人设列表（PS-03：文件化人设，来自 personas.json 注册表） */
  listPersonas(): Promise<PersonaInfo[]>;
  /** 切换活跃人设（先校验存在性，写 active.txt，毫秒级） */
  switchPersona(id: string): Promise<SwitchResult>;
  /** 当前活跃人设 id（初始为 active.txt，切换后同步内存） */
  getActivePersonaId(): string;
}

/** 默认活跃人设 id（L7：与 file-persona-provider 统一引用 persona/provider.ts 共享常量） */
export { DEFAULT_PERSONA_ID };

/** 文本聊天总超时（H1：请求级超时保护，防止 persona 文件 IO / brain 卡死导致请求永久挂起） */
const CHAT_TIMEOUT_MS = 60_000;
/** 单次 brain 执行超时（L8：文本聊天比事务执行快，默认 120s 过长；留总超时余量） */
const BRAIN_TIMEOUT_MS = 45_000;

/** 编排层依赖（构造注入，全部为抽象接口） */
export interface OrchestratorDeps {
  personaProvider: PersonaProvider;
  brainRunner: BrainRunner;
  /** M5-02：Hermes 失败时的 Qwen 降级通道（可选；未注入则失败只返回友好提示） */
  fallbackRunner?: BrainRunner;
  /** 初始活跃人设 id，缺省 DEFAULT_PERSONA_ID */
  defaultPersonaId?: string;
}

/** 编排层实现（不对外暴露，统一走 createOrchestrator 工厂） */
class CoreOrchestratorImpl implements CoreOrchestrator {
  private readonly personaProvider: PersonaProvider;
  private readonly brainRunner: BrainRunner;
  private readonly fallbackRunner?: BrainRunner;
  private activePersonaId: string;

  constructor(deps: OrchestratorDeps) {
    this.personaProvider = deps.personaProvider;
    this.brainRunner = deps.brainRunner;
    this.fallbackRunner = deps.fallbackRunner;
    this.activePersonaId = deps.defaultPersonaId ?? DEFAULT_PERSONA_ID;
  }

  /** 并发保护（M2）：串行队列——一次只放行一个 chat，避免多个并发请求
   *  同时 spawn Hermes 子进程抢资源（冷启动 12~23s，并发 spawn 会互相拖慢） */
  private chatQueue: Promise<unknown> = Promise.resolve();

  async chat(req: ChatRequest): Promise<ChatResult> {
    const started = Date.now();
    const personaId = req.personaId ?? this.activePersonaId;

    // M2：并入串行队列（前一个 chat 完成后再执行本次；队列吞错，不因单次失败中断后续）
    const run = this.chatQueue.then(() => this.doChat(req, personaId, started));
    this.chatQueue = run.catch(() => undefined);

    // H1：请求级总超时——Promise.race 保证任何环节卡死（persona IO / brain 异常）都不会永久挂起。
    // 超时结果走 HTTP 200 + ok:false（契约 §3.3：brain 业务失败不抛错）
    let timer: ReturnType<typeof setTimeout> | null = null;
    const timeoutResult = new Promise<ChatResult>((resolve) => {
      timer = setTimeout(() => {
        resolve({
          reply: '（大脑思考超时了，稍后再试试？）',
          personaId,
          ok: false,
          durationMs: Date.now() - started,
        });
      }, CHAT_TIMEOUT_MS);
    });

    try {
      return await Promise.race([run, timeoutResult]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** chat 内部实现（不含超时/并发保护，由 chat() 统一包裹） */
  private async doChat(req: ChatRequest, personaId: string, started: number): Promise<ChatResult> {
    // ① 取人设（含 Hermes 预组装的 instructions）——失败向上抛，由 REST 层转 4xx/5xx
    const persona = await this.personaProvider.getPersona(personaId);
    // ② 人设 → instructions 文本（PersonaProvider 内部透传/格式化）
    const instructions = this.personaProvider.buildInstructions(persona);

    // ③ brain 执行：用户消息为任务，人设 instructions 作为上下文（L8：显式传文本聊天超时）
    const result = await this.brainRunner.run({
      instruction: req.message,
      context: instructions,
      timeoutMs: BRAIN_TIMEOUT_MS,
    });

    // ④ Hermes 失败 → M5-02 降级：走 Qwen 文本对话（纯 Qwen 回答，保持人设）
    if (!result.ok && this.fallbackRunner) {
      const fallback = await this.fallbackRunner.run({
        instruction: req.message,
        context: instructions,
      });
      if (fallback.ok) {
        return {
          reply: fallback.output,
          personaId,
          ok: true,
          degraded: true, // 标记：本次回答来自 Qwen 降级（Hermes 不可用）
          durationMs: Date.now() - started,
          brain: result,
        };
      }
      // L9：错误细节（fallback.error）不直接拼给用户，保留在 brain 字段供日志/调试
      return {
        reply: '（大脑开小差了，稍后再试试？）',
        personaId,
        ok: false,
        durationMs: Date.now() - started,
        brain: result,
      };
    }

    // ⑤ 收口：brain 失败且无降级通道 → 友好提示；成功 → 原文（L9：error 细节只进 brain 字段）
    return {
      reply: result.ok ? result.output : '（大脑开小差了，稍后再试试？）',
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
    await this.personaProvider.switchPersona(id); // PS-03：写 active.txt（毫秒级，持久化）
    this.activePersonaId = id; // 同步内存态
    return { ok: true, persona: found };
  }

  async listPersonas(): Promise<PersonaInfo[]> {
    return this.personaProvider.listPersonas();
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

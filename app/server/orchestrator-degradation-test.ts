/**
 * app/server/orchestrator-degradation-test.ts —— M5-02 编排层降级链路自检（零依赖、不发真实网络）
 *
 * 验收项（M5-02 错误处理与降级）：
 *   1. Hermes 成功 → ok:true、无 degraded 标记、reply 为 Hermes 输出
 *   2. Hermes 失败 + Qwen 降级成功 → ok:true + degraded:true + reply 为 Qwen 回答
 *   3. Hermes 失败 + Qwen 也失败 → ok:false + 通用友好提示（CC-01 L9 脱敏，不含 Qwen error）
 *   4. Hermes 失败 + 未注入降级通道 → ok:false + 通用友好提示（原行为，向后兼容）
 *
 * CC-03 DEF-A-01：3b/4b 断言由"含具体错误文本"改为"含通用提示且不含具体错误"——
 *   与 CC-01 L9 脱敏行为对齐（error 细节只进 brain 字段，不拼给用户）。
 *   5. 降级请求也带人设 context（instructions 透传，人设不丢）
 *   6. brain 原始结果透传（brain 字段保留，失败时带 error）
 *
 * 运行：node --experimental-strip-types app/server/orchestrator-degradation-test.ts
 */

import { createOrchestrator, type ChatResult } from './orchestrator.ts';
import type { PersonaProvider, Persona, PersonaInfo } from '../../persona/provider.ts';
import type { BrainRunner, BrainResult } from '../../brain/hermes-runner.ts';

const RESULTS: { name: string; pass: boolean; detail?: string }[] = [];
function check(name: string, pass: boolean, detail?: string): void {
  RESULTS.push({ name, pass, detail });
  console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
}

// ---------------------------------------------------------------- mock persona

const FAKE_PERSONA: Persona = {
  id: 'xiaodai',
  name: '小呆',
  description: '测试人设',
  instructions: '你是小呆，18 岁活泼可爱的 AI 少女。',
} as Persona;

const personaProvider: PersonaProvider = {
  listPersonas: async (): Promise<PersonaInfo[]> => [{ id: 'xiaodai', name: '小呆', description: '测试人设' }],
  getPersona: async (id: string): Promise<Persona> => ({ ...FAKE_PERSONA, id }),
  buildInstructions: (p: Persona): string => p.instructions,
  switchPersona: async (): Promise<void> => undefined,
};

// ---------------------------------------------------------------- mock runner 工厂

function makeRunner(result: BrainResult, record?: { context?: string }): BrainRunner {
  return {
    run: async (task) => {
      if (record) record.context = task.context;
      return result;
    },
  };
}

const okHermes: BrainResult = { ok: true, output: 'Hermes 回答：股票代码 600519', durationMs: 1234 };
const failHermes: BrainResult = { ok: false, output: '', durationMs: 5000, error: 'Hermes 任务超时（>120000ms），已终止' };
const okQwen: BrainResult = { ok: true, output: 'Qwen 回答：茅台今天的行情不错～', durationMs: 456 };
const failQwen: BrainResult = { ok: false, output: '', durationMs: 300, error: 'Qwen 降级 HTTP 500' };

// ---------------------------------------------------------------- 1：Hermes 成功

{
  const orch = createOrchestrator({
    personaProvider,
    brainRunner: makeRunner(okHermes),
    fallbackRunner: makeRunner(okQwen),
  });
  const r: ChatResult = await orch.chat({ message: '茅台怎么样？' });
  check('1 Hermes 成功 → ok:true 且无 degraded', r.ok === true && r.degraded === undefined);
  check('1b reply 为 Hermes 输出', r.reply === okHermes.output, r.reply);
  check('1c durationMs >= 0', r.durationMs >= 0, `${r.durationMs}ms`);
}

// ---------------------------------------------------------------- 2：Hermes 失败 + Qwen 降级成功

{
  const hermCtx: { context?: string } = {};
  const qwenCtx: { context?: string } = {};
  const orch = createOrchestrator({
    personaProvider,
    brainRunner: makeRunner(failHermes, hermCtx),
    fallbackRunner: makeRunner(okQwen, qwenCtx),
  });
  const r: ChatResult = await orch.chat({ message: '茅台怎么样？' });
  check('2 Hermes 失败 + Qwen 成功 → ok:true + degraded:true', r.ok === true && r.degraded === true);
  check('2b reply 为 Qwen 回答', r.reply === okQwen.output, r.reply);
  check('2c 降级请求带人设 context', qwenCtx.context === FAKE_PERSONA.instructions, qwenCtx.context);
  check('2d brain 原始结果透传（失败带 error）', r.brain === failHermes && r.brain.error !== undefined);
}

// ---------------------------------------------------------------- 3：双重失败

{
  const orch = createOrchestrator({
    personaProvider,
    brainRunner: makeRunner(failHermes),
    fallbackRunner: makeRunner(failQwen),
  });
  const r: ChatResult = await orch.chat({ message: 'hi' });
  check('3 双重失败 → ok:false', r.ok === false);
  check('3b 双重失败 → 通用友好提示（L9 脱敏，不含 Qwen error）', r.reply.includes('大脑开小差了') && !r.reply.includes('Qwen 降级 HTTP 500'), r.reply);
  check('3c 无 degraded 标记（未成功降级）', r.degraded === undefined);
}

// ---------------------------------------------------------------- 4：无降级通道（向后兼容）

{
  const orch = createOrchestrator({ personaProvider, brainRunner: makeRunner(failHermes) });
  const r: ChatResult = await orch.chat({ message: 'hi' });
  check('4 无降级通道 → ok:false + 原友好提示', r.ok === false && r.reply.includes('大脑开小差了'), r.reply);
  check('4b 提示不含 Hermes 具体错误（L9 脱敏）', !r.reply.includes('Hermes 任务超时') && r.reply.includes('大脑开小差了'));
}

// ---------------------------------------------------------------- 汇总

const failed = RESULTS.filter((x) => !x.pass);
console.log(`\n${failed.length === 0 ? '🎉' : '❌'} orchestrator 降级链路自检 ${RESULTS.length - failed.length}/${RESULTS.length} 通过`);
if (failed.length > 0) {
  console.log('失败项：', failed.map((f) => f.name).join('、'));
  process.exit(1);
}

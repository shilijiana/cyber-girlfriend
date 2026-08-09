/**
 * client/voice/voice-test.ts —— CL-06 useVoice 核心逻辑自检（node 直接跑）
 *
 * 覆盖：audio.ts 纯函数（PCM 编解码往返 / 重采样）+ voice-machine.ts（状态机转移表/映射）。
 * useVoice 的 React 绑定与浏览器 API（getUserMedia/AudioContext/WebSocket）不在此测
 * （对齐项目惯例：纯逻辑核心自检，浏览器层由 tsc + 人工联调验收）。
 *
 * 运行：npm run test:voice（esbuild bundle → node）
 */

import {
  computeEnergy,
  encodePCM16,
  decodePCM16,
  resampleLinear,
} from './audio.ts';
import {
  INITIAL_VOICE_STATUS,
  isVoiceActive,
  mapGatewayState,
  voiceMachineReduce,
  type VoiceStatus,
} from './voice-machine.ts';

let passed = 0;
let failed = 0;

function assert(cond: boolean, name: string): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}`);
  }
}

function assertEq(actual: unknown, expected: unknown, name: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${name}：期望 ${e}，实际 ${a}`);
  }
}

console.log('── CL-06 自检开始 ─────────────────────────');

// ============================================================ audio.ts 纯函数
console.log('▸ PCM 编解码');

{
  // 往返：[-1, 0, 0.5, 1] → Int16 → Float32 近似还原
  const src = new Float32Array([-1, -0.5, 0, 0.5, 1]);
  const buf = encodePCM16(src);
  assert(buf.byteLength === src.length * 2, 'encodePCM16 长度 = n*2 字节');
  const back = decodePCM16(buf);
  for (let i = 0; i < src.length; i++) {
    assert(Math.abs(back[i] - src[i]) < 1 / 32768 + 1e-6, `往返还原 i=${i}（${src[i]}≈${back[i]}）`);
  }
  // 端点值：-1 → -32768，+1 → +32767
  const dv = new DataView(buf);
  assertEq(dv.getInt16(0, true), -32768, 'encode -1 → -32768');
  assertEq(dv.getInt16(8, true), 32767, 'encode 1 → 32767');
  // 削波：越界值 clamp
  const clip = encodePCM16(new Float32Array([-2, 2]));
  const dv2 = new DataView(clip);
  assertEq(dv2.getInt16(0, true), -32768, 'clamp -2 → -32768');
  assertEq(dv2.getInt16(2, true), 32767, 'clamp 2 → 32767');
  // 小端序：0x0100 应编码为 1
  const le = encodePCM16(new Float32Array([1 / 32767]));
  const dv3 = new DataView(le);
  assert(dv3.getUint8(0) === 0x01 && dv3.getUint8(1) === 0x00, 'Int16 小端字节序正确');
  // 奇数字节容错
  const odd = new ArrayBuffer(3);
  new DataView(odd).setInt16(0, 1000, true);
  assertEq(decodePCM16(odd).length, 1, 'decode 奇数长度截断到 n/2');
}

console.log('▸ 重采样 resampleLinear');

{
  // 同采样率直通（同一引用）
  const same = new Float32Array([0.1, 0.2, 0.3]);
  assert(resampleLinear(same, 48000, 48000) === same, '同采样率返回原引用');
  // 48k→16k：长度 1/3
  const down = resampleLinear(new Float32Array(300).fill(0.5), 48000, 16000);
  assertEq(down.length, 100, '48k→16k 长度 = 1/3');
  assert(down.every((v) => Math.abs(v - 0.5) < 1e-9), '常数信号重采样值不变');
  // 16k→48k：长度 3 倍
  const up = resampleLinear(new Float32Array(100).fill(0.25), 16000, 48000);
  assertEq(up.length, 300, '16k→48k 长度 = 3 倍');
  assert(up.every((v) => Math.abs(v - 0.25) < 1e-9), '常数信号上采样值不变');
  // 斜坡信号：线性插值（时间轴语义：目标位置 j*from/to，末端保持末样本）
  const ramp = new Float32Array([0, 1]);
  const upRamp = resampleLinear(ramp, 2, 4);
  assertEq(upRamp.length, 4, '2→4 长度翻倍');
  assertEq(upRamp[0], 0, '斜坡起点 0');
  assertEq(upRamp[3], 1, '斜坡终点 1');
  assert(Math.abs(upRamp[1] - 0.5) < 1e-6 && Math.abs(upRamp[2] - 1) < 1e-6, '斜坡中点线性插值（时间轴语义）');
  // 大比例上采样末端越界 clamp：2→8 不产生 NaN（末样本保持）
  const upBig = resampleLinear(ramp, 2, 8);
  assertEq(upBig.length, 8, '2→8 长度 4 倍');
  assert(upBig.every((v) => Number.isFinite(v)), '2→8 无 NaN');
  assertEq(upBig[7], 1, '2→8 末端保持末样本');
  assert(Math.abs(upBig[1] - 0.25) < 1e-6, '2→8 中点线性插值');
  // 非法参数防御
  assertEq(resampleLinear(new Float32Array(0), 48000, 16000).length, 0, '空输入 → 空输出');
  assertEq(resampleLinear(new Float32Array(10), 0, 16000).length, 0, '非法源采样率 → 空输出');
}

console.log('▸ 能量分析 computeEnergy');

{
  assertEq(computeEnergy(new Float32Array([])), 0, '空输入能量 0');
  assert(Math.abs(computeEnergy(new Float32Array([0.5])) - 0.5) < 1e-9, '单样本能量 = 绝对值');
  // 常量信号能量 = 幅值（Float32 精度，容差 1e-6）；满幅能量 = 1
  assert(Math.abs(computeEnergy(new Float32Array(100).fill(0.8)) - 0.8) < 1e-6, '常量 0.8 能量 = 0.8');
  assert(Math.abs(computeEnergy(new Float32Array(100).fill(1)) - 1) < 1e-9, '满幅能量 = 1');
  // 静音 < 有声音
  const silence = computeEnergy(new Float32Array(100).fill(0));
  const loud = computeEnergy(new Float32Array(100).fill(0.9));
  assert(silence < loud, '静音能量 < 有声能量');
}

// ============================================================ voice-machine.ts
console.log('▸ 状态机转移表');

const TRANSITIONS: Array<[VoiceStatus, Parameters<typeof voiceMachineReduce>[1], VoiceStatus]> = [
  // CONNECT：idle/closed/error → connecting；活跃态保持
  ['idle', { type: 'CONNECT' }, 'connecting'],
  ['closed', { type: 'CONNECT' }, 'connecting'],
  ['error', { type: 'CONNECT' }, 'connecting'],
  ['connected', { type: 'CONNECT' }, 'connected'],
  ['speaking', { type: 'CONNECT' }, 'speaking'],
  ['listening', { type: 'CONNECT' }, 'listening'],
  ['connecting', { type: 'CONNECT' }, 'connecting'],
  // CONNECTED：非 error/closed → connected
  ['connecting', { type: 'CONNECTED' }, 'connected'],
  ['idle', { type: 'CONNECTED' }, 'connected'],
  ['speaking', { type: 'CONNECTED' }, 'connected'],
  ['listening', { type: 'CONNECTED' }, 'connected'],
  ['error', { type: 'CONNECTED' }, 'error'],
  ['closed', { type: 'CONNECTED' }, 'closed'],
  // SPEAKING / LISTENING：非 error/closed → 对应态
  ['connected', { type: 'SPEAKING' }, 'speaking'],
  ['listening', { type: 'SPEAKING' }, 'speaking'],
  ['idle', { type: 'LISTENING' }, 'listening'],
  ['speaking', { type: 'LISTENING' }, 'listening'],
  ['error', { type: 'SPEAKING' }, 'error'],
  ['closed', { type: 'LISTENING' }, 'closed'],
  // ERROR：任意 → error
  ['speaking', { type: 'ERROR' }, 'error'],
  ['connecting', { type: 'ERROR' }, 'error'],
  // DISCONNECT：任意 → closed
  ['speaking', { type: 'DISCONNECT' }, 'closed'],
  ['error', { type: 'DISCONNECT' }, 'closed'],
];

for (const [from, ev, to] of TRANSITIONS) {
  assertEq(voiceMachineReduce(from, ev), to, `${from} --${ev.type}--> ${to}`);
}
assertEq(INITIAL_VOICE_STATUS, 'idle', '初始状态 idle');

console.log('▸ 网关状态映射');

assertEq(mapGatewayState('connected'), { type: 'CONNECTED' }, "connected → CONNECTED");
assertEq(mapGatewayState('idle'), { type: 'CONNECTED' }, "idle → CONNECTED（就绪等价）");
assertEq(mapGatewayState('speaking'), { type: 'SPEAKING' }, "speaking → SPEAKING");
assertEq(mapGatewayState('listening'), { type: 'LISTENING' }, "listening → LISTENING");

console.log('▸ isVoiceActive');

assert(!isVoiceActive('idle'), 'idle 非活跃');
assert(!isVoiceActive('connecting'), 'connecting 非活跃');
assert(!isVoiceActive('closed'), 'closed 非活跃');
assert(!isVoiceActive('error'), 'error 非活跃');
assert(isVoiceActive('connected'), 'connected 活跃');
assert(isVoiceActive('speaking'), 'speaking 活跃');
assert(isVoiceActive('listening'), 'listening 活跃');

// ============================================================ 汇总
console.log('──────────────────────────────────────────────');
if (failed === 0) {
  console.log(`✅ CL-06 自检通过：${passed}/${passed} 断言`);
} else {
  // 抛错使 node 非零退出（client 无 @types/node，不用 process.exit）
  throw new Error(`CL-06 自检失败：${failed} 项未通过（${passed} 通过）`);
}

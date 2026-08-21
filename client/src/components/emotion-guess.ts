/**
 * client/src/components/emotion-guess.ts —— 文本情绪猜测器（纯函数，零依赖）
 *
 * 背景（2026-08-21）：情绪推送只走语音链路（Qwen Realtime WS 内嵌 emotion 字段），
 * 文字聊天（/api/chat）不推 emotion 事件 → 打字时数字人视频不切换。
 * 本模块做**前端本地兜底**：分析文本（用户输入 / 小呆回复）中的情绪关键词，
 * 输出素材库支持的白名单情绪（happy/gentle/serious/surprise/neutral），
 * 供 App 在打字链路调 avatar.setEmotion 驱动视频切换。
 *
 * 设计：
 *   · 关键词权重打分：命中一个词 +1 分，取最高分情绪
 *   · 平局按优先级 happy > gentle > serious > surprise > neutral
 *   · 无命中 → neutral（安全兜底，不崩不跳）
 *   · 纯函数可测（node --experimental-strip-types 直接跑，与 chat-core 惯例一致）
 *
 * 边界：本模块只做"粗粒度情绪猜测"，不替代语音链路的精确情绪事件；
 *       语音 emotion 事件优先级更高（后到者覆盖，见 App.tsx 接入方式）。
 */

import type { Emotion } from '../../../avatar/clip-matcher.ts';

/** 情绪关键词表（中文为主；命中 +1 分） */
const EMOTION_KEYWORDS: Record<Exclude<Emotion, 'neutral'>, readonly string[]> = {
  happy: [
    '开心', '高兴', '哈哈', '嘻嘻', '嘿嘿', '太好了', '喜欢', '棒', '兴奋',
    '愉快', '笑', '开心死', '哇哦', '幸福', '快乐', '满意', '惊喜', '超爱',
  ],
  gentle: [
    '温柔', '温暖', '爱你', '贴心', '抱抱', '想你', '乖', '摸摸', '心疼',
    '亲亲', '陪着', '暖', '轻声', '慢慢说', '别担心', '好好休息', '宝贝',
  ],
  serious: [
    '难过', '悲伤', '伤心', '严肃', '麻烦', '担心', '认真', '问题', '头疼',
    '糟糕', '焦虑', '压力', '哭', '酸酸', '累', '没办法', '抱歉', '对不起',
    '沮丧', '失望', '委屈', '疼',
  ],
  surprise: [
    '哇', '天哪', '惊讶', '震惊', '没想到', '居然', '竟然', '真的吗', '咦',
    '不会吧', '天啊', '惊呆了', '太意外',
  ],
};

/** 平局优先级（索引越小越优先） */
const PRIORITY: readonly Exclude<Emotion, 'neutral'>[] = ['happy', 'gentle', 'serious', 'surprise'];

/** 情绪切换指令模式：以"切/换/变/调/来/要/给"等开头，后跟情绪词（中间可夹 0-6 字） */
const COMMAND_RE =
  /^(切|换|切换|变成|变|调|来|要|给|给我)(到|成|为|个|一下|点|个)?[\s\S]{0,6}(开心|快乐|高兴|哈哈|难过|悲伤|伤心|严肃|认真|温柔|温暖|惊讶|惊喜|正常|neutral|happy|sad|serious|gentle|surprise)/i;

/**
 * 判断是否为"纯情绪切换指令"（2026-08-21 老板需求）：
 * 命中时调用方应**本地切换情绪、不发 /api/chat 请求**——
 * 避免情绪指令也走 Hermes（8-9s）导致等待期间输入/发送被锁。
 * 规则：① 匹配 COMMAND_RE（"切到开心"/"来点悲伤的"/"换严肃"…）；或
 *       ② 全文 ≤ 8 字且命中非 neutral 情绪词（"开心"/"悲伤"…）。
 * 正常聊天（"今天好开心啊我们去吃饭"）不会被误判（有"去吃饭"等后续，长度超限且无指令前缀）。
 */
export function isEmotionCommand(text: string): boolean {
  const t = text?.trim() ?? '';
  if (!t) return false;
  if (COMMAND_RE.test(t)) return true;
  // 全文短 + 命中情绪 → 视为指令（如"开心""悲伤""温柔一点"）
  if (t.length <= 8 && guessEmotion(t) !== 'neutral') return true;
  return false;
}

/**
 * 猜测文本情绪：关键词打分 → 最高分（平局按优先级）→ 无命中 neutral。
 * 单字词（哇/咦/哭/累/暖/棒/笑/疼）阈值放宽：需与其他词共现或至少命中 2 次不同词？
 * 简化：全部 +1 计分，最高分即结果；单字词命中 1 分也能触发（可用场景足够）。
 */
export function guessEmotion(text: string): Emotion {
  const t = text?.trim() ?? '';
  if (!t) return 'neutral';

  const scores = new Map<Emotion, number>();
  let best: Emotion = 'neutral';
  let bestScore = 0;

  for (const [emotion, keywords] of Object.entries(EMOTION_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (t.includes(kw)) score += 1;
    }
    if (score > 0) scores.set(emotion as Emotion, score);
  }

  for (const emotion of PRIORITY) {
    const score = scores.get(emotion) ?? 0;
    if (score > bestScore) {
      bestScore = score;
      best = emotion;
    }
  }

  return best;
}

export default guessEmotion;

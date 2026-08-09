# AV-04 · 情绪匹配与轮换策略（任务规格）

> **任务编号**：AV-04（avatar 模块，P1）
> **目标文件**：`avatar/emotion-matcher.ts`（或并入 clip-matcher 的增强，按实现）
> **依赖**：AV-01 ✅（clip-matcher.ts 已实现）
> **配套**：`docs/TASKS-CONFIG.md` §AV 模块、`docs/architecture/module-contracts.md` §2.5
> 更新日期：2026-08-09

---

## 1. 任务目标

把"情绪事件 → 选片"的匹配逻辑正式化：在 AV-01 已有 `pickClip` 基础上，封装**带会话状态的情绪匹配器**——避免连续重复、随机 + 轮换、跨会话记忆最近播放。

## 2. 现状（AV-01 已交付的基础）

```ts
// avatar/clip-matcher.ts（已实现）
export interface ClipMatcher {
  pickClip(emotion: Emotion, recentlyPlayed: string[]): Clip | null;
  buildQueue(targetDurationMs: number, emotion: Emotion): Clip[];
}
```

AV-01 已实现：情绪筛选 → 新鲜池随机 → 全播过回退全池轮换 → 无素材返回 null。

## 3. 本任务要补充的（有状态封装）

```ts
// avatar/emotion-matcher.ts（建议）
export interface EmotionMatcherOptions {
  library: ClipLibrary;              // 素材库（AV-02 manifest）
  recentlyPlayedWindow?: number;     // 最近播放记忆窗口（默认 5）
}

export interface EmotionMatcher {
  /** 情绪事件 → 选片：内部维护 recentlyPlayed 队列（窗口滑动），自动避重复 */
  pick(emotion: Emotion): Clip | null;
  /** 记录已播放（选片后由调用方调用，或内部自动记录） */
  markPlayed(clipId: string): void;
  /** 重置播放记忆（如切换人设/会话） */
  reset(): void;
}
```

**要点**：
- **有状态**：内部维护"最近播放"队列（窗口滑动，默认记住最近 5 个），调用方无需自己传 recentlyPlayed
- **随机 + 轮换**：新鲜池随机；全播过回退全池轮换（沿用 AV-01 逻辑）
- **防连续重复**：队列内同一片段不连续出现（窗口内避重）
- **可注入 clipMatcher**：构造时传 `createClipMatcher(library)` 复用 AV-01（或内部直接调用）

## 4. 情绪事件来源（对接链路）

情绪事件来自 voice-shell（VS-01/VS-03）：
```
Qwen-Audio 情绪事件 → dispatcher.onEmotion(e) → EmotionMatcher.pick(e) → Clip
→ CL-01 AvatarCanvas 播放
```

## 5. 验收标准（自检）

| # | 验收点 | 自检方法 |
|---|--------|----------|
| 1 | 情绪选片 | `pick('happy')` 返回 happy 片段；无素材情绪返回 null |
| 2 | 避连续重复 | 连续 5 次 pick('happy') 不出现同一 id 两次 |
| 3 | 全播过轮换 | 某情绪片段全部播过 → 回退全池，仍返回非 null |
| 4 | 状态重置 | `reset()` 后重新从新鲜池开始 |
| 5 | 零依赖 | 纯 TS，零第三方依赖（复用 clip-matcher 类型） |

## 6. 边界与红线

- ✅ 只做匹配逻辑（有状态封装），不写视频播放（那是 CL-01）
- ✅ 无持久化（红线 1）：播放记忆只在内存，重启即清
- ✅ 依赖最小化（红线 5）：复用 AV-01 类型，不新增依赖
- ⚠️ 情绪事件透传自 voice-shell，本模块只消费 Emotion 类型

---

*AV-04 情绪匹配规格 v1.0 · 2026-08-09 · 依赖 AV-01 ✅ 可立即开工*

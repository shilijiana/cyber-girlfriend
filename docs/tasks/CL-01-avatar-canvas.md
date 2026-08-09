# CL-01 · AvatarCanvas 组件（任务规格）

> **任务编号**：CL-01（client 模块，P0）
> **目标文件**：`client/src/components/AvatarCanvas.tsx`
> **依赖**：AV-01 ✅（clip-matcher）+ AV-02（manifest，提供素材）
> **配套**：`docs/TASKS-CONFIG.md` §CL 模块、`docs/architecture/module-contracts.md` §2.5
> 更新日期：2026-08-09

---

## 1. 任务目标

实现数字人画布组件 `AvatarCanvas`：用 `<video>` 播放情绪匹配的素材片段，随语音会话状态切换（idle/speaking/listening），让赛博女友"看得见"。

## 2. 功能需求

1. **视频播放**：根据传入的 Clip（AV-04/AV-02 提供）播放对应素材
2. **状态切换**（对齐 voice-shell 状态机）：
   | 状态 | 含义 | 表现 |
   |------|------|------|
   | `idle` | 空闲 | 播放默认/neutral 片段或静置画面 |
   | `speaking` | AI 说话中 | 播放当前情绪片段（带嘴型的素材最佳） |
   | `listening` | 用户说话中（VAD） | 播放 listening 态片段或暂停/降低音量 |
3. **情绪对齐**：接 emotion 事件 → 换对应情绪片段
4. **轮换**：接 useAvatar Hook（CL-02）或内部简单轮换，避免同一片段连播

## 3. 接口设计（建议）

```tsx
// client/src/components/AvatarCanvas.tsx
export interface AvatarCanvasProps {
  /** 当前状态（idle/speaking/listening，来自 useVoice Hook） */
  state: 'idle' | 'speaking' | 'listening';
  /** 当前情绪（来自 voice-shell emotion 事件） */
  emotion: Emotion;
  /** 素材库（AV-02 manifest，useAvatar 加载） */
  library?: ClipLibrary;
  /** 状态切换时是否播放对应片段（默认 true） */
  playOnState?: boolean;
  /** 循环播放（默认 false，播完回 idle 片段） */
  loop?: boolean;
  className?: string;
}

export function AvatarCanvas(props: AvatarCanvasProps): JSX.Element;
```

## 4. 实现要点

1. **素材加载**：从 manifest.json（AV-02）加载 ClipLibrary，用 `createClipMatcher`（AV-01）选片
2. **播放策略**：state 变化 → 选片播放；情绪变化 → 同状态内换片
3. **平滑过渡**：切换片段时避免黑屏/闪烁（预加载下一片段、淡入淡出可选）
4. **降级**：无素材 → 显示占位（内置卡通形象/Live2D 兜底，AV-03）
5. **性能**：`<video>` 设置 `preload="auto"`、播放结束后重置

## 5. 验收标准（自检）

| # | 验收点 | 自检方法 |
|---|--------|----------|
| 1 | 组件渲染 | 挂载 AvatarCanvas 无报错，渲染 `<video>` 元素 |
| 2 | 状态切换 | state=speaking → 播放片段；state=idle → 回 idle 片段 |
| 3 | 情绪换片 | emotion 变化 → 播放对应情绪片段 |
| 4 | 无素材降级 | library 为空 → 显示占位不崩溃 |
| 5 | 环境可跑 | 可 `npm run dev` 前端试跑（若前端工程就绪） |

## 6. 边界与红线

- ✅ 只做 AvatarCanvas 组件（播放+状态切换），不写素材匹配逻辑（那是 AV-01/04）
- ✅ 纯前端展示（红线 1 无持久化）；依赖最小化（红线 5）
- ⚠️ 前端工程（Vite/React）若未初始化，先按 CL-09 迁移或最小初始化
- ⚠️ 素材文件由 AV-03/老板提供，本组件做好降级

---

*CL-01 AvatarCanvas 规格 v1.0 · 2026-08-09 · 依赖 AV-01 ✅ 可开工（素材可先用占位）*

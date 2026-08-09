/**
 * client/src/components/caption-core.ts —— CaptionBar 纯逻辑核心（CL-04）
 *
 * 职责：把「字幕增量累积 / 整段替换 / 超长截断」抽成零 React 依赖的纯逻辑，
 * 便于 node 直接自检；CaptionBar.tsx 只做受控展示（text/visible/tone）。
 *
 * 语义（对齐契约 §2.1 / VS-03 分发器）：
 *  - subtitle 事件 = S2S 副文本增量（AI 说话时流式到达）→ append(chunk) 累积
 *  - user_transcript completed = 用户语音最终转写 → replace(text) 整段替换
 *  - 新话语开始（会话切换 / 新一轮）→ reset() 清空
 *  - 超长截断：保留尾部（最近内容优先），头部加省略号（maxChars 边界）
 *
 * 红线：纯内存缓冲（组件/useRef 持有），零持久化；不含 DOM 与事件绑定。
 */

/** 字幕缓冲（可变对象，useRef 持有；text 为只读快照） */
export interface CaptionBuffer {
  /** 当前累积字幕文本（只读） */
  readonly text: string;
  /** 追加增量文本（subtitle 事件；空串忽略；超长截断保留尾部） */
  append(chunk: string): void;
  /** 整段替换（用户转写 completed / 新话语开始；同样截断） */
  replace(text: string): void;
  /** 清空（会话切换 / 手动关闭） */
  reset(): void;
}

/** 创建字幕缓冲；maxChars 为单条字幕最大字符数（默认 200） */
export function createCaptionBuffer(maxChars = 200): CaptionBuffer {
  const cap = Math.max(8, Math.floor(maxChars));
  let text = '';

  const clip = (t: string): string => {
    if (t.length <= cap) return t;
    // 保留尾部 cap-1 字符 + 头部省略号（最近内容优先）
    return '…' + t.slice(t.length - cap + 1);
  };

  return {
    get text() {
      return text;
    },
    append(chunk: string) {
      if (!chunk) return;
      text = clip(text + chunk);
    },
    replace(t: string) {
      text = clip(t);
    },
    reset() {
      text = '';
    },
  };
}

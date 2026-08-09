/**
 * client/src/components/ChatMessages.tsx —— 消息列表（CL-09 迁移自 cybergirlfriend/ChatMessages，零依赖重写）
 *
 * 旧版基于 TDesign ChatMarkdown + ToolCallsCollapse + 内联权限卡（多 Agent 体系，ADR-007 已移除 TDesign）。
 * 新版按新架构收敛：单一人设文本聊天，仅保留：
 *   · user / assistant 气泡（.chat-msg-user 靠右 / .chat-msg-assistant 靠左）
 *   · 内容纯文本（.chat-bubble，white-space: pre-wrap 保留换行；零 markdown 依赖）
 *   · pending/error 标记（.chat-msg-error 红色样式）
 *   · assistant 打字占位（.chat-typing 三点动画）
 *   · 时间戳（.chat-time，HH:MM）
 *   · 新消息自动滚动到底部
 *   · 空态引导（.chat-empty）
 * 红线：零持久化（消息纯内存，组件卸载即失）。
 */

import { useEffect, useRef } from 'react';
import type { ChatMessage } from '../hooks/use-chat.ts';

export interface ChatMessagesProps {
  messages: ChatMessage[];
  /** 发送中且最后一条不是 assistant 时，列表尾展示打字占位 */
  isLoading?: boolean;
  /** 可选：清空按钮回调（传入则列表顶部显示"清空"） */
  onClear?: () => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function ChatMessages({ messages, isLoading = false, onClear }: ChatMessagesProps) {
  const endRef = useRef<HTMLDivElement>(null);

  // 新消息 / loading 变化 → 滚动到底部
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, isLoading]);

  return (
    <div className="chat-list">
      {onClear && messages.length > 0 && (
        <div className="chat-list-bar">
          <button type="button" className="btn" onClick={onClear}>
            清空
          </button>
        </div>
      )}

      {messages.length === 0 && (
        <div className="chat-empty">
          <span className="chat-empty-name">和数字女友聊聊天吧～</span>
          <span>文本聊天是调试/降级通道，语音对话见下方语音栏</span>
        </div>
      )}

      {messages.map((m) => (
        <div
          key={m.id}
          className={`chat-msg ${m.role === 'user' ? 'chat-msg-user' : 'chat-msg-assistant'}${m.error ? ' chat-msg-error' : ''}`}
        >
          <div className="chat-bubble">{m.text || (m.pending ? ' ' : '')}</div>
          <span className="chat-time">{formatTime(m.ts)}</span>
        </div>
      ))}

      {isLoading && (
        <div className="chat-msg chat-msg-assistant">
          <div className="chat-typing">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

export default ChatMessages;

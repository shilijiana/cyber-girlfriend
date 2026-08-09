/**
 * client/src/components/ChatInput.tsx —— 文本输入（CL-09 迁移自 cybergirlfriend/ChatInput，零依赖重写）
 *
 * 旧版基于 TDesign ChatSender + 模型/权限选择器（多 Agent 体系，ADR-007 已移除 TDesign）。
 * 新版按新架构收敛：单一人设、无模型/权限选择，仅保留：
 *   · textarea 自适应高度（1~6 行）
 *   · Enter 发送 / Shift+Enter 换行
 *   · 发送中禁用（loading 态，按钮占位"回复中…"）
 *   · 空输入禁止发送
 * 样式类名对齐并发会话 index.css（.chat-input-row / .chat-input / .btn.chat-send）。
 * 红线：零持久化（不保存草稿到 localStorage）。
 */

import { useEffect, useRef } from 'react';

export interface ChatInputProps {
  inputValue: string;
  isLoading: boolean;
  onChange: (value: string) => void;
  onSend: (text: string) => void;
  /** 输入占位文案 */
  placeholder?: string;
  /** 发送按钮文字（loading 时显示） */
  sendLabel?: string;
}

export function ChatInput({
  inputValue,
  isLoading,
  onChange,
  onSend,
  placeholder = '想跟小呆说点什么…',
  sendLabel = '发送',
}: ChatInputProps) {
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 自适应高度：内容驱动，1~6 行区间（旧版 autosize minRows 1 / maxRows 6）
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 6 * 22 + 12)}px`;
  }, [inputValue]);

  const handleSend = () => {
    const text = inputValue.trim();
    if (text.length === 0 || isLoading) return;
    onSend(text);
  };

  return (
    <div className="chat-input-row">
      <textarea
        ref={taRef}
        className="chat-input"
        value={inputValue}
        placeholder={placeholder}
        rows={1}
        disabled={isLoading}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
          }
        }}
      />
      <button
        type="button"
        className="btn chat-send"
        disabled={isLoading || inputValue.trim().length === 0}
        onClick={handleSend}
      >
        {isLoading ? '回复中…' : sendLabel}
      </button>
    </div>
  );
}

export default ChatInput;

/**
 * client/src/components/ChatUI.tsx —— 聊天面板（CL-03，P1）
 *
 * 职责：收敛单一人设的文本聊天界面 —— 组合
 *   · useChat（CL-07）：消息状态 / 发送 / 清空（内部复用 chat-core 消息流）
 *   · ChatMessages（CL-09 迁移）：气泡列表 + 打字占位（.chat-list / .chat-msg）
 *   · ChatInput（CL-09 迁移）：输入框 + 发送（.chat-input-row）
 *
 * 样式类名对齐并发会话 CL-03/04/05 的 index.css（.chat-ui/.chat-list/.chat-msg/
 *   .chat-bubble/.chat-typing/.chat-input-row），不重复定义样式。
 *
 * 用法（App 集成）：
 *   <ChatUI onReply={(r) => { if (r.ok) ... }} />
 *
 * 依赖：AP-03（/api/chat 契约 §2.1）。红线：零持久化（消息纯内存）。
 */

import { useChat } from '../hooks/use-chat.ts';
import { ChatMessages } from './ChatMessages.tsx';
import { ChatInput } from './ChatInput.tsx';

export interface ChatUIProps {
  /** 可选：指定人设；缺省用服务端当前活跃人设 */
  personaId?: string;
  /** 可选：自定义 /api/chat 地址 */
  url?: string;
  /** 回复完成回调（App 集成：驱动字幕条等；ok=false 为降级/失败文案） */
  onReply?: (result: { ok: boolean; reply: string }) => void;
  /** 显示清空按钮 */
  showClear?: boolean;
}

export function ChatUI({ personaId, url, onReply, showClear = false }: ChatUIProps) {
  const { messages, isLoading, error, inputValue, setInputValue, sendMessage, clear } = useChat({
    url,
    personaId,
    onReply,
  });

  return (
    <section className="chat-ui">
      <ChatMessages messages={messages} isLoading={isLoading} onClear={showClear ? clear : undefined} />
      {error && <div className="chat-error">⚠ {error}</div>}
      <ChatInput
        inputValue={inputValue}
        isLoading={isLoading}
        onChange={setInputValue}
        onSend={(text) => void sendMessage(text)}
      />
    </section>
  );
}

export default ChatUI;

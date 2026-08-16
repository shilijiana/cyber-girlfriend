/**
 * client/src/App.tsx —— 前端壳（2026-08-16 沉浸式分屏重构版）
 *
 * 老板参考图风格：
 *   · 顶部品牌栏（左：赛博女友 / CYBER GIRLFRIEND，右：技术栈装饰条）
 *   · 分屏主体（左 ~38% 对话区 + 右 ~62% 数字人画布）
 *   · 左：对话引用流（最近 3 条，参考图叙事排版） + 状态行 + 输入栏
 *   · 右：AvatarCanvas + 双字幕条（用户上/小呆下，互不覆盖）
 *
 * 改动要点：
 *   · 不嵌入 ChatUI 组件（主视觉简化），输入框直接复用 useChat Hook（接口一致）
 *   · ChatUI 组件保留代码，作为完整聊天历史的入口（后续可挂抽屉）
 *   · 所有 hook（useAvatar/useVoice/useChat）接口不变
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import AvatarCanvas from './components/AvatarCanvas.tsx';
import CaptionBar from './components/CaptionBar.tsx';
import { createCaptionBuffer } from './components/caption-core.ts';
import useAvatar from './hooks/use-avatar.ts';
import useVoice from './hooks/useVoice.ts';
import { useChat } from './hooks/use-chat.ts';
import type { Emotion } from '../../avatar/clip-matcher.ts';

export default function App() {
  const avatar = useAvatar();

  // ---- 字幕（双缓冲：用户上/小呆下，互不覆盖）----
  const userCaptionBuf = useRef(createCaptionBuffer(200));
  const assistantCaptionBuf = useRef(createCaptionBuffer(200));
  const [userCaption, setUserCaption] = useState('');
  const [assistantCaption, setAssistantCaption] = useState('');

  // ---- AI 播放能量（驱动右侧数字人区域呼吸动效）----
  const [energy, setEnergy] = useState(0);

  // ---- 文本聊天（直接用 useChat，不嵌 ChatUI —— 主视觉简洁化）----
  const {
    messages: chatMessages,
    isLoading,
    inputValue,
    setInputValue,
    sendMessage,
  } = useChat({
    onReply: (r) => {
      if (r.ok) {
        // 文字回复同步到小呆字幕条（同时右侧数字人对话中也显示）
        assistantCaptionBuf.current.replace(r.reply);
        setAssistantCaption(assistantCaptionBuf.current.text);
      }
    },
  });

  // ---- 语音会话 ----
  const voice = useVoice({
    onSubtitle: (t) => {
      assistantCaptionBuf.current.append(t);
      setAssistantCaption(assistantCaptionBuf.current.text);
    },
    onUserTranscript: (t, delta) => {
      if (delta) return; // 增量转写不展示
      userCaptionBuf.current.replace(t);
      setUserCaption(userCaptionBuf.current.text);
    },
    onEmotion: (e: Emotion) => avatar.setEmotion(e),
    onEnergy: (e) => setEnergy(e),
  });

  // 发送文字消息
  const handleSendText = useCallback(() => {
    const text = inputValue.trim();
    if (!text || isLoading) return;
    // 用户说的话也显示在字幕上沿（与语音一致）
    userCaptionBuf.current.replace(text);
    setUserCaption(userCaptionBuf.current.text);
    void sendMessage(text);
  }, [inputValue, isLoading, sendMessage]);

  // 开始/结束语音
  const handleToggleVoice = useCallback(() => {
    if (voice.active) voice.disconnect();
    else void voice.connect();
  }, [voice]);

  // 键盘快捷键：Enter 发送 / Esc 关闭语音
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && voice.active) voice.disconnect();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [voice]);

  // 最近 3 条对话（参考图叙事引用排版）
  const recentMessages = chatMessages.slice(-3);

  return (
    <div className="app immersive-layout">
      {/* ============ 顶部品牌栏 ============ */}
      <header className="brand-bar">
        <div className="brand-mark-group">
          <div className="brand-mark">
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M11 1 L13 9 L21 11 L13 13 L11 21 L9 13 L1 11 L9 9 Z" fill="currentColor" />
            </svg>
          </div>
          <div className="brand-text">
            <div className="brand-cn">赛博女友</div>
            <div className="brand-en">CYBER GIRLFRIEND</div>
          </div>
        </div>
        <div className="brand-deco">
          <span className="deco-dot"></span>
          <span>Powered by Qwen Audio</span>
          <span className="deco-sep">·</span>
          <span>Hermes Agent</span>
          <span className="deco-sep">·</span>
          <span>v0.1.0</span>
        </div>
      </header>

      {/* ============ 主体分屏 ============ */}
      <main className="immersive-main">
        {/* ---- 左侧：对话内容 + 输入 ---- */}
        <aside className="content-panel">
          {/* 状态指示：语音活跃时高亮 */}
          <div className="state-line">
            <span className={`state-indicator ${voice.active ? 'on' : ''}`}></span>
            <span className="state-text">
              {voice.status === 'speaking' && '小呆正在说话…'}
              {voice.status === 'listening' && '我在听，慢慢说。'}
              {voice.status === 'idle' && !voice.active && '待机中 · 点麦克风或打字告诉我'}
              {voice.status === 'connected' && voice.active && '已连接 · 随时可以说'}
              {voice.status === 'error' && '出了点小问题…'}
            </span>
          </div>

          {/* 对话引用流：最近 3 条（参考图叙事排版） */}
          <div className="quote-flow">
            {recentMessages.length === 0 && (
              <div className="quote-empty">
                <span className="quote-mark">—</span>
                <p>没有对话记录。开始聊聊吧。</p>
              </div>
            )}
            {recentMessages.map((m) => (
              <div key={m.id} className={`quote ${m.role}`}>
                <span className="quote-mark">
                  {m.role === 'user' ? '>' : '—'}
                </span>
                <p className="quote-text">{m.text || '…'}</p>
              </div>
            ))}
          </div>

          {/* 底部状态 + 输入栏 */}
          <div className="bottom-area">
            <div className="status-row">
              <span>最近对话</span>
              <span className="status-count">{chatMessages.filter((m) => !m.pending).length} 条</span>
            </div>

            <div className="input-bar">
              <input
                className="text-input"
                placeholder={voice.active ? '边听边打字…' : '打字告诉小呆…'}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendText();
                  }
                }}
                disabled={isLoading}
              />
              <button
                className={`mic-btn ${voice.active ? 'on' : ''}`}
                onClick={handleToggleVoice}
                title={voice.active ? '结束语音（Esc）' : '开始语音'}
                aria-label="toggle voice"
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 10v2a7 7 0 0 0 14 0v-2" />
                  <path d="M12 19v3" />
                </svg>
              </button>
              <button
                className="send-btn"
                onClick={handleSendText}
                disabled={!inputValue.trim() || isLoading}
                title="发送（Enter）"
                aria-label="send"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12 L19 12" />
                  <path d="M13 6 L19 12 L13 18" />
                </svg>
              </button>
            </div>
          </div>
        </aside>

        {/* ---- 右侧：数字人画布 + 双字幕条 ---- */}
        <section className="avatar-panel" data-energy={Math.round(energy * 100)}>
          <AvatarCanvas
            state={avatar.state}
            emotion={avatar.emotion}
            library={avatar.library}
            loop={false}
          />
          <CaptionBar text={userCaption} tone="user" className="caption-top" />
          <CaptionBar text={assistantCaption} tone="assistant" className="caption-bottom" />
        </section>
      </main>
    </div>
  );
}

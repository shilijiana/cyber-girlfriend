/**
 * client/src/App.tsx —— 前端壳（2026-08-21 全屏沉浸版 · 语音/文字对话合并）
 *
 * 布局（老板指示 2026-08-21 两次更新）：
 *   · 整页播放数字人视频（全屏背景层），聊天框半透明浮层叠在视频上
 *   · 顶部品牌栏半透明悬浮
 *   · 【合并】语音字幕并入对话流：用户语音转写/小呆语音副文本都作为消息
 *     显示在同一个对话流里（与文字聊天统一），不再单独占字幕条
 *   · 【折叠】对话流可折叠：默认收起只显示最近 3 条，点"全部对话"展开全部历史
 *
 * 结构：
 *   · .app.fullscreen-layout
 *     ├── header.brand-bar（半透明悬浮品牌栏）
 *     └── main.avatar-stage（全屏数字人舞台）
 *         ├── AvatarCanvas（全屏视频）
 *         └── aside.chat-overlay（半透明玻璃聊天浮层）
 *             ├── .state-line（状态行 + 折叠按钮）
 *             ├── .quote-flow（合并对话流：文字 + 语音，可折叠）
 *             └── .bottom-area（最近对话计数 + 输入栏）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AvatarCanvas from './components/AvatarCanvas.tsx';
import { createMessageId } from './components/chat-core.ts';
import { guessEmotion, isEmotionCommand } from './components/emotion-guess.ts';
import useAvatar from './hooks/use-avatar.ts';
import useVoice from './hooks/useVoice.ts';
import { useChat } from './hooks/use-chat.ts';
import type { Emotion } from '../../avatar/clip-matcher.ts';

/** 语音会话产生的消息（并入对话流显示，与文字消息同构） */
interface VoiceMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  ts: number;
  /** 语音来源标记（渲染麦克风小标） */
  voice?: boolean;
  /** 正在说的流式消息（说话结束后定稿） */
  live?: boolean;
}

/** 折叠时显示的最近消息条数 */
const COLLAPSED_KEEP = 3;

export default function App() {
  const avatar = useAvatar();

  // ---- AI 播放能量（驱动数字人区域呼吸动效）----
  const [energy, setEnergy] = useState(0);

  // ---- 文本聊天（useChat：消息流 + /api/chat 发送）----
  // 2026-08-21：打字链路也驱动数字人情绪——发送时猜用户输入情绪，收到回复时猜回复情绪
  // （/api/chat 不推 emotion 事件，前端本地兜底；语音链路的 emotion 事件优先级更高，后到者覆盖）
  const { messages: chatMessages, isLoading, inputValue, setInputValue, sendMessage } = useChat({
    onReply: (r) => {
      if (r.ok) avatar.setEmotion(guessEmotion(r.reply));
    },
  });

  // ---- 语音会话（WS /ws/voice）→ 语音消息并入对话流 ----
  // 关键：Qwen Realtime 的 user transcript final 与 assistant audio_transcript delta 到达顺序
  //   不确定（race）——单靠 onUserTranscript 设锚点会晚于 asst delta，导致 asst 排到 user 前。
  //   改用 VAD speech_started 作为真正的轮次开始锚点（远早于任何 Qwen 处理后事件）：
  //     ① VAD true → 立即创建 user 占位消息（text=""），ts = seq+1，记 placeholderIdRef/lastUserTsRef
  //     ② asst delta 到 → ts ≥ placeholder+1，必排在 user 后
  //     ③ user transcript final 到 → 原地更新 placeholder text（ts 不变，保持位置）
  //     ④ VAD false 触发定稿或下一轮开始
  const [voiceMessages, setVoiceMessages] = useState<VoiceMsg[]>([]);
  const liveIdRef = useRef<string | null>(null); // 当前正在说的语音消息 id
  const seqRef = useRef(0); // 单调递增的逻辑时间戳
  const lastUserTsRef = useRef(0); // 最近一轮 user 占位 ts（asst 至少 user+1）
  const placeholderIdRef = useRef<string | null>(null); // 当前轮的 user 占位 id

  const nextSeqTs = useCallback(() => {
    seqRef.current = Math.max(seqRef.current + 1, Date.now());
    return seqRef.current;
  }, []);

  const commitVoice = useCallback((updater: (prev: VoiceMsg[]) => VoiceMsg[]) => {
    setVoiceMessages((prev) => updater(prev));
  }, []);

  const voice = useVoice({
    // 小呆语音副文本：流式写入一条 live 消息（无 live 则新建）
    // Qwen 的 audio_transcript.delta 是逐字增量片段，必须**追加**而非覆盖（否则只显示最后 1 字）
    // ts ≥ lastUserTsRef+1：保证排在 user 占位之后（VAD 锚点早于 asst delta，无 race）
    onSubtitle: (t) => {
      const id = liveIdRef.current ?? createMessageId('va');
      liveIdRef.current = id;
      commitVoice((prev) => {
        if (prev.some((m) => m.id === id)) {
          return prev.map((m) => (m.id === id ? { ...m, text: m.text + t } : m));
        }
        const ts = Math.max(nextSeqTs(), lastUserTsRef.current + 1);
        return [...prev, { id, role: 'assistant', text: t, ts, voice: true, live: true }];
      });
    },
    // 用户语音转写 final：原地更新 user 占位的 text（占位已由 VAD 创建），ts 不变保持位置
    onUserTranscript: (t, delta) => {
      if (delta) return; // 增量转写不展示
      const pid = placeholderIdRef.current;
      if (pid) {
        // 占位存在 → 原地填充（不会改 ts，位置不变）
        commitVoice((prev) => prev.map((m) => (m.id === pid ? { ...m, text: t } : m)));
        placeholderIdRef.current = null; // 本轮占位完成使命（asst 仍可能继续推）
      } else {
        // 无占位（VAD 未触发等异常路径）：降级为直接创建 user 消息
        const id = createMessageId('vu');
        const ts = Math.max(nextSeqTs(), lastUserTsRef.current + 1);
        lastUserTsRef.current = ts;
        commitVoice((prev) => {
          if (prev.some((m) => m.id === id)) return prev;
          return [...prev, { id, role: 'user', text: t, ts, voice: true }];
        });
      }
    },
    // VAD：用户开始说话（speech_started）→ 立即创建 user 占位，作为本轮时间锚
    onVadState: (speaking) => {
      if (!speaking) return;
      const id = createMessageId('vu');
      const ts = Math.max(nextSeqTs(), lastUserTsRef.current + 1);
      lastUserTsRef.current = ts;
      placeholderIdRef.current = id;
      commitVoice((prev) => {
        if (prev.some((m) => m.id === id)) return prev;
        return [...prev, { id, role: 'user', text: '', ts, voice: true }];
      });
    },
    onEmotion: (e: Emotion) => avatar.setEmotion(e),
    onEnergy: (e) => setEnergy(e),
  });

  // 说话结束（speaking → 其他状态）：把 live 消息定稿
  useEffect(() => {
    if (voice.status !== 'speaking' && liveIdRef.current) {
      const id = liveIdRef.current;
      liveIdRef.current = null;
      commitVoice((prev) => prev.map((m) => (m.id === id ? { ...m, live: false } : m)));
    }
  }, [voice.status, commitVoice]);

/** 合并后的对话消息（文字 + 语音统一形状，供渲染） */
interface MergedMsg {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  ts: number;
  voice?: boolean;
  live?: boolean;
  pending?: boolean;
}

// ---- 合并对话流：文字 + 语音，按时间排序；live 消息恒置顶末尾 ----
const mergedMessages = useMemo<MergedMsg[]>(() => {
  const live = voiceMessages.filter((m) => m.live);
  const rest = [
    ...chatMessages.map((m) => ({ id: m.id, role: m.role, text: m.text, ts: m.ts, pending: m.pending })),
    ...voiceMessages
      .filter((m) => !m.live)
      .map((m) => ({ id: m.id, role: m.role, text: m.text, ts: m.ts, voice: m.voice })),
  ].sort((a, b) => a.ts - b.ts);
  return [...rest, ...live];
}, [chatMessages, voiceMessages]);

  // ---- 折叠/展开：默认收起只显示最近几条 ----
  const [expanded, setExpanded] = useState(false);
  const visibleMessages = expanded ? mergedMessages : mergedMessages.slice(-COLLAPSED_KEEP);
  const totalCount = chatMessages.filter((m) => !m.pending).length + voiceMessages.filter((m) => !m.live).length;

  // 新消息自动滚动到底部
  const flowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = flowRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [visibleMessages.length]);

  // 发送文字消息
  const handleSendText = useCallback(() => {
    const text = inputValue.trim();
    if (!text) return;
    // 纯情绪切换指令（"切到开心"/"来点悲伤的"…）：本地切换，不受 isLoading 限制——
    // 不发 /api/chat（否则走 Hermes 8-9s 等待期输入/发送被锁），Hermes 处理中也随时可切
    if (isEmotionCommand(text)) {
      avatar.setEmotion(guessEmotion(text));
      setInputValue('');
      return;
    }
    // 正常聊天：等待回复中不重复发送
    if (isLoading) return;
    // 打字即驱动情绪（用户输入里带情绪词 → 数字人先切对应视频，等回复到达再微调）
    avatar.setEmotion(guessEmotion(text));
    void sendMessage(text);
  }, [inputValue, isLoading, sendMessage, avatar]);

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

  return (
    <div className="app fullscreen-layout">
      {/* ============ 顶部品牌栏（半透明悬浮） ============ */}
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

      {/* ============ 全屏数字人舞台（视频铺满整页） ============ */}
      <main className="avatar-stage" data-energy={Math.round(energy * 100)}>
        <AvatarCanvas state={avatar.state} emotion={avatar.emotion} library={avatar.library} loop={false} />

        {/* ============ 半透明聊天浮层（叠视频底部） ============ */}
        <aside className={`chat-overlay ${expanded ? 'expanded' : ''}`}>
          {/* 状态行 + 折叠按钮 */}
          <div className="state-line">
            <span className={`state-indicator ${voice.active ? 'on' : ''}`}></span>
            <span className="state-text">
              {voice.status === 'speaking' && '小呆正在说话…'}
              {voice.status === 'listening' && '我在听，慢慢说。'}
              {voice.status === 'idle' && !voice.active && '待机中 · 点麦克风或打字告诉我'}
              {voice.status === 'connected' && voice.active && '已连接 · 随时可以说'}
              {voice.status === 'error' && '出了点小问题…'}
            </span>
            <button
              className={`collapse-btn ${expanded ? 'on' : ''}`}
              onClick={() => setExpanded((e) => !e)}
              title={expanded ? '收起对话' : '显示所有对话'}
              aria-expanded={expanded}
            >
              {expanded ? '收起 ▴' : `全部对话 ${totalCount} ▾`}
            </button>
          </div>

          {/* 合并对话流：文字 + 语音（可折叠） */}
          <div className="quote-flow" ref={flowRef}>
            {visibleMessages.length === 0 && (
              <div className="quote-empty">
                <span className="quote-mark">—</span>
                <p>没有对话记录。开始聊聊吧。</p>
              </div>
            )}
            {visibleMessages.map((m) => (
              <div
                key={m.id}
                className={`quote ${m.role} ${m.voice ? 'voice' : ''} ${m.live ? 'live' : ''}`}
              >
                <span className="quote-mark">
                  {m.live ? <span className="live-dot" /> : m.role === 'user' ? '>' : '—'}
                </span>
                <p className="quote-text">{m.text || '…'}</p>
                {m.voice && <span className="voice-tag">语音</span>}
              </div>
            ))}
          </div>

          {/* 底部状态 + 输入栏 */}
          <div className="bottom-area">
            <div className="status-row">
              <span>最近对话</span>
              <span className="status-count">{totalCount} 条</span>
            </div>

            <div className="input-bar">
              <input
                className="text-input"
                placeholder={isLoading ? '小呆正在思考，可以先打字…' : voice.active ? '边听边打字…' : '打字告诉小呆…'}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSendText();
                  }
                }}
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
      </main>
    </div>
  );
}

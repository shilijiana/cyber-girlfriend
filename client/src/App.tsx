/**
 * client/src/App.tsx —— 前端壳（CL-03/04/05 集成版）
 *
 * 说明：完整聊天体验集成——
 *  - AvatarCanvas（CL-01）+ useAvatar（CL-02）：数字人画布（情绪事件驱动选片）
 *  - ChatUI（CL-03）：单一人设文字聊天（/api/chat）
 *  - CaptionBar（CL-04）：字幕条（subtitle 增量累积 / user_transcript 整段）
 *  - VoiceWaveform（CL-05）：情绪波形（AI 播放能量，经 useVoice onEnergy）
 *  - useVoice（CL-06）：语音会话状态机（/ws/voice）
 * 素材：avatar/manifest.json（AV-02 占位清单），缺素材自动降级卡通占位。
 */

import { useCallback, useRef, useState } from 'react';
import AvatarCanvas from './components/AvatarCanvas.tsx';
import ChatUI from './components/ChatUI.tsx';
import CaptionBar, { type CaptionTone } from './components/CaptionBar.tsx';
import VoiceWaveform from './components/VoiceWaveform.tsx';
import { createCaptionBuffer } from './components/caption-core.ts';
import useAvatar from './hooks/use-avatar.ts';
import useVoice from './hooks/useVoice.ts';
import type { Emotion } from '../../avatar/clip-matcher.ts';

export default function App() {
  const avatar = useAvatar();

  // 字幕缓冲（CL-04：AI 副文本增量累积 / 用户转写整段替换）
  const captionBuf = useRef(createCaptionBuffer(200));
  const [caption, setCaption] = useState('');
  const [captionTone, setCaptionTone] = useState<CaptionTone>('assistant');

  // 波形能量（CL-05：AI 播放能量 0~1）
  const [energy, setEnergy] = useState(0);

  const voice = useVoice({
    onSubtitle: (t) => {
      captionBuf.current.append(t);
      setCaption(captionBuf.current.text);
      setCaptionTone('assistant');
    },
    onUserTranscript: (t, delta) => {
      if (delta) return; // 增量转写不展示，最终完整转写整段显示
      captionBuf.current.replace(t);
      setCaption(captionBuf.current.text);
      setCaptionTone('user');
    },
    onEmotion: (e: Emotion) => avatar.setEmotion(e),
    onEnergy: (e) => setEnergy(e),
  });

  const handleToggleVoice = useCallback(() => {
    if (voice.active) voice.disconnect();
    else void voice.connect();
  }, [voice.active, voice.connect, voice.disconnect]);

  return (
    <div className="app chat-layout">
      <header className="app-header">
        <h1>赛博女友</h1>
        <p className="app-sub">语音陪伴 · 文本聊天 · 数字人 · 字幕 · 波形</p>
      </header>

      <main className="app-main">
        <section className="hero">
          <AvatarCanvas state={avatar.state} emotion={avatar.emotion} library={avatar.library} loop={false} />
          <CaptionBar text={caption} tone={captionTone} />
        </section>

        <ChatUI
          onReply={(r) => {
            if (r.ok) {
              captionBuf.current.replace(r.reply);
              setCaption(captionBuf.current.text);
              setCaptionTone('assistant');
            }
          }}
        />

        <div className="voice-dock">
          <VoiceWaveform energy={energy} active={voice.active} barCount={28} />
          <div className="voice-controls">
            <button className={voice.active ? 'btn active' : 'btn'} onClick={handleToggleVoice}>
              {voice.active ? '断开语音' : '开始语音'}
            </button>
            <button className="btn" onClick={voice.sendInterrupt} disabled={!voice.active}>
              打断
            </button>
            <span className="voice-status" data-state={voice.status}>
              {voice.status}
            </span>
          </div>
        </div>
      </main>
    </div>
  );
}

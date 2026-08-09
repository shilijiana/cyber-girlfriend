/**
 * client/src/App.tsx —— 前端壳（CL-01 配套：最小初始化演示页）
 *
 * 说明：当前仅挂载 AvatarCanvas 做数字人画布验收；
 * 其余 UI（ChatUI/CaptionBar/VoiceWaveform/useVoice 等）由 CL-03~09 后续接入。
 * 素材：读取 avatar/manifest.json（AV-02 占位清单），素材视频由 AV-03 后补，
 * 缺素材时画布自动降级为内置卡通占位（不黑屏）。
 */

import { useState } from 'react';
import AvatarCanvas from './components/AvatarCanvas.tsx';
import { toClipLibrary, type AvatarState } from './components/avatar-canvas-core.ts';
import type { Emotion } from '../../avatar/clip-matcher.ts';
import manifest from '../../avatar/manifest.json' with { type: 'json' };

const library = toClipLibrary(manifest);

const STATES: AvatarState[] = ['idle', 'speaking', 'listening'];
const EMOTIONS: Emotion[] = ['happy', 'gentle', 'serious', 'surprise', 'neutral'];

export default function App() {
  const [state, setState] = useState<AvatarState>('idle');
  const [emotion, setEmotion] = useState<Emotion>('happy');

  return (
    <div className="app">
      <header className="app-header">
        <h1>赛博女友 · 数字人画布</h1>
        <p className="app-sub">CL-01 AvatarCanvas · 素材占位（AV-03 后补）</p>
      </header>

      <main className="app-main">
        <AvatarCanvas
          state={state}
          emotion={emotion}
          library={library}
          loop={false}
        />

        <section className="app-controls">
          <div className="control-group">
            <span className="control-label">状态</span>
            {STATES.map((s) => (
              <button
                key={s}
                className={s === state ? 'btn active' : 'btn'}
                onClick={() => setState(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="control-group">
            <span className="control-label">情绪</span>
            {EMOTIONS.map((e) => (
              <button
                key={e}
                className={e === emotion ? 'btn active' : 'btn'}
                onClick={() => setEmotion(e)}
              >
                {e}
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

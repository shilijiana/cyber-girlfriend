# client · 前端 🌐

**职责**：赛博女友的"脸"——浏览器里的一切可见交互。

## 核心功能

| 目录/文件 | 说明 |
|-----------|------|
| `components/AvatarCanvas.tsx` | 数字人画布：素材 `<video>` 播放 / Live2D 兜底 |
| `components/CaptionBar.tsx` | 字幕显示（S2S 副文本） |
| `components/VoiceWaveform.tsx` | 情绪波形动画（AudioAnalyser 能量驱动） |
| `components/ChatUI.tsx` | 聊天界面（收敛单一人设） |
| `hooks/useVoice.ts` | 语音会话状态机：采集/播放/打断/状态 |
| `hooks/useAvatar.ts` | 素材播放控制 + 对齐 |
| `hooks/useChat.ts` | 文本聊天（调试/降级） |
| `voice/audio.ts` | getUserMedia 采集、播放、音频能量分析 |

## 关键约束

- **单一人设**：不再有多 Agent 切换（脚手架自带的简化为小呆一个角色）
- **语音优先**：主链路是语音（麦克风 + 播放），文本聊天仅调试/降级
- 数字人素材走静态 `<video>` 直接播放（无需 WebRTC/MSE）

## 与旧脚手架的关系

本模块由 `cybergirlfriend/src/` 迁移调整而来：
- ✅ 保留：React 18 + Vite 5 + TS + TDesign + Tailwind 技术栈
- 🔧 调整：多 Agent 界面 → 单一人设；新增 AvatarCanvas/CaptionBar/VoiceWaveform/useVoice

## 相关

- 数字人设计：DESIGN.md §5
- 架构总纲：`docs/architecture/overall-architecture.md`

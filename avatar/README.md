# avatar · 数字人 🎭

**职责**：赛博女友的"形象"——预生成短视频素材库 + 情绪匹配引擎，运行时**零 GPU**。

## 核心功能

| 文件 | 说明 |
|------|------|
| `clip-matcher.ts` | 素材匹配引擎（已实现，含单元测试）：情绪 → 子库 → 随机/轮换选片 → 拼接队列 |
| `emotion-matcher.ts` | 带会话状态的情绪匹配器（AV-04）：窗口避重、markPlayed、reset |
| `manifest.json` | 素材清单（权威源，入 git）：路径、情绪标签、时长 |
| `manifest.example.json` | 清单模板（含 downloadUrl 字段说明，供参考/后补素材时填写） |

## 素材结构（assets/avatars/，大文件不入 Git）

```
assets/avatars/
├── clips/                       # 说话片段（AV-03 已就位：Pexels 开源样片 6 段）
│   ├── anime_girl_1~3_pexels.mp4   # 动漫少女（happy/gentle/neutral）
│   └── girl_portrait_1~3_pexels.mp4 # 人像（serious/surprise/neutral）
├── cute_anime_girl_avatar_1~5_pexels.jpeg   # 卡通兜底（静态形象，占位 B）
├── happy_girl_portrait_colorful_1~3_pexels.jpeg
└── manifest.json                # 运行时副本（与 avatar/manifest.json 保持一致）
```

## 素材占位方案（AV-03，老板选定"先占位后补"）

- **占位 A · 开源样片 ✅**：Pexels 免费商用样片 6 段（已下载至 `assets/avatars/clips/`），验证"画布 + 匹配 + 切换"整条链路
- **占位 B · 卡通兜底 ✅**：Pexels 动漫形象图 8 张（静态形象 + 音频能量驱动口型，CL-01 降级用）
- **情绪标签说明**：当前 manifest 中 emotion 为**占位分配**（按文件名语义推测），后补真实素材时重新标注
- **后补真实素材**：云 GPU 渲染真实形象素材库后，直接替换 `assets/avatars/` 并更新 manifest——结构不变，**前端零改动**

## 关键约束

- **口型大致同步即可**：起点对齐 + 情绪匹配，不追逐帧对齐（老板已确认）
- **运行时零 GPU**：素材离线一次性准备，运行期只播放
- **素材不入 Git**：大文件忽略（.gitignore 仅放行 `manifest.json`），来源见 `manifest.example.json` 的 downloadUrl/license 字段

## 扩展点

- v2 可选增强：MuseTalk 实时口型 sidecar（需 GPU，接口预留）
- 无素材时降级：静态形象 + 音频能量口型（占位 B 素材）

## 相关

- 匹配引擎逻辑：DESIGN.md §5
- 架构总纲：`docs/architecture/overall-architecture.md`

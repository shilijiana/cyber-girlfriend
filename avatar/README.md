# avatar · 数字人 🎭

**职责**：赛博女友的"形象"——预生成短视频素材库 + 情绪匹配引擎，运行时**零 GPU**。

## 核心功能

| 文件 | 说明 |
|------|------|
| `clip-matcher.ts` | 素材匹配引擎（已预置，含单元测试）：情绪 → speaking 子库 → 随机/轮换选片 → 拼接队列 |
| `manifest.json` | 素材清单：路径、情绪标签、时长、嘴型活跃度 |

## 素材结构

```
assets/avatars/
├── idle/          # 不说话：眨眼、呼吸、微动（2-4 段，各 5-10s）
├── speaking/      # 说话姿态，按情绪分类：
│   ├── happy/     # 开心/撒娇（3-5 段）
│   ├── gentle/    # 温柔/安慰
│   ├── serious/   # 认真/办事
│   ├── surprise/  # 惊讶/卖萌
│   └── neutral/   # 中性（兜底）
├── listening/     # 倾听/点头（2-3 段）
└── manifest.json
```

## 关键约束

- **口型大致同步即可**：起点对齐 + 情绪匹配，不追逐帧对齐（老板已确认）
- **运行时零 GPU**：素材离线一次性生成（云 GPU 渲染 / 授权素材 / Live2D 预渲染），运行期只播放
- **素材不入 Git**：大文件忽略，由 `scripts/fetch-avatars.sh` 下载

## 扩展点

- v2 可选增强：MuseTalk 实时口型 sidecar（需 GPU，接口预留）
- 无素材时降级：Live2D / 静态形象 + 音频能量口型

## 相关

- 匹配引擎逻辑：DESIGN.md §5
- 架构总纲：`docs/architecture/overall-architecture.md`

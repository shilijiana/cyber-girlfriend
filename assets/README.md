# assets · 素材库 🎬

**职责**：数字人视频素材、音频、角色卡图片等大文件的存放地（大文件不入 Git）。

## 结构

```
assets/
└── avatars/                 # 数字人素材（大文件不入 Git；仅 manifest.json 例外入库）
    ├── clips/               # 说话片段（AV-03 已就位：Pexels 开源样片 6 段）
    │   ├── anime_girl_1~3_pexels.mp4    # 动漫少女
    │   └── girl_portrait_1~3_pexels.mp4 # 人像
    ├── cute_anime_girl_avatar_1~5_pexels.jpeg   # 卡通兜底（静态形象，占位 B）
    ├── happy_girl_portrait_colorful_1~3_pexels.jpeg
    └── manifest.json        # 运行时副本（权威源在 avatar/manifest.json）
```

## 约定

- **大文件不入 Git**：视频/图片素材全部忽略（.gitignore `assets/avatars/*`，仅放行 manifest.json），由老板手动下载 / 后补脚本拉取
- **清单权威源**：`avatar/manifest.json`（入 git）；`avatar/manifest.example.json`（含 downloadUrl/license 字段模板）；运行时加载 `assets/avatars/manifest.json`（同步副本，保持一致）
- **素材来源（AV-03 占位）**：Pexels 免费商用样片（License 见 `avatar/manifest.example.json`）
- **后补真实素材**：云 GPU 渲染替换 assets/avatars/ + 更新 manifest，前端零改动

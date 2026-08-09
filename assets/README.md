# assets · 素材库 🎬

**职责**：数字人视频素材、音频、角色卡图片等大文件的存放地。

## 结构

```
assets/
└── avatars/                 # 数字人素材（不入 Git）
    ├── idle/                # 不说话：眨眼、呼吸、微动
    ├── speaking/            # 说话姿态（按情绪分类）
    │   ├── happy/  gentle/  serious/  surprise/  neutral/
    ├── listening/           # 倾听/点头
    └── manifest.json        # 素材清单（模板入库 manifest.example.json）
```

## 约定

- **大文件不入 Git**：视频单文件可能 GB 级，全部忽略，由 `scripts/fetch-avatars.sh` 下载
- **清单模板入库**：`manifest.example.json` 含下载地址，真实素材本地拉取
- 开发期先用占位素材（开源授权样片 / 卡通形象 + 音频能量驱动口型）
- 后补真实素材：云 GPU 渲染替换 assets/avatars/，前端零改动

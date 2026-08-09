# AV-02 · manifest.json 素材清单设计（任务规格）

> **任务编号**：AV-02（avatar 模块，P0）
> **目标文件**：`avatar/manifest.json`
> **依赖**：无（AV-01 clip-matcher ✅ 已实现，本任务为其提供数据）
> **配套**：`docs/TASKS-CONFIG.md` §AV 模块、`docs/architecture/module-contracts.md` §2.5
> 更新日期：2026-08-09

---

## 1. 任务目标

设计并实现数字人素材清单 `avatar/manifest.json`——素材库的权威数据源，供 `clip-matcher.ts`（AV-01）加载使用。

## 2. 数据结构（必须对齐 AV-01 的 Clip 接口）

AV-01 的 `clip-matcher.ts` 已定义类型（**manifest.json 结构必须与之一一对应**）：

```ts
// avatar/clip-matcher.ts（已实现）
export type Emotion = 'happy' | 'gentle' | 'serious' | 'surprise' | 'neutral';

export interface Clip {
  id: string;            // 片段唯一标识
  emotion: Emotion;      // 情绪标签（5 选 1）
  durationSec: number;   // 片段时长（秒）
  src: string;           // 素材路径（相对 assets/avatars/）
}

export interface ClipLibrary {
  clips: Clip[];         // 全部片段
}
```

**manifest.json 结构**（与 ClipLibrary 一致）：

```json
{
  "version": 1,
  "clips": [
    {
      "id": "happy_01",
      "emotion": "happy",
      "durationSec": 5.2,
      "src": "clips/happy_01.mp4"
    }
  ]
}
```

## 3. 设计要点

1. **五情绪覆盖**：happy / gentle / serious / surprise / neutral 每种情绪至少 1 个片段（**先用占位条目**，素材文件 AV-03 后补）
2. **时长合理性**：每个片段 3~10 秒为宜（对话场景：短片段更适合轮换，长片段适合长句回复）
3. **src 路径约定**：相对 `config.avatar.assetsPath`（=`assets/avatars/`），视频文件放 `assets/avatars/clips/`（gitignore，由 AV-03 下载/老板提供）
4. **嘴型活跃度**（可选扩展字段，P2）：`lipActivity?: 'high'|'medium'|'low'`——标注片段说话嘴型活跃程度，供 CL-01 对齐字幕节奏（AV-02 可先只做基础字段，留扩展位）
5. **版本字段**：`version: 1` 便于后续演进

## 4. 验收标准（自检）

| # | 验收点 | 自检方法 |
|---|--------|----------|
| 1 | 结构合法 | JSON 可被 `JSON.parse` 解析 |
| 2 | 对齐 Clip 接口 | 每个 clip 含 id/emotion/durationSec/src 四必填字段 |
| 3 | 情绪全覆盖 | 5 种情绪每种至少 1 条占位条目 |
| 4 | 可被 clip-matcher 消费 | `createClipMatcher(loadManifest()).pickClip('happy', [])` 返回非 null |
| 5 | 校验脚本 | 写一个 `avatar/manifest-check.ts` 临时脚本验证（跑完可删） |

## 5. 参考：加载方式（供 CL-01/useAvatar 使用）

```ts
// 前端/服务端加载 manifest 的约定路径（config.avatar.assetsPath 下）
// 服务端已有 loadAvatarStatus 读它（app/server/routes.ts）
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { config } from '../config/loader.ts';

export function loadManifest(): ClipLibrary {
  const p = resolve(process.cwd(), config.avatar.assetsPath, 'manifest.json');
  return JSON.parse(readFileSync(p, 'utf-8'));
}
```

> ⚠️ 注意：manifest.json **入 git**（它是元数据不是大文件）；视频素材文件**不入 git**（gitignore，AV-03 处理）。

## 6. 边界与红线

- ✅ 只产出 `avatar/manifest.json`（+ 可选临时校验脚本），不写 clip-matcher 代码（那是 AV-01 已交付）
- ✅ 无持久化、无业务逻辑（红线 1）；纯数据文件
- ⚠️ 素材视频文件（mp4）不入库，由 AV-03（占位方案）/老板提供

---

*AV-02 manifest 规格 v1.0 · 2026-08-09 · M3 第一个任务（无依赖可立即开工）*

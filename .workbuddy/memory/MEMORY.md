# 赛博女友 · 项目长期记忆

## 核心架构定位（2026-08-09 老板明确，最高优先级）

- **赛博女友 = 纯交互界面**：只做语音问答（人设 + 数字人 + 字幕），**不建数据库、不做持久化、不存本地记忆**
- **具体事务 → Hermes 负责**：Hermes agent 自带记忆系统与 50+ 工具，记忆/事务状态全归 Hermes，赛博女友侧零持久化
- 架构：Qwen-Audio-3.0-Realtime-Flash（云端语音壳）+ Hermes Agent（本机大脑），Function Calling 中转（路径 A 推荐）
- 架构总纲：`docs/architecture/overall-architecture.md`（v1.1）；模块契约：`docs/architecture/module-contracts.md`（v1.2）；决策记录：`docs/adr/README.md`（7 条 ADR）；优化报告：`docs/architecture/optimization-report.md`

## 架构优化要点（2026-08-09 ADR-007）

- **persona 归 Hermes**：赛博女友只保留 `PersonaProvider` 接口（listPersonas/getPersona/buildInstructions/switchPersona），人设数据由 Hermes 维护，不存本地角色卡文件
- **APIKEY 集中配置**：`config/apikeys.json`（gitignore）+ `config/apikeys.example.json`（入库）+ `config/loader.ts`（文件优先、环境变量兜底）
- **轻量化**：运行时依赖 13→5-6 个（删 SDK/DB/router/TDesign全家桶/uuid），总代码 ~5316→~1003 行（-81%），全部纯 JS 零原生编译

## 人设文件化 + 记忆隔离（2026-08-09 ADR-008，老板拍板）

- **Hermes 评估报告**：`docs/research/hermes-capabilities-review.md`（Hermes agent 亲自评估 + 实测数据）
- **人设文件化**：权威数据 `~/AppData/Local/hermes/profiles/cyber-girlfriend/personas/`（personas.json + active.txt + card.md + memory.md），赛博女友 FilePersonaProvider fs.readFile 直读，毫秒级切换
- **人设分区记忆**：每个人设一套 card+memory，切换人设=切换记忆；先做"新对话时切换"，热切换 P2
- **记忆双向隔离**：专用 profile `cyber-girlfriend`（无 MEM0 key + memories/ 空 + `-t` 白名单），与主 profile/mem0 互不污染
- **工具白名单**：runner 固定 `-t terminal,file,web` + AGENTS.md 行为守则（堵免审批风险）
- **废弃**：原 HermesPersonaProvider（LLM 临场编 JSON）→ 替换 FilePersonaProvider
- **实测基线**：hermes -z 冷启动 12~23s；`--resume` 续上下文 20.5s；ACP 常驻为 P1 治本方案（延迟 2-5s）

## 三文档工作流（2026-08-09 建立）

- **项目协作基础设施**：四份核心文档管理项目全生命周期
  - `docs/BLUEPRINT.md`：项目蓝图（一站式入口，架构自解释）
  - `docs/TASKS.md`：任务看板（M0~M5 全模块任务，含 ID/优先级/依赖/验收标准）
  - `docs/DEVLOG.md`：开发日志（按时间倒序记录进度/决策/阻塞）
  - `docs/WORKFLOW.md`：工作流规则（接任务→读文档→干活→写日志→更看板）
- 任务 ID 规则：VS/BR/PS/AV/AP/CL/DC/M{X} 前缀 + 序号
- 状态：📋TODO / 🔄IN PROGRESS / ✅DONE / 🚫BLOCKED / ⏸PAUSED
- 优先级：P0阻塞 / P1核心 / P2增强 / P3延后
- 接口变更必须先改 module-contracts.md 再写代码

## 数字人素材规范（2026-08-18 老板明确）

- **背景必须深色暖调**（深棕/暗褐 + 金色 bokeh + 烛光），与网页暗色主题融合
- **形象锚点**（2026-08-18 老板拍板）：白色蕾丝方领连衣裙 + **小米珍珠锁骨链 + 珍珠小耳钉**（珍珠系，最贴合淑女风人设；之前"白色头戴耳机"被否）。后续所有肖像/视频素材必须沿用此形象
- **素材方向（2026-08-20 老板明确）**：所有图片/视频**一律横屏 16:9**（不再用竖屏）。AI 图生视频时输入图用 v2 主视觉（`cyber_final_v2.jpg` 4096×2300 缩到 1280×720），自然沿用横屏构图
- **工具栈**：HY-Image（混元）图生图（AI 图/插画参考可过审，真实照片会被身份保护拦截）→ **裁剪法去水印（必须先做！u2netp 会把水印当人物保留）** → Real-ESRGAN ncnn-vulkan 4x + PIL Lanczos 2x（本地超分到 8K 6144×7712）→ rembg 抠图（u2netp 4.7MB，768×964 仅 0.9 秒）+ PIL alpha_compose 贴回统一背景
- **视频链路**（2026-08-18 定型）：HY-Image VideoGen（image-to-video）→ **imageio-ffmpeg 裁水印**（自带 ffmpeg 二进制，免系统安装）→ **RVM（PeterL1n/RobustVideoMatting）mobilenetv3 ONNX 抠视频 alpha**（`rvm_mobilenetv3_fp32.onnx` 14.9MB，CPU 推理 121 帧仅 17s） + chroma 合成 `com = frame*pha + bg*(1-pha)`（脚本 `人物模型/rvm_compose.py`，支持 skip_inpaint 参数）
- **HY-Image 单次出图上限 768×1024**，无论请求多大尺寸；水印自动加，无法关
- **背景一致性方案**（2026-08-18 定调，2026-08-19 升级）：AI 生成的背景每次都不同，**像素级一致靠后处理**——所有情绪图/视频共用**一张纯背景图**：① 图片：rembg 抠人物 + 贴统一背景；② 视频：RVM 抠 pha + 合成。**纯背景图来源（2026-08-19 定型）**：AI 直接生成"无人物纯背景图"（深色暖调+烛光+bokeh，比定妆照 inpaint 人物更自然省时）；备选：定妆照 Laplace inpaint 人物区
- **光感匹配**：生成背景时保持"左侧烛光+右侧金色 bokeh"与人物光照方向一致，合成才自然（背景图：`人物模型/test_bg_crop.jpg`）
- **去水印陷阱**：u2netp 抠图会把 HY-Image 输出的"AI生成/WORKBUDDY"水印当成主体边缘保留 → **必须先裁水印再抠图合成**，否则水印残留

## 项目红线（老板明确指示，不可违反）

1. **🔧 无记忆/无数据库**：赛博女友侧零持久化，记忆与事务归 Hermes（ADR-006）。
2. **🚫 测试框架与 CI 暂停**：Vitest/Playwright/GitHub Actions 搁置（旧任务已封存），恢复时按新架构重写。
3. **方案先确认再动手**：重大变更先出方案给老板评审。
4. **称呼**：用户为"老板"，我（小呆）是老板的架构负责人兼助理。
5. **🔧 环境搭建已恢复**：~~环境搭建永久暂停~~（ADR-005）2026-08-09 撤销，子任务可按需安装依赖，但仍守轻量化约束（ADR-007）。

## 角色边界（2026-08-09 老板再次明确，最高优先级）

- **小呆 = 整体架构负责人，只管两件事**：① 下达任务（用 WORKFLOW §4.5 派活模板派给子代理/模块开发者）② 看任务进度（维护 TASKS.md 看板 + 汇总汇报给老板）
- **🚫 不负责子任务开发**：不写子模块代码、不做子任务实现。开发由各功能模块的子代理/开发者完成
- **M1 开工 = 用派活模板把 AP-01/BR-01/PS-01 等任务派出去**，然后盯进度、汇总结论，而不是自己动手写
- 与"总体架构负责人"角色一致（2026-08-09 早前已确认）：把握架构方向、安排任务、看执行、做汇总

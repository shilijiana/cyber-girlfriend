# Qwen3-Omni 调研笔记

> 调研日期：2026-08-09（追加 Qwen-Audio-3.0-Realtime 对比，同日）
> 目的：为「赛博女友」项目评估 Qwen3-Omni 作为语音对话内核的可行性 —— 角色卡注入 + 语音进语音出 + 实时性
> 配套文档：DESIGN.md §18（架构方案）、PROJECT_MEMORY.md
> **更新：老板 2026-08-09 提出 Qwen-Audio-3.0-Realtime-Flash 可能更合适（见 §9 对比结论）**

---

## 1. 模型概述

**Qwen3-Omni** 是阿里通义千问团队 2025-09-26 发布的开源原生端到端全模态大模型（Apache 2.0），支持**文本、图片、音频、视频**输入，**文本 + 自然语音**流式输出。

| 项目 | 数据 |
|---|---|
| 参数量 | 30B-A3B MoE（Thinker 30B / 每步激活 3B；Talker 3B / 0.3B） |
| 架构 | Thinker-Talker 双模块 + MoE + 多码本自回归 |
| 音频编码器 | AuT（0.6B，2000 万小时音频训练） |
| 文本语言 | 119 种 |
| 语音识别 | 19 种（含中文、粤语） |
| 语音合成 | 10 种 |
| 长音频 | 最长 30 分钟连续音频理解 |
| 许可 | Apache 2.0（可商用、可自托管） |

**三代演进（对比）**：

| | Qwen2.5-Omni | Qwen3-Omni | Qwen3.5-Omni |
|---|---|---|---|
| 时间 | 2025.03 | 2025.09 | 2026.03.30 |
| 规模 | 7B | 30B-A3B | 未公开 |
| 上下文 | - | 32K（本地）/ 65K（flash 云端） | 256K |
| 开源 | ✅ Apache 2.0 | ✅ Apache 2.0 | ❌ 闭源仅 API |
| 语音识别 | - | 19 种 | 113 种 |
| 语音生成 | - | 10 种 | 36 种 |
| 亮点 | 首个开源全模态 | 可本地部署、211ms | 215 项 SOTA、音视频 Vibe Coding |

> 结论：老板指定 Qwen3-Omni 且"不需要太高智商" → 聚焦 **Qwen3-Omni-Flash**（云端）或本地 30B-A3B。

---

## 2. 语音对话原理：为什么它不会"乱说"

### 2.1 端到端管线（听 → 想 → 说）

```
你的语音 → AuT 音频编码 → 语义 token → Thinker 思考 → 文本 token + 隐藏状态
                                                          ↓            ↓
                                                        字幕（文字）   Talker 发声 → 语音流
```

1. **AuT 音频编码器**：把语音波形编码成"语义 token"——即"听懂"（不是 STT 转文字，是直接编码成模型内部语义表示）。
2. **Thinker 思考器**：基于语义 token + 角色卡 + 历史对话，自回归逐字推理，决定"该说什么"（输出文本 token）。
3. **Talker 发声器**：接收 Thinker 的隐藏状态，多码本自回归逐帧生成语音 token，Code2Wav 渲染成波形。
4. **双通道输出**：同一时刻输出语音流 + 文本流（字幕就是 Thinker 的"想法"）。

### 2.2 为什么不会乱说

- 它内部**真的理解了语义**（AuT 是 2000 万小时音频训练出来的），只是没有把"听懂的文字"显式暴露给你。
- 说出口的内容 = Thinker 基于输入（语音语义 + 角色卡 + 历史）推理的结果，**有依据、有上下文**。
- 类比：真人打电话，耳朵听 → 大脑直接理解语义（不打印文字稿）→ 想好怎么回 → 嘴巴说。全程无文字稿，但绝不是乱说。
- 实力背书：36 项音视频基准中 32 项开源 SOTA、22 项总体 SOTA；ASR 与语音对话能力对标 Gemini 2.5 Pro。

### 2.3 Thinker-Talker 详解（重点）

**Thinker（思考器）= 一个能吃"声音+画面+文字"的大模型**：
- 输入：混合 token 流（音频语义 token / 文本历史 / 角色卡 system prompt / 可选图像视频）
- 工作方式：自回归逐字生成（一次吐一个 token，加入输入再预测下一个）
- 内部结构：MoE 稀疏架构 —— 门控路由 + 专家层 ×N，每步只激活 3B/30B → 有 30B 的"见识"、花 3B 的算力
- 输出：文本 token 流（= 字幕）+ 隐藏状态（喂给 Talker）

**Talker（发声器）= 照着 Thinker 的"想法"配音**：
- 不自己编内容，接收 Thinker 的隐藏状态生成语音
- 多码本自回归：每步生成一个 codec 帧，MTP 模块输出残差码本，Code2Wav 逐帧合成波形
- 每生成 80ms 语音立即返回 → **边想边说边播**，这就是低延迟的关键

> **对项目的意义**：Thinker 吃"角色卡设定"（system prompt），所以**换角色卡 = 换人格**，不用动模型本身。

---

## 3. 角色卡支持（核心需求）

### 3.1 怎么输入角色卡

**走 System Prompt**（Qwen3-Omni 官方明确支持 system prompt 定制人设/风格/行为）。

```python
messages = [
  { "role": "system", "content": "你是小呆，18岁AI少女，活泼爱撒娇但做事靠谱..." },
  { "role": "user", "content": [
      {"type": "input_audio", "input_audio": {"data": "<音频URL或base64>", "format": "wav"}},
      {"type": "text", "text": "（可选）文字指令"}
  ]}
]
```

**⚠️ 关键坑**：
- **Qwen-Omni-Turbo 不支持 System Message 角色设定**（官方文档明确：输出音频时设"你是XXX"无效，自我认知仍是千问）
- **Qwen3-Omni-Flash-2025-12-01 全面开放 System Prompt 自定义** ✅（官方博客确认支持甜妹/御姐/日系等人设风格）
- 结论：**只用 Flash（或 Qwen3.5-Omni），Turbo 直接排除**

### 3.2 角色卡可以多大

| 项目 | 数值 |
|---|---|
| 上下文总容量（flash） | 65,536 tokens |
| 单次输入上限 | ≤49,152 tokens |
| 单次输出上限 | ≤16,384 tokens |
| 角色卡典型大小 | 几百 ~ 2K tokens（中文约 1 字 ≈ 1 token） |

> 结论：角色卡写 2-3K tokens（几千字）只占窗口很小部分，SillyTavern 社区卡一般也就这个量级，完全够用。

---

## 4. 记忆机制：会不会覆盖？要不要重新输入？

**核心概念：Qwen3-Omni 是"无状态"的——自己什么都不存，每轮都要重新喂全部上下文。**

### 4.1 工作机制

```
每次请求 = [角色卡（永远最前）] + [历史对话（滑动窗口）] + [当前语音]
```

- 模型"看完就忘"，我们后端负责把上下文拼好、每轮重发
- 窗口内全记得：flash 65K tokens ≈ 中文几万字对话，正常聊天能聊很多轮
- **会"忘"**：窗口塞满后最老的消息被挤掉（类似人类记忆变淡）

### 4.2 需要做的记忆管理（项目侧）

1. 角色卡永远放最前面，永不丢弃
2. 对话历史滑动窗口（保留最近 N 轮）
3. 超窗早期对话 → 摘要压缩成"记忆档案"再注入（这就是 DESIGN 里"长期记忆"模块的用武之地）

### 4.3 多轮对话的 API 限制

- **Assistant 消息只能纯文本**（不能带音频）
- **User 消息**：一条可含文本 + 一种模态（音频/图片/视频），多轮中可交替不同模态
- 音频文件上限：flash 单文件 ≤100MB / 最长 20 分钟；Base64 编码后 <10MB；格式 AMR/WAV/3GP/3GPP/AAC/MP3

---

## 5. 性能与延迟：会不会"说一句等 10 秒"？

**不会。官方实测 211ms，比人类反应时间（~250ms）还快。**

| 场景 | 延迟 |
|---|---|
| 音频对话（纯模型端到端） | **211ms** |
| 冷启动首包（含 CUDA 初始化） | 234ms |
| 视频对话 | 507ms |

### 5.1 两种部署的实际体验

**路线 A：本地部署（vLLM）**
- 麦克风采集 ~20-50ms + 模型 211ms + 流式回放 → **总体验约 300-400ms**
- 相当于真人面对面，无等待感

**路线 B：云端 API（DashScope）**
- 上传语音（50-200ms）+ 服务端推理 + 流式回传 → **首包约 0.5-1.5s**
- 正常对话节奏，远未到 10s

### 5.2 为什么快：流式输出

Talker 每生成 80ms 语音立即回传一截，边想边说边播——你听到第一声"嗯"时它后面的话还没想完。不是"录完→传完→想完→播完"的排队模式。

> 导致 10s 卡顿的只有：网络极差 / 一次喂超长音频 / 服务端排队 —— 设计上可规避（本地零网络；云端走国内节点）。

### 5.3 建议：动手前先做延迟实测

申请 DashScope API Key，写脚本实测"说一句 → 听到第一声"真实耗时，比官方数据靠谱。

---

## 6. 部署路线对比

| 维度 | 路线 A：云端 DashScope（推荐起步） | 路线 B：本地 vLLM |
|---|---|---|
| 模型 | `qwen3-omni-flash`（2025-12-01 快照） | `Qwen3-Omni-30B-A3B-Instruct` |
| 硬件 | 无需 GPU，只要 API Key | 40GB+ 显存（2×A100 实测峰值 144GB BF16） |
| 延迟 | 首包 0.5-1.5s | 211ms |
| 上下文 | 65,536 tokens | 32,768 tokens |
| 音频输入 | ≤100MB / 20 分钟/次 | 支持流式多轮 |
| 多轮历史 | assistant 只能纯文本 | 完整音频多轮 |
| 成本 | 按 token 计费（有 100 万 token 免费额度，90 天） | 电费 + 硬件 |
| 隐私 | 音频过阿里云 | 完全本地 |
| 调用方式 | OpenAI 兼容格式，`stream=True` 必开 | vLLM OpenAI 兼容 /v1 |

**计费参考（Qwen3-Omni）**：
- 文本输入：约 $0.25 / 百万 token
- 音频输入：约 $2.21 / 百万 token（音频按时长换算，较贵）
- 文本+音频输出：约 $8.76 / 百万 token（仅音频部分）

> 结论：老板 Windows 本机大概率无 40G 显存 → **云端 Flash 起步**；本地部署作为后续可选。

---

## 7. 相关开源项目参考

| 项目 | ⭐ | 技术栈 | 参考价值 |
|---|---|---|---|
| **SillyTavern** | 31.8k | Node.js | 角色卡生态最大、chara_card_v2 事实标准；但语音是 TTS 后处理非 S2S，AGPL-3.0 |
| **Qwen3-Omni 官方仓库** | 3.9k | Python（Gradio + vLLM） | 底层调用方式、流式语音、官方 demo、WebSocket Realtime |
| **Qwen3-Omni-Simple-WebUI**（hama-jp） | - | Python FastAPI + openai SDK | 浏览器麦克风 → DashScope → 语音回复，云端接入最简参考 |
| **run-qwen3-omni**（kissazi2） | - | Node.js + Vite | 多供应商 + VAD + 多音色 + 会话管理（Node 栈与我们一致） |
| **gouzi**（jingangdidi） | - | Rust 单文件 18MB | 证明"prompt 注入角色"可行，自带 prompts 字段 |
| **SGLang-Omni Playground** | - | FastAPI + JS + SGLang | 浏览器 AudioWorklet 采集 + WebSocket 流式架构 |
| **MiniCPM-o 4.5** | - | Python | 9B 端侧备选（11GB int4），支持音频 system prompt 角色扮演；非 Qwen 系，不主推 |
| **OpenAvatarChat**（Jackjet） | - | Python | 数字人 + Qwen-Omni handler，后续数字人集成参考 |

---

## 8. 对「赛博女友」项目的落地建议

### 8.1 推荐架构（延续 TS 单栈决策）

```
浏览器（麦克风采集 + 语音播放 + 字幕显示）
    │ WebSocket（音频上行 + 控制 + 流式下行）
    ▼
Express 后端
 ├─ 角色卡解析器（chara_card_v2 → system prompt）
 ├─ Prompt 组装器（角色卡 + 历史滑动窗口 + 摘要归档）
 ├─ Qwen Omni 客户端（OpenAI 兼容，stream=True，modalities=["text","audio"]）
 └─ 流式转发（音频 chunk + 字幕事件）
```

### 8.2 待老板拍板

1. **云端 vs 本地**：默认云端 `qwen3-omni-flash`（免 GPU、便宜、接入快）；本地需 40GB+ 显存
2. **前端形态**：现有 cybergirlfriend 加页面 vs 独立小应用（极简 HTML/JS 最快跑通）
3. **角色卡来源**：先做"小呆"卡 vs 老板提供现成卡
4. **角色卡格式**：复刻 chara_card_v2（兼容社区生态）vs 自定义精简格式
5. **是否先做延迟实测**（需要 DASHSCOPE_API_KEY）

---

## 9. Qwen-Audio-3.0-Realtime 对比（老板 2026-08-09 提出，追加调研）

> 老板直觉：Qwen-Audio-3.0-Realtime-Flash 可能比 Qwen3-Omni 更适合。**调研确认：老板判断正确，作为首选推荐。**

### 9.1 模型简介

**Qwen-Audio-3.0-Realtime**（2026-07-15 发布，前身 Fun-Realtime-AudioChat）—— 阿里云**专为实时语音对话打造**的端到端语音模型，不是全模态（专注音频），目标是"又快又聪明"。Plus（推理强）+ Flash（速度快）两个版本。

**核心卖点**：
- **毫秒级响应**：官方时延压到 **120ms 以内**（比 Qwen3-Omni 的 211ms 更快）
- **全双工对话**：内置多模态感知双工控制子模型，"边说边听"，**用户可随时打断/插话**；抗环境噪声误触发、多人场景锁定主对话人、多说话人平滑切换
- **情感化语音**：动态调整语气/节奏/音调/情感，能模拟笑声、叹息等副语言信号；角色扮演时按设定切换说话风格与用词（历史人物/职业身份）
- **Agent 原生工具调用**：FunctionCall 标准协议，支持 MCP / API / 知识库接入；调用结果自动融入对话记忆，追问可衔接
- **音色克隆**：API 预留 `audio_prompt` 字段，上传音频样本可锁定说话人声纹 / 定制专属声线；预置 Vivian / Emma / Ryan / Jack 四款基础音色

**技术底子**：On-Policy Distillation（文本大模型推理能力蒸馏进语音模型，实时纠正）+ 多教师蒸馏（口语/通用/Agentic/音频理解四位教师不偏科）。

**Benchmark**：VoiceBench Plus 92.5（标准）/90.5（口语化），口语化只降 2.0 分（扛得住真人随意说话）；AudioMultiChallenge Flash 43.6/38.1；VStyle（S2S 语音指令遵循）SOTA；Preview 版 Artificial Analysis 语音推理 97.6%、对话流畅度 97.8% 双第一（超 GPT-Realtime-2 High）。

**价格（按 token，音频统一折算）**：
| 版本 | 输入 | 输出 |
|---|---|---|
| Plus | ¥5 / 百万 token | ¥40 / 百万 token |
| Flash | ¥3 / 百万 token | ¥30 / 百万 token |

### 9.2 角色卡 / 人设注入：instructions 参数（关键！）

- Realtime API 通过 **`instructions` 系统消息字段设定角色**（官方示例："你是某五星级酒店的 AI 客服专员，请准确且友好地解答…"）—— **支持角色扮演设定** ✅
- 上下文管理：`conversation.item.create` 事件可插入 **system / user / assistant** 三种类型的对话项，可注入历史对话、系统指令、历史 function call 记录；`previous_item_id` 支持任意位置插入 ✅
- 输出模态：`modalities` 支持 `["text"]` 或 `["text","audio"]`（语音+文字双输出）✅
- VAD 模式：`server_vad`（声学检测）/ `semantic_vad`（语义检测，滤无意义语音）；可调静音阈值与时长
- 输入转录：`enableInputAudioTranscription`（qwen3-asr-flash-realtime）可把用户语音转文字

### 9.3 接入方式（WebSocket 实时）

```
wss://{WorkspaceId}.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen-audio-3.0-realtime-flash
Authorization: Bearer <DASHSCOPE_API_KEY>
```

- 输入：PCM 16kHz 单声道 16bit 流式
- 输出：PCM 24kHz 单声道 16bit 流式（语音）+ 文本事件
- 客户端事件：`conversation.item.create`（插历史/系统指令）、`session.update`（更新配置）、`input_audio_buffer.append`（音频流）等
- 服务端事件：`speech.started`（可做打断清缓冲）、`audio.delta`（语音流）、`response.output_text.done`（完整文本）等

### 9.4 Qwen-Audio-3.0-Realtime vs Qwen3-Omni（选型对比）

| 维度 | **Qwen-Audio-3.0-Realtime**（老板意向） | Qwen3-Omni（前选） |
|---|---|---|
| 发布 | 2026-07-15（新） | 2025-09-26 |
| 定位 | **纯实时语音对话**（专注） | 全模态（文本/图/音/视频） |
| 时延 | **<120ms** | 211ms |
| 双工 | **全双工，可打断/插话/抗噪/多人** | 单工为主（对讲机式） |
| 情感/共情 | **强**（情绪、副语言、音色克隆、风格切换） | 有但弱于专用款 |
| 角色设定 | **instructions 字段直接支持** ✅ | system prompt 支持（flash 2025-12-01 起） |
| 工具调用 | **原生 FunctionCall + MCP/API/知识库** ✅ | 支持 function call（弱） |
| 多模态 | 仅音频 | 文本+图+音+视频 |
| 上下文 | 通过 conversation.item 管理（Realtime 会话） | 65K tokens（离线 API） |
| 成本 | Flash：入 ¥3 / 出 ¥30 每百万 token | flash：文本 $0.25/M、音频 $2.21/M、音频输出 $8.76/M |
| 开源 | 闭源（API only） | Apache 2.0 开源可自托管 |

### 9.5 结论：Qwen-Audio-3.0-Realtime-Flash 更适合本项目

老板判断正确，理由：
1. **需求匹配**：我们要的是"语音进 → 语音+文字出、实时、可打断"，这正是 Qwen-Audio-3.0-Realtime 的看家本领；Qwen3-Omni 的全模态（图像/视频）我们用不上。
2. **延迟更低**：<120ms vs 211ms，双工交互（像真人对话，不像对讲机）。
3. **情感陪伴体验好**：项目叫"赛博女友"，情感表达、音色克隆、风格切换正是核心体验；官方场景直接列了"娱乐互动与情感陪伴"。
4. **角色注入直接**：instructions 字段官方示例就是设定角色，无 Qwen-Omni-Turbo 那种"不支持 system message"的坑。
5. **Agent 能力预留**：原生 FunctionCall + MCP 接入，后续"女友帮干活"（Hermes/工具调用）天然支持。
6. **成本可接受**：Flash ¥3/¥30 每百万 token，个人聊天量级很便宜。

> **注意权衡**：Qwen3-Omni 开源可本地部署（隐私/离线），Qwen-Audio-3.0-Realtime 仅 API（数据过云）。若不介意云端，推荐 **Qwen-Audio-3.0-Realtime-Flash 作为 S2S 主选**，Qwen3-Omni 降为备选。

### 9.6 待确认

- [ ] 老板确认主选 Qwen-Audio-3.0-Realtime-Flash？（默认：是）
- [ ] 需要 DASHSCOPE_API_KEY 做延迟/效果实测（instructions 角色注入 + 打断体验）
- [ ] 音色选择：预置 Vivian/Emma/Ryan/Jack or 自定义克隆

---
*调研整理：2026-08-09 · 小呆（v2，追加 Qwen-Audio-3.0-Realtime 对比）*

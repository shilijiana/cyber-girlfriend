# 豆包实时语音模型 3.0（Seeduplex）调研报告

> **报告日期**：2026-08-09
> **项目**：赛博女友（Cyber Girlfriend）—— AI 数字人语音陪伴应用
> **调研目的**：评估豆包实时语音模型 3.0（Seeduplex）作为语音对话内核的可行性，与 Qwen-Audio-3.0-Realtime 对比选型
> **结论先行**：Seeduplex 是**全双工端到端**的强竞争者，三大优势（精准遵循/抗干扰/动态判停）+ 原生工具调用很亮眼，但**目前仅 API 邀测制**、文档零散、角色设定能力待实测 —— 详见 §6 对比与建议

---

## 1. 模型概述

**豆包实时语音模型 3.0（Seeduplex）** 是字节跳动/火山引擎 2026-06-18 上线的**原生全双工端到端语音大模型** API 服务（开启邀测）。

- 定位：从"对讲机"到"真人助理" —— 能听、能说、能思考，还能在对话中完成复杂任务
- 端到端架构：语音输入直接到语音输出，不经文本中转，延迟更低、表达更自然
- **全双工**：双方可同时说话，像真人面对面交谈；不再是你一句我一句的半双工对讲机

---

## 2. 三大核心优势（官方主推）

### 2.1 精准遵循（指令遵循）
- 支持多条复杂指令同步处理（如"开空调+关窗+导航回家"）
- 车载场景能识别不同乘员的偏好，提供个性化服务

### 2.2 抗干扰
- 持续感知全局声学环境，精准区分用户声音与背景干扰
- 广播、导航、多人对话等嘈杂环境中仍能锁定用户声音
- **误回复率与误打断率大幅降低**（不再被噪音"吵醒"，不随便接话）

### 2.3 动态判停
- 深度融合语音与语义理解，判断用户停顿是"思考"还是"说完了"
- 实测数据：
  - **判停延迟缩短约 250ms**
  - **复杂场景抢话比例下降 40%**
  - **用户主动打断延迟缩短约 300ms**
- 正常说话停顿的语义间隙 400-600ms，优化后"你说完它几乎立刻跟上，没说完不会急着接"

---

## 3. 关键能力

| 能力 | 说明 |
|---|---|
| **全双工对话** | 双方同时说话；多人对话中安静待命，指定话题出现时**主动加入**（语义级守听，非关键词触发） |
| **实时工具调用** | 支持自定义工具，在实时交互中完成预定日历、发邮件、查数据等；工具执行穿插在自然语言中，"边听边说边办事" |
| **实时转写** | 流式处理架构，20ms 级音频帧即可输出文本结果（会议记录/字幕场景） |
| **WebRTC 接入** | 支持浏览器 WebRTC 流式传输，延迟最低 |
| **降噪/回音** | noiseSuppress（默认开）、echoCancellation、gainControl |
| **灵敏度可调** | sensitivity: low（老人/语速慢用户）/ medium / high（快节奏对话） |

---

## 4. 技术指标与接口速览

### 4.1 延迟
- 第三方技术说明：**约 165-250ms**（全双工低延迟实时语音交互）
- 官方数据：判停 -250ms、打断 -300ms、抢话 -40%

### 4.2 接入方式（SDK：@bytedance/seed-sdk）

```typescript
import { SeedClient } from '@bytedance/seed-sdk';
const client = new SeedClient({ apiKey: process.env.SEED_API_KEY });

const session = await client.voice.createSession({
  model: 'seeduplex-v1',
  mode: 'full-duplex',        // 'full-duplex' | 'half-duplex'
  language: 'zh',             // 'en' | 'zh' | 'auto'
  sampleRate: 16000,          // 8000 | 16000 | 24000
  channels: 1,
  noiseSuppress: true,        // 降噪
  sensitivity: 'medium',      // 判停灵敏度
  systemPrompt: '你是...',    // 角色/系统指令（Persona）
});

session.on('audio', (chunk) => { /* 模型音频流（PCM） */ });
session.on('transcript', ({ text, isFinal }) => { /* 用户语音转写 */ });
session.on('response', ({ text, isFinal }) => { /* 模型文本 */ });
session.on('turn_start', () => { /* 模型开始说话 */ });
session.on('turn_end', () => { /* 模型说完 */ });
session.on('interruption', () => { /* 用户打断，模型让位 */ });
session.sendAudio(micChunk);   // 实时发送麦克风音频
```

### 4.3 关键事件
`audio`（音频流）/ `transcript`（用户转写）/ `response`（模型文本）/ `turn_start` / `turn_end` / `interruption`（打断）/ `error` / `close`

### 4.4 定价（第三方文档，以官方最终为准）
| 档位 | 价格 | 说明 |
|---|---|---|
| Free | $0 | 100 分钟/月，全语言，邮件支持 |
| Pro | $0.008/分钟 | 无限时长、优先支持、99.9% SLA |
| Enterprise | 定制 | 专属容量、可本地部署（on-prem）选项 |

> ⚠️ 注：以上价格为 seeduplex.io 第三方文档整理，官方邀测期定价以火山引擎方舟实际开通为准。

---

## 5. 火山引擎豆包语音生态（相关能力）

豆包语音（volcengine 豆包语音 SDK，与 Seeduplex 同生态）文档中还看到几个与咱项目高度相关的点：

1. **上下文管理（短期记忆）**：`SystemMessages` / `UserPrompts` / `HistoryLength` 字段注入初始上下文 + 控制历史记忆轮数 —— 对应咱"角色卡注入 + 记忆窗口"需求 ✅
2. **Prefill 策略**：ASR 中间结果提前发给 LLM，降低感知延迟（可理解为"边听边想"）
3. **MCP / Function Calling 接入**：知识库 RAG、联网搜索、业务 API 封装为标准工具 ✅
4. **自定义指令（情绪/动作下发）**：System Prompt 引导 LLM 输出括号指令如 `(happy)` / `【show_order:"xxx"】`，TTS 播报时**跳过括号内容**、随字幕下发客户端 —— 可用来驱动数字人表情/UI（`IgnoreBracketText`）✅ 与 DESIGN 里"情绪事件驱动数字人"设计完美契合

---

## 6. 三方对比：Seeduplex vs Qwen-Audio-3.0-Realtime vs Qwen3-Omni

| 维度 | **豆包 Seeduplex 3.0** | **Qwen-Audio-3.0-Realtime** | Qwen3-Omni |
|---|---|---|---|
| 厂商 | 字节跳动/火山引擎 | 阿里云 | 阿里云 |
| 发布 | 2026-06-18 | 2026-07-15 | 2025-09-26 |
| 定位 | 全双工端到端语音 | 实时语音对话 | 全模态 |
| 时延 | ~165-250ms（第三方） | **<120ms** | 211ms |
| 双工 | **全双工 + 语义级守听 + 多人主动加入** | 全双工可打断/抗噪/多人锁定 | 单工为主 |
| 判停/打断 | 判停 -250ms、打断 -300ms、抢话 -40% | 支持（无具体量化） | 无 |
| 抗干扰 | **强**（广播/导航/多人，误回复误打断双降） | 强 | 一般 |
| 情感表达 | 支持（豆包语音 TTS 生态有情绪/声音复刻） | **强**（情绪/副语言/音色克隆） | 一般 |
| 角色设定 | systemPrompt 字段（Persona）+ SystemMessages；**待实测** | **instructions 字段直接支持（官方示例）** | system prompt 支持 |
| 工具调用 | **原生 FunctionCall + MCP + 自定义工具** | 原生 FunctionCall + MCP | 支持（弱） |
| 实时转写 | ✅ 20ms 级音频帧出文本 | ✅ enableInputAudioTranscription | ✅ |
| 接入 | WebSocket / WebRTC，@bytedance/seed-sdk | WebSocket，DashScope SDK/原生 | WebSocket/OpenAI 兼容 |
| 开源 | 闭源 API（邀测制） | 闭源 API | **Apache 2.0 开源** |
| 定价 | $0.008/分钟（第三方；邀测期以官方为准） | Flash ¥3/¥30 每百万 token | 文本 $0.25/M 等 |
| 适用场景 | 车载/智能硬件/客服 | 客服/教育/娱乐/情感陪伴 | 通用全模态 |
| 主要风险 | **邀测制，开通门槛/不确定性**；文档零散 | 数据过云 | 需 GPU 自托管 |

---

## 7. 对本项目的适配分析

### 7.1 Seeduplex 的加分项
1. **全双工最彻底**：语义级守听 + 多人对话主动加入，比"可打断"更进一步，交互最像真人
2. **判停/打断量化数据最好**：-250ms 判停、-300ms 打断、-40% 抢话，工程化打磨最狠
3. **工具调用生态成熟**：原生自定义工具 + MCP，配合火山方舟插件/知识库，做"女友干活"最顺
4. **情绪指令下发**：括号指令 + TTS 过滤 + 字幕下发 → 天然驱动数字人表情（跟咱 DESIGN 的素材匹配引擎对接很顺）
5. **WebRTC 接入**：浏览器直连，省一层中转

### 7.2 Seeduplex 的减分项 / 风险
1. **邀测制**：2026-06-18 才开放 API 邀测，个人申请能否通过、多久开通是**不确定性**
2. **文档零散**：官方技术细节少，第三方（seeduplex.io）资料可靠性待验证
3. **定价未官方公开**：$0.008/分钟 是第三方数据，邀测期实际成本未知
4. **情感/陪伴侧重弱于 Qwen**：官方场景主打车载/硬件/客服，没提"情感陪伴"；音色/情绪主要靠同生态 TTS 支持
5. **角色设定待实测**：systemPrompt 字段存在，但实际效果（尤其中文口语化人设）没有官方示例背书

### 7.3 一句话结论
- **想要最"真人"的全双工体验 + 以后要让女友干活（工具调用）** → Seeduplex 值得申请邀测试试
- **想快速落地 + 情感陪伴体验 + 角色注入有官方背书** → Qwen-Audio-3.0-Realtime-Flash 仍是当前最稳主选
- 两者都闭源 API，**可并行申请**，实测后以实际效果定夺；Qwen3-Omni 保留为本地化备选

---

## 8. 下一步

- [ ] 申请 Seeduplex 邀测（seed.bytedance.com）+ 阿里云 DashScope API Key，两边并行
- [ ] 实测对比：角色注入效果、打断手感、判停节奏、音色/情绪、延迟
- [ ] 确认定价与可用性后，定 S2S 主选（当前建议：Qwen-Audio-3.0-Realtime-Flash 起步，Seeduplex 达标则升级）
- [ ] 接入方案设计（WebSocket/WebRTC 网关 + 角色卡解析 + 前端语音采集播放）

---

## 附录：信息来源

1. 火山引擎官方发布（2026-06-18 上线 API 邀测，全双工端到端、三大优势、量化数据）
2. seeduplex.io API 文档（SDK 接入、事件、定价 —— 第三方整理，待官方验证）
3. 火山引擎豆包语音帮助文档（SystemMessages/HistoryLength 上下文管理、Prefill、MCP、IgnoreBracketText 指令下发）
4. 行业媒体报道（toutiao / lumevalley / 腾讯云开发者社区等）

---

*报告整理：2026-08-09 · 小呆 · 供老板评审*

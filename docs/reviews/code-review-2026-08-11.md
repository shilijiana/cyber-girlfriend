# CC-01 已交付代码审查报告

> **审查人**：Claude Code
> **审查日期**：2026-08-11
> **任务编号**：CC-01
> **审查范围**：36 个核心文件（app/brain/persona/voice-shell/avatar/config/client 全模块）
> **tsc 基线**：`npx tsc --noEmit` 零错误通过
> **git HEAD**：`d0dfe05 feat(app): Hermes 冷启动预热`

---

## 1. 概要结论

代码整体质量**良好**——依赖注入架构清晰、类型安全度高、错误降级设计合理、契约对齐度高。共发现 **48 个问题**（🔴高 9 / 🟡中 18 / 🟢低 21），其中需优先处理的：

1. **请求级超时缺失**（orchestrator 无总超时，可导致请求永久挂起）
2. **gateway.ts JSON 消息以二进制帧发送**（浏览器端可能无法正确解析）
3. **`config/loader.ts` 的 `||` vs `??` bug**（falsy 值语义错误）
4. **WS 无连接数限制/无认证**（资源耗尽 + 跨站劫持风险）
5. **useVoice.ts 竞态条件**（快速双击可创建双重资源导致泄漏）
6. **死代码 2 处**（`hermes-persona-provider.ts` 整文件 + `default-persona-provider.ts` 整文件）

---

## 2. 问题清单

### 🔴 高严重度（9 个）

| # | 文件:行号 | 问题 | 影响 | 建议 |
|---|-----------|------|------|------|
| H1 | orchestrator.ts:83-131 | **无请求级超时保护**：`chat()` 依赖 `brainRunner.run` 内部 120s 超时，但 orchestrator 层和 Express 路由层均无总超时中间件。若 `personaProvider.getPersona()` 卡住（文件系统异常），HTTP 请求永久挂起 | 服务可用性 | 添加 Express 超时中间件（如 60-90s），或在 orchestrator.chat 中加 `Promise.race` |
| H2 | loader.ts:104,116,125 | **`||` 应为 `??`**：`file.dashscope?.apiKey \|\| process.env.XXX` 对 `""` / `0` / `false` 等 falsy 值处理不正确。尤其 `baseUrl` 字段——用户可能想显式置空以禁用自定义端点，`||` 会跳过空字符串回退到默认值 | 配置语义错误 | 将 `\|\|` 替换为 `??`（仅在真正需要跳过 falsy 的 `port` 字段保留 `\|\|`） |
| H3 | ws.ts:93-97 | **WS 无连接数限制、无认证、无 Origin 校验**：任何人可无限建立 WS 连接，每个连接触发 `resolveInstructions`（文件 IO）+ `gateway.handleConnection`（Qwen 云端会话），快速耗尽资源和 API 配额 | 安全/资源耗尽 | 添加 `maxConnections` 上限（如 5）、Origin 白名单校验 |
| H4 | function-router.ts:199 | **`handle()` 未 try-catch `runner.run()`**：若 runner 抛出未捕获异常，违反 BrainRunner "不抛错"契约，异常直接传播到 voice-shell gateway | 运行时崩溃 | 添加 try-catch 包裹 `runner.run()`，异常走 `fail()` |
| H5 | hermes-runner.ts:71 | **输出上限用 stdout+stderr 合计判断**：一个流的大量输出会挤占另一个流的记录空间，可能丢失关键 stderr 错误信息 | 错误诊断困难 | 对 stdout 和 stderr 分别独立计数 |
| H6 | file-persona-provider.ts:46-52 | **`buildClosingInstruction` 路径注入风险**：`memoryFilePath` 绝对路径直接拼接进 LLM 指令文本，若路径含特殊字符可能被利用做提示注入 | 安全风险 | 对路径做 sanitize（至少过滤 `\n\r`） |
| H7 | hermes-persona-provider.ts | **死代码含安全漏洞**：整个文件为废弃代码（零 import），但内部 `id` 参数直接拼接进 LLM 指令（:118-125），若被误用存在提示注入风险 | 安全/维护 | **立即删除整文件** |
| H8 | gateway.ts:122 | **JSON 消息以二进制帧发送**：`browserWs.send(Buffer.from(JSON.stringify(obj)))` 发送二进制帧（opcode 0x02）而非文本帧（0x01），浏览器 `onmessage` 收到 `Blob`/`ArrayBuffer` 需额外转换，可能无法正确解析 | 前端功能异常 | 改为 `browserWs.send(JSON.stringify(obj))` 直接发字符串 |
| H9 | useVoice.ts:177-179 | **`connect()` 竞态条件**：async 函数，`status` 是闭包捕获值。快速双击"开始语音"可能两次读到 `idle`，创建两套 mic/player/ws 资源，第二套覆盖第一套 ref，第一套资源泄漏 | 资源泄漏 | 添加 `connectingRef` 互斥锁 |

### 🟡 中严重度（18 个）

| # | 文件:行号 | 问题 | 影响 | 建议 |
|---|-----------|------|------|------|
| M1 | routes.ts:167-168 | **HTTP 状态码用字符串匹配决定**：`msg.includes('人设不存在') ? 400 : 500`——错误消息措辞变更即失效 | 状态码不稳定 | 改用自定义 Error class 带 `statusCode` 属性 |
| M2 | orchestrator.ts:83-131 | **`chat()` 无并发保护**：多个并发请求同时 spawn Hermes 子进程，无锁/队列 | 资源竞争 | 添加并发信号量或串行队列 |
| M3 | index.ts:132-141 | **`shutdown` 无防重入保护**：SIGINT+SIGTERM 快速连续触发时，`voiceWs.close()` 和 `server.close()` 被调用两次 | 关闭竞态 | 添加 `shuttingDown` 标志位 |
| M4 | loader.ts:42-43 | **`process.cwd()` 依赖启动目录**：配置文件路径基于工作目录，从子目录启动会找不到配置 | 启动失败 | 改用 `import.meta.url` 推导项目根目录 |
| M5 | loader.ts:118-121 | **`personasDir` 默认值含硬编码 Windows 用户路径**：`C:/Users/chipsine/...` 只在特定机器有效 | 跨平台兼容性 | 使用 `os.homedir()` 或 `process.env.APPDATA` 动态构建 |
| M6 | hermes-runner.ts:96 | **stderr 正则过于宽泛**：`/error\|traceback\|exception/i` 可能误判正常日志（如 "no error found"）为失败 | 误判 ok:false | 改为 `/^Error:\|Traceback\|unhandled exception/i` 或结合退出码判断 |
| M7 | hermes-runner.ts:82 | **Windows 下 `child.kill()` 不保证杀死子进程**：默认 SIGTERM 在 Windows 不可靠 | 僵尸进程 | 使用 `child.kill('SIGKILL')` 或 `taskkill` |
| M8 | function-router.ts:128 | **`name` 为空但 `callId` 非空时不返回 null**：产生无工具名的调用对象 | 下游异常 | `name` 为空时也返回 null |
| M9 | qwen-fallback.ts:122 | **超长输出截断无标记**：超过 16384 字符时静默截断，用户无感知 | 用户体验 | 追加 `"...[回复过长已截断]"` 或添加 `truncated: boolean` |
| M10 | file-persona-provider.ts:14 | **全模块同步 I/O**：`readFileSync`/`writeFileSync` 在 async 函数内阻塞事件循环 | 并发性能 | 改为 `readFile`/`writeFile` 异步版本 |
| M11 | file-persona-provider.ts:76-77 | **`readRegistry()` 无 JSON.parse 错误包装**：原始 SyntaxError 泄漏内部文件路径 | 信息泄露 | try-catch 包装，统一错误前缀 |
| M12 | file-persona-provider.ts:55-66 | **`readActivePersonaId` 缺省值硬编码 `'xiaodai'`**：注释说"取注册表第一个"但代码未兑现 | 配置不一致 | 改为注册表第一个 id 或返回 null |
| M13 | default-persona-provider.ts | **整文件死代码**：已被 `FilePersonaProvider` 替代，无任何代码 import | 维护负担 | 删除或标记 `@deprecated` |
| M14 | emotion-matcher.ts:55 | **`recentlyPlayedWindow` 为 NaN/Infinity 时窗口无限增长**：`Math.max(1, NaN)` 仍为 NaN，`length > NaN` 永远 false | 内存泄漏 | 添加 `Number.isFinite()` 校验 |
| M15 | routes.ts:85-96 | **`loadAvatarStatus` 同步 IO 阻塞事件循环**：`readFileSync` + `existsSync` 在可能被前端轮询的接口上 | 性能 | 改为 `fs.promises` 异步 API |
| M16 | qwen-audio-client.ts:155-171 | **connect() 超时后不清理 reconnectTimer**：`finally` 块只清理 `connectTimer`，若超时前已触发 `scheduleReconnect`，`reconnectTimer` 泄漏 | 资源泄漏 | `finally` 中同时清理 `reconnectTimer` |
| M17 | gateway.ts:225-228 | **onInputTranscript 绕过 dispatcher**：直接绑定在 session 上，缺少错误隔离，`deps.onInputTranscript` 抛异常会中断浏览器侧 `sendToBrowser` | 健壮性 | 通过 dispatcher 统一分发 |
| M18 | AvatarCanvas.tsx:85-105 | **播放 effect 在 state 变化时重新 `load()` 视频**：`clip` 未变但 `state` 变化时（speaking→listening→speaking），对同一视频调用 `video.load()`+`video.play()` 导致从头播放 | 用户体验 | 只在 `clip` 变化时重新加载，`state` 变化仅控制 play/pause |

### 🟢 低严重度（21 个）

| # | 文件:行号 | 问题 | 建议 |
|---|-----------|------|------|
| L1 | index.ts:117-119 | `isDirectRun` 检测用 `process.argv[1].endsWith('index.ts')` 脆弱 | 改用 `import.meta.url` 比对 |
| L2 | index.ts:139 | `setTimeout(...).unref?.()` 可选链在 Node 22 多余 | 移除 `?.` |
| L3 | index.ts:30-38 | 模块级单例在 import 时执行，测试 import 触发文件 IO | 延迟初始化或条件加载 |
| L4 | index.ts:51-68 | 预热 `prewarmHermes` 只预热 brain 而非整条链路 | 考虑预热含 persona 的完整链路 |
| L5 | routes.ts:140-170 | `/api/chat` 无请求频率限制、无消息长度限制 | 添加 rate limiting + `MAX_MESSAGE_LENGTH` |
| L6 | routes.ts:43-78 | `probeHermes` 的 `version` 字段可能包含多行输出 | 取第一行或截断到合理长度 |
| L7 | orchestrator.ts:57 | `DEFAULT_PERSONA_ID = 'xiaodai'` 与 `default-persona-provider.ts:19` 重复定义 | 抽取到共享常量文件 |
| L8 | orchestrator.ts:93-96 | brain 执行未传 `timeoutMs`，默认 120s 对文本聊天过长 | 文本聊天设 30-60s |
| L9 | orchestrator.ts:99-121 | 降级失败提示可能包含技术细节泄露给终端用户 | 错误信息做脱敏处理 |
| L10 | ws.ts:95-97 | `handleBrowserConnection` 的 `void` 丢弃 Promise | 添加 `.catch()` 或显式错误处理 |
| L11 | ws.ts:116-146 | `resolveInstructions` 异步期间客户端发送的音频数据丢失 | 先发 `status: 'initializing'` 事件 |
| L12 | hermes-runner.ts:46 | `timeoutMs` 为 0 或负数无下限保护 | 添加 `Math.max(timeoutMs, 1000)` |
| L13 | hermes-runner.ts:60 | 无并发限制，大量调用可能导致进程数爆炸 | 添加并发信号量 |
| L14 | function-router.ts:143-144 | arguments 为数组时未排除，被强制当 Record 使用 | 添加 `!Array.isArray()` 检查 |
| L15 | function-router.ts:170-172 | `timeoutMs` 无下限保护（`timeoutMs = 1` 会通过） | 添加 `Math.max(..., 5000)` |
| L16 | qwen-fallback.ts:97-98 | 输入无长度限制 | 添加字符数上限校验 |
| L17 | provider.ts:54-62 | `isPersonaInfo` 未校验 id/name/description 是否非空 | 补 `.length > 0` 校验 |
| L18 | clip-matcher.ts:71 | `buildQueue` 护栏 100 硬编码，与目标时长不匹配 | 动态计算或参数化 |
| L19 | emotion-matcher.ts:74-76 | `markPlayed` 与 `pick()` 双重记录导致避让窗口退化 | 增加去重或明确文档 |
| L20 | useVoice.ts:208 | **WebSocket URL 硬编码 `ws://`**：HTTPS 生产环境会被浏览器阻止（混合内容策略） | 根据 `location.protocol` 自动选择 `wss://` 或 `ws://` |
| L21 | use-chat.ts:102-106 | **未传入 AbortSignal**：组件卸载后正在进行的 HTTP 请求不取消，资源浪费 | 创建 AbortController，卸载/新发送时 abort 旧请求 |

---

## 3. 六大维度专项检查结论

### 3.1 契约一致性（module-contracts.md 对照）

| 契约条目 | 合规状态 | 说明 |
|----------|----------|------|
| §2.1 REST API 响应格式 | ✅ 合规 | `POST /api/chat` 响应含 `reply, personaId, ok, durationMs, degraded?` |
| §2.3 BrainRunner 接口 | ✅ 合规 | `run(task) → BrainResult`，超时/失败不抛错（但 function-router:handle 缺 try-catch，见 H4） |
| §2.4 PersonaProvider 接口 | ⚠️ 部分偏差 | `listPersonas()` 在代码中存在但契约文档未列出；`getActivePersonaId()` 是额外方法不在接口中 |
| §2.7 CoreOrchestrator 接口 | ⚠️ 部分偏差 | `listPersonas()` 代码中有但契约 section 2.7 未定义 |
| §3.3 错误语义 | ⚠️ 部分合规 | brain 业务失败走 HTTP 200 正确，但状态码判断方式（字符串匹配）不够健壮（M1） |
| §3.7 接口变更同步 | ❌ 不合规 | `listPersonas` 新增接口未更新契约文档 |

### 3.2 红线合规（BLUEPRINT.md §4）

| 红线 | 合规状态 | 说明 |
|------|----------|------|
| 红线 1：无数据库/无持久化/无本地记忆 | ✅ 合规 | 所有模块均无本地存储，`active.txt` 写入归 Hermes 管理目录 |
| 红线 3：人设归 Hermes（FilePersonaProvider 只读） | ✅ 合规 | FilePersonaProvider 只读 Hermes personas 目录，`switchPersona` 写 `active.txt` 归 Hermes 数据目录 |
| 红线 4/5：文本中转不漂移 | ✅ 合规 | orchestrator 只传 `instruction`/`context` 纯文本字符串 |
| 红线 5/9：依赖最小化 | ✅ 合规 | 仅 express + ws + 标准库 |
| 红线 6：语音壳不碰业务 | ✅ 合规 | voice-shell 只做 WS 中继和 FC 装配，不涉及业务逻辑 |
| 红线 8：Key 集中管理 | ✅ 合规 | 所有密钥通过 `config/loader.ts` 统一加载，无硬编码密钥 |
| 红线 10：记忆双向隔离 | ✅ 合规 | Hermes 调用固定传 `--profile cyber-girlfriend`，profile 级隔离 |

### 3.3 死代码

| 文件 | 状态 | 详情 |
|------|------|------|
| `persona/hermes-persona-provider.ts`（189 行） | ❌ **确认死代码** | 全代码库零 import，ADR-008 已废弃，含安全漏洞 |
| `app/server/default-persona-provider.ts`（87 行） | ❌ **确认死代码** | 已被 `FilePersonaProvider` 替代，无运行时代码引用 |
| `persona/provider.ts:8` 注释 | ⚠️ 过时 | "实现规划：HermesPersonaProvider（PS-02）" 应更新 |
| 其他文件 | ✅ 无死代码 | 所有导出均有明确引用 |

### 3.4 安全

| 检查项 | 结果 | 详情 |
|--------|------|------|
| 命令注入 | ⚠️ 低风险 | `hermes-runner` spawn 使用数组参数（非 shell），但 `binPath` 来自配置文件，配置被篡改时可执行任意程序（routes.ts:43） |
| 路径穿越 | ✅ 低风险 | `ID_PATTERN = /^[a-z0-9-]+$/` 有效阻止 `../` 穿越，但缺少 `startsWith(personasDir)` 二次校验 |
| XSS | ✅ 安全 | React 默认转义所有插值内容，`dangerouslySetInnerHTML` 未使用 |
| 密钥泄露 | ✅ 安全 | `maskKey()` 脱敏处理日志输出，无硬编码密钥 |
| 认证/授权 | ❌ 缺失 | REST API 和 WebSocket 均无任何认证机制（H3） |
| 提示注入 | ⚠️ 中风险 | `file-persona-provider.ts:46` 路径拼接进 LLM 指令；`hermes-runner.ts` 用户消息直接作为 instruction |
| Rate Limiting | ❌ 缺失 | `/api/chat` 无频率限制，可耗尽 Hermes/Qwen 计算资源 |

### 3.5 边界条件

| 场景 | 覆盖情况 | 详情 |
|------|----------|------|
| 空输入 | ✅ 基本覆盖 | `parseMessage` 返回 null、`pickClip` 返回 null、brain 空 instruction 无校验（L12/L16） |
| 超时 | ⚠️ 部分覆盖 | hermes-runner 有 120s 超时 + function-router 有 `MAX_TIMEOUT_MS`，但 orchestrator 层无总超时（H1） |
| 并发写 | ⚠️ 未覆盖 | `active.txt` 写入无文件锁（低概率）；`chat()` 无并发保护（M2） |
| WS 断线重连 | ✅ 覆盖 | `qwen-audio-client.ts` 有心跳 + 指数退避重连 + 重连计数归零逻辑 |
| WS 帧类型 | ✅ 覆盖 | gateway 正确处理文本/Buffer 帧 |
| 重连计数归零 | ✅ 覆盖 | 连接成功后重置计数器 |
| 超长输入 | ❌ 未覆盖 | 无消息长度限制（L5/L16） |
| NaN/Infinity 边界 | ❌ 未覆盖 | `recentlyPlayedWindow` 为 NaN 时窗口无限增长（M14） |

### 3.6 类型与规范

| 检查项 | 结果 |
|--------|------|
| `npx tsc --noEmit` | ✅ 零错误 |
| `any` 使用 | ✅ 极少使用，仅 Express `req.body`（框架限制）和外部事件解析 |
| 命名规范 | ✅ 一致：`createXxx` 工厂、`XxxOptions` 配置、`XxxDeps` 依赖 |
| 注释质量 | ⚠️ 部分过时（provider.ts PS-02 引用、index.ts/ws.ts 注释与代码不一致） |
| 错误处理 | ✅ 大部分使用统一 `fail()` 收口，function-router:handle 是主要遗漏（H4） |

---

## 4. 文件覆盖确认

| # | 模块 | 文件 | 已审查 |
|---|------|------|--------|
| 1 | app | `app/server/index.ts`（157 行） | ✅ |
| 2 | app | `app/server/routes.ts`（183 行） | ✅ |
| 3 | app | `app/server/orchestrator.ts`（159 行） | ✅ |
| 4 | app | `app/server/ws.ts`（176 行） | ✅ |
| 5 | app | `app/server/default-persona-provider.ts`（86 行） | ✅ |
| 6 | brain | `brain/hermes-runner.ts`（126 行） | ✅ |
| 7 | brain | `brain/function-router.ts`（242 行） | ✅ |
| 8 | brain | `brain/qwen-fallback.ts`（152 行） | ✅ |
| 9 | persona | `persona/provider.ts`（84 行） | ✅ |
| 10 | persona | `persona/file-persona-provider.ts`（163 行） | ✅ |
| 11 | persona | `persona/hermes-persona-provider.ts`（189 行） | ✅ |
| 12 | voice-shell | `voice-shell/provider.ts` | ✅ |
| 13 | voice-shell | `voice-shell/qwen-audio-client.ts` | ✅ |
| 14 | voice-shell | `voice-shell/gateway.ts` | ✅ |
| 15 | voice-shell | `voice-shell/dispatcher.ts` | ✅ |
| 16 | voice-shell | `voice-shell/function-calling.ts` | ✅ |
| 17 | avatar | `avatar/clip-matcher.ts`（86 行） | ✅ |
| 18 | avatar | `avatar/emotion-matcher.ts`（88 行） | ✅ |
| 19 | config | `config/loader.ts`（141 行） | ✅ |
| 20 | client | `client/src/App.tsx` | ✅ |
| 21 | client | `client/src/main.tsx` | ✅ |
| 22-26 | client | `client/src/components/*.tsx`（AvatarCanvas/CaptionBar/ChatUI/ChatInput/ChatMessages/VoiceWaveform） | ✅ |
| 27-29 | client | `client/src/components/*-core.ts`（avatar-canvas-core/caption-core/chat-core/waveform-core） | ✅ |
| 30-32 | client | `client/src/hooks/*.ts`（useVoice/use-avatar/use-chat） | ✅ |
| 33-34 | client | `client/src/voice/*.ts`（audio.ts/voice-machine.ts） | ✅ |

**覆盖：36/36 文件**

---

## 5. 整改优先级建议

| 优先级 | 关联问题 | 整改建议 | 实施方案 | 预估工时 |
|--------|---------|----------|----------|----------|
| **P0** | H1, H4, H8 | 添加请求超时 + runner try-catch + WS 帧类型修复 | `orchestrator.ts` 加 `Promise.race` 超时；`function-router.ts:handle` 加 try-catch；`gateway.ts:122` 改为字符串发送 | 1.5h |
| **P0** | H7, M13 | 删除死代码 | 删除 `hermes-persona-provider.ts` + `default-persona-provider.ts` | 10min |
| **P1** | H2 | config `||` 改 `??` | `loader.ts` 全部 `\|\|` 改为 `??`（port 字段保留 `\|\|`） | 30min |
| **P1** | H3, H9, L5, L20 | WS 安全加固 + 前端竞态修复 | 添加 `maxConnections` 限制 + Origin 校验 + REST rate limiting；`useVoice.ts` 加 `connectingRef`；WebSocket URL 协议自适应 | 3h |
| **P1** | H5, H6 | 输出计数分离 + 路径 sanitize | hermes-runner.ts 分离 stdout/stderr 计数；file-persona-provider.ts sanitize 路径 | 1h |
| **P2** | M1, M4, M5, M16-M18 | 状态码重构 + 路径修正 + voice-shell 清理 | 自定义 Error class；`import.meta.url` 推导根目录；`qwen-audio-client.ts` 清理 reconnectTimer；`gateway.ts` 统一 dispatcher；`AvatarCanvas.tsx` 修复播放逻辑 | 3h |
| **P2** | M6-M9, M14 | 边界值保护 | stderr 正则精确化、Windows kill 修复、timeout 下限、NaN 校验 | 2h |
| **P3** | L1-L21 | 低优先级改进 | 按各条建议逐项处理 | 4h |

---

## 6. 总结

### 代码质量评价
- **架构**：⭐⭐⭐⭐ 依赖注入清晰，模块边界明确，降级设计合理
- **类型安全**：⭐⭐⭐⭐⭐ tsc 零错误，`any` 使用极少，接口定义完整
- **安全**：⭐⭐⭐ 无硬编码密钥、XSS 安全，但缺少认证和 rate limiting
- **健壮性**：⭐⭐⭐ 大部分边界有处理，但超时/并发/NaN 保护不足
- **可维护性**：⭐⭐⭐⭐ 命名规范一致，注释充分（部分过时），死代码需清理
- **契约对齐**：⭐⭐⭐⭐ 高度对齐，少量接口新增未同步文档

### 核心关注点
1. **超时保护链不完整**——从 Express 到 orchestrator 到 brain，需要端到端超时覆盖
2. **config loader 的 falsy 值语义**——`||` 和 `??` 的混淆可能导致配置不生效
3. **无认证暴露面**——REST + WS 完全开放，需在生产部署前加固

---

*CC-01 审查报告 v1.0 · 2026-08-11 · Claude Code 生成*

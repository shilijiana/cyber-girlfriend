# persona · 人设 💃

**职责**：定义赛博女友与 Hermes 人设系统之间的唯一抽象——`PersonaProvider` 接口。**人设数据归 Hermes 统一维护**，本模块不存角色卡、不做持久化（ADR-006）。

## 核心功能

| 文件 | 说明 |
|------|------|
| `provider.ts` | `PersonaProvider` 抽象接口 + `Persona`/`PersonaInfo` 类型 + `isPersona`/`isPersonaInfo` 类型守卫（PS-01 ✅ 已交付） |

## 接口定义（契约 v1.2，对齐 docs/architecture/module-contracts.md §2.4）

```ts
export interface PersonaProvider {
  listPersonas(): Promise<PersonaInfo[]>;          // 可用人设列表
  getPersona(id: string): Promise<Persona>;        // 加载人设（含 Hermes 预组装 instructions）
  buildInstructions(persona: Persona): string;     // 人设 → Qwen instructions 透传/格式化
  switchPersona(id: string): Promise<void>;        // 切换活跃人设
}

export interface PersonaInfo { id: string; name: string; description: string; }
export interface Persona {
  id: string; name: string;
  instructions: string;                            // Hermes 预组装好的 instructions
  voiceConfig?: { voiceId?: string; emotion?: string };
  postHistoryInstructions?: string;                // 对话后指令（function_call 引导）
}
```

## 实现规划

- **`HermesPersonaProvider`**（PS-02，待执行）：通过 `hermes -z` 子进程获取/加载/切换人设，instructions 透传
- **预留**：`FilePersonaProvider`（读 Hermes 写的人设 JSON 文件）、`HttpPersonaProvider`（Hermes MCP serve 常驻模式）

## 关键约束

- **人设只注入语音壳**（instructions），不做任务调度
- **人设数据归 Hermes**：赛博女友侧零角色卡、零记忆（ADR-006）
- 契约变更必须先改 `docs/architecture/module-contracts.md` 再写代码

## 相关

- 人设生态参考：SillyTavern chara_card_v2（社区标准，由 Hermes 侧消费）
- 架构总纲：`docs/architecture/overall-architecture.md`

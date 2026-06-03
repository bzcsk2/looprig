# Deepicode Context 压缩专项实施指南

最后更新：2026-06-03

本文只保留 **尚未完成**、**仍需继续实现**、**仍待验收** 的内容。已完成的 LSP / Plugin / Status 细节不在这里重复维护，统一以 [DONE.md](DONE.md) 为准。

当前这份文档只服务一个专项：**Context 压缩与持久化**。

---

## 1. 当前事实

先明确现状，避免后续 agent 做错方向：

- `ContextManager` 已存在，并且 `trim` 路径可用。
- `ReasonixEngine` 已暴露 `getContextPolicy()`、`setContextPolicy()`、`getContextStatus()`、`runContextReduction()`。
- TUI `/context` 菜单已经实现：可打开、切换 strategy、调整 trigger/target，并支持 `Run now`。
- 目前的 `compress` 不是模型压缩，而是本地机械 summary。
- `.deepicode/context.json` 的独立持久化还没有实现。
- 真实 LLM summarizer 还没有实现。
- `CTX-70` 的完整验收还没有做。

对实现者最重要的一句话：

> 这不是一个“重做上下文系统”的任务。只是在现有 `ImmutablePrefix + AppendOnlyLog + VolatileScratch` 架构上，补上可配置策略、真实模型压缩和策略持久化。

---

## 2. 必须遵守的边界

1. 不要改写 Core 的消息架构。
   - 继续使用 `ImmutablePrefix + AppendOnlyLog + VolatileScratch`。
   - 不要引入第二套 memory / store / vector database。

2. 不要让压缩影响主流程稳定性。
   - `trim` 必须始终保留为 fallback。
   - `compact` 失败、超时、空摘要都必须回退到 `trim`。

3. 不要压缩不能压缩的内容。
   - 不压缩 `ImmutablePrefix`。
   - 不压缩当前轮 `VolatileScratch`。
   - 不切坏 tool call / tool result 成组消息。

4. 不要把 summarizer 做成工具。
   - summarizer 是引擎内部能力。
   - 它不能触发普通 tool execution。

5. 不要把 `.deepicode/context.json` 混进主配置文件作为第一版。
   - 独立配置文件更容易测试和回退。
   - 以后是否合并再说。

6. 不要在 TUI 里直接拼模型摘要逻辑。
   - TUI 只负责菜单和策略编辑。
   - 真正的压缩在 Core。

7. 不要一次领取多个阶段。
   - 每次只做 `CTX-10` / `CTX-30` / `CTX-40` / `CTX-50` / `CTX-70` 中的一个。

---

## 3. 现在要达到的目标

### 必须达到

1. 保留 `trim` 作为默认 fallback。
2. 增加 `compact`：用模型总结旧上下文，然后删除被压缩的旧消息。
3. `/context` 菜单支持配置：
   - `strategy`: `trim` / `compact`
   - `triggerRatio`: 默认 `0.70`
   - `targetRatio`: 默认 `0.30`
4. 策略变更可持久化。
5. 压缩摘要进入上下文，并且能识别为 summary。
6. 压缩不能破坏 tool call / tool result 对应关系。
7. 压缩失败必须 fallback trim。
8. 需要测试覆盖，避免无限压缩、重复 summary、上下文越压越大。

### 非目标

- 不做跨 session 长期记忆。
- 不做向量数据库。
- 不做“自动学知识库”。
- 不让压缩写回历史 JSONL 覆盖原始消息。
- 不在每一轮都触发压缩。
- 不压缩 prefix / 当前轮 scratch。

---

## 4. 当前代码该怎么理解

### 4.1 Core 现状

相关文件：

- `packages/core/src/context/manager.ts`
- `packages/core/src/context/append-log.ts`
- `packages/core/src/context/immutable.ts`
- `packages/core/src/context/scratch.ts`
- `packages/core/src/engine.ts`
- `packages/core/src/status.ts`

当前行为：

- `ContextManager.getBudget()` 已能计算 prefix / summary / log / scratch / total / ratio。
- `ContextManager.reduceToTarget(mode, targetRatio)` 已经做了参数化裁剪。
- `trim` 模式已经真实工作。
- `compress` 模式当前只是本地机械 summary，还不是模型压缩。
- `buildMessages()` 已经按 `prefix + summary + log + scratch` 组合。

### 4.2 TUI 现状

相关文件：

- `packages/tui/src/App.tsx`
- `packages/tui/src/ContextModal.tsx`
- `packages/tui/src/commands.ts`
- `packages/tui/src/CommandRegistry.ts`
- `packages/tui/src/i18n/en.ts`
- `packages/tui/src/i18n/zh-CN.ts`

当前行为：

- `/context` 菜单已实现。
- 菜单可以修改 `strategy`、`triggerRatio`、`targetRatio`。
- 菜单可以执行 `Run now`，触发当前策略的一次 reduction。
- 菜单现在调用的是引擎内存策略；策略持久化到 `.deepicode/context.json` 还没做。

### 4.3 目前最缺的东西

缺口其实很明确：

1. `.deepicode/context.json` 的读写。
2. 真正的 summarizer。
3. `compact` 的真实执行链路。
4. `CTX-70` 的验收文档和验证步骤。

---

## 5. 文件级实施边界

### Core

应该修改：

- `packages/core/src/context/policy.ts`
- `packages/core/src/context/policy-store.ts`
- `packages/core/src/context/summarizer.ts`
- `packages/core/src/context/manager.ts`
- `packages/core/src/engine.ts`
- `packages/core/src/index.ts`
- `packages/core/__tests__/context-policy.test.ts`
- `packages/core/__tests__/context-summary.test.ts`
- `packages/core/__tests__/engine-context-policy.test.ts`
- `packages/core/__tests__/context-summarizer.test.ts`

### TUI

`/context` 菜单本身已经完成，后续 agent 不要重做菜单。只有在接入策略持久化反馈时，才允许小范围修改：

- `packages/tui/src/ContextModal.tsx`
- `packages/tui/src/App.tsx`

不要重新设计 `/context` 交互、不要改成全屏、不要把 compact 逻辑写进 TUI。

### 文档

应该修改：

- `README.md` 或 `TEST.md`
- `TODO.md`
- `DONE.md`

不要碰：

- `packages/core/src/streaming-executor.ts`，除非 context 触发点真的需要它。
- `packages/tools`，这不是工具系统任务。
- `packages/plugin`，这不是 plugin 任务。
- `packages/lsp`，这不是 LSP 任务。

---

## 6. 实现阶段

### CTX-10：策略类型、配置加载和菜单解析

**状态：✅ 已完成**

已完成：

- `ContextPolicy` 类型和引擎内默认值。
- `/context` 菜单入口和交互。
- `trim/compact` 的菜单切换、trigger/target 调整和 `Run now`。
- `.deepicode/context.json` 的独立 loader/saver。
- 配置校验和持久化写回。

#### 目标

把策略从“内存变量”升级成“可加载、可保存、可回读”的配置。

#### 建议实现步骤

1. 新增 `packages/core/src/context/policy.ts`。
   - 定义 `ContextPolicyMode`、`ContextPolicy`、默认值和校验函数。
   - 校验规则至少包括：`0 < targetRatio < triggerRatio < 1`。

2. 新增 `packages/core/src/context/policy-store.ts`。
   - 负责从 `.deepicode/context.json` 读取。
   - 负责把当前策略写回 `.deepicode/context.json`。
   - 读失败时回退默认值，不要阻塞启动。

3. 在 `ReasonixEngine` 里接入策略 store。
   - 启动时读配置。
   - `setContextPolicy()` 后可选择立即保存。
   - `getContextPolicy()` 返回当前生效策略。

4. 在 TUI 里保留现有菜单操作，只补策略保存反馈。

#### 测试重点

- 默认策略是否正确。
- 非法配置是否回退。
- 读取失败是否不影响启动。
- `/context` 命令是否还能正常解析。

#### 验收命令

```bash
bun test packages/core/__tests__/context-policy.test.ts
bun test packages/tui/__tests__/commands.test.ts
bun run typecheck
```

---

### CTX-30：摘要区和 summarizer 接口

**状态：✅ 已完成**

已完成：

- `buildMessages()` 已包含 summary 区域。
- `summaryTokens` 已计入 budget。
- 独立 `ContextSummary` 模块。
- `ContextSummarizer` 接口。
- fake summarizer 和 mechanical summarizer。

#### 目标

把“压缩摘要”从机械字符串拼接，升级为独立 summary 层。

#### 建议实现步骤

1. 新增 `packages/core/src/context/summary.ts`。
   - 维护 summary message。
   - 支持 replace / clear / read。
   - summary 必须有明显标记，方便模型识别。

2. 新增 `ContextSummarizer` 接口。
   - 输入：旧消息、旧 summary、目标 token 预算、workspace 信息。
   - 输出：新的 summary 文本和可选 usage 数据。

3. 先做 fake summarizer。
   - 用于单测。
   - 返回固定摘要，方便验证安装和替换逻辑。

4. 保证 summary 的插入顺序稳定。
   - prefix
   - summary
   - log
   - scratch

#### 测试重点

- summary 是否位于 prefix 后、log 前。
- replace summary 是否不会破坏 prefix 指纹。
- 多次 replace 是否只保留一个 summary。
- summary tokens 是否算入 budget。

#### 验收命令

```bash
bun test packages/core/__tests__/context-summary.test.ts
```

---

### CTX-40：Engine 自动 trim/compact 触发

**状态：⬜ 未完成**

已完成：

- `getContextPolicy()` / `setContextPolicy()` / `getContextStatus()` 已存在。
- `submit()` 前会检查 budget。
- `trim` 时会自动裁剪。
- 会产生状态事件和 runtime logs。

未完成：

- `compact` 时调用真实 summarizer。
- summarizer 失败后的真实 fallback 链路。

#### 目标

让引擎在接近阈值时自动执行 context reduction。

#### 建议实现步骤

1. 在 `ReasonixEngine.submit()` 里，保留“用户输入前检查”的入口。
   - 不要把 compact 放到 `buildMessages()`。
   - `buildMessages()` 还是同步的，别把它改成复杂 async 流程。

2. `trim` 模式：
   - 到阈值就裁剪。
   - 裁剪成功后继续 submit。

3. `compact` 模式：
   - 调用 summarizer。
   - 成功后安装 summary，再删除旧历史。
   - 失败时 fallback trim。

4. 记录日志。
   - 记录前后 token、删除消息数、是否 fallback。
   - 不记录原始消息正文。

#### 测试重点

- 低于 70% 不触发。
- 高于 70% 触发 trim。
- compact 成功后是否安装 summary 并删除旧轮次。
- compact 失败是否 fallback trim。
- 当前用户输入是否不会被压缩掉。
- 不调用工具。

#### 验收命令

```bash
bun test packages/core/__tests__/engine-context-policy.test.ts
```

---

### CTX-50：真实 LLM summarizer

**状态：⬜ 未完成**

#### 目标

把 `compact` 从“机械摘要”改成“调用模型做上下文压缩”。

#### 建议实现步骤

1. 在 `packages/core/src/context/summarizer.ts` 实现真实 summarizer。
   - 复用现有 provider client。
   - 低温度。
   - 不带 tools。
   - 只让模型做“摘要”，不要让它执行任务。

2. 控制输入范围。
   - 只传入可压缩的旧消息。
   - 保留必要的 summary 作为上下文输入。
   - 不把当前轮 input 放进去。

3. 控制输出长度。
   - `maxTokens` 受 `targetRatio` 约束。
   - 输出过长时截断。

4. 做错误处理。
   - HTTP 错误回退。
   - 超时回退。
   - 空摘要回退。
   - AbortSignal 生效。

#### 测试重点

- fake SSE summary 路径是否可用。
- summarizer HTTP 错误是否 fallback trim。
- abort 是否中断 summarizer。
- 空摘要是否 fallback trim。

#### 验收命令

```bash
bun test packages/core/__tests__/context-summarizer.test.ts
```

---

### CTX-70：文档和验收

**状态：⬜ 未完成**

#### 目标

把这个专项从“代码完成”变成“可以交接给别的 agent / 人工验收”的状态。

#### 必须补的内容

1. README 或 TEST.md 增加 `/context` 说明。
2. TODO 记录当前 CTX 阶段。
3. DONE 记录已完成阶段。
4. 手工验收 `70% -> 30%` 的 trim 和 compact。

#### 手工验收建议

1. 启动 TUI。
2. 输入 `/context`。
3. 选择 `trim`，设置 `70% -> 30%`，保存。
4. 用长会话把上下文推到 70% 以上，确认自动裁剪到约 30%。
5. 切换 `compact`，重复长会话，确认出现 summary。
6. 模拟 summarizer 失败，确认 fallback trim。
7. 退出并重启，确认配置仍然生效。

---

## 7. 建议领取顺序

按这个顺序做，最不容易把系统搞乱：

1. `CTX-10`：策略类型、配置加载和 `/context` 命令入口。
2. `CTX-30`：summary 区域和 summarizer 接口。
3. `CTX-40`：Engine 自动触发与 fallback。
4. `CTX-50`：真实 LLM summarizer。
5. `CTX-70`：文档和验收。

每次只做一个阶段。完成后更新 `DONE.md` 和 `TODO.md`，并至少运行对应目标测试、`bun run typecheck`、`git diff --check`。

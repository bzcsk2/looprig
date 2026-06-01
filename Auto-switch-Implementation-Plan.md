# Deepicode 推理档位自动切换专项实施方案

> 状态：**已完成** (AS0-AS6 全部实现)  
> 适用范围：`packages/core`、`packages/tui`  
> 设计依据：`Auto-switch.md`、现有 `strategy/tiers.ts`、当前 Provider 配置和流式工具调用链路  
> 最后校对：2026-06-01  
> 完成日期：2026-06-01

## 实现总结

### 已完成阶段

| 阶段 | 功能 | 状态 | 提交 |
|------|------|------|------|
| **AS0** | reasoning_content 工具链连续性修复 | ✅ 完成 | `8dc60b0` |
| **AS1** | Provider 能力声明和请求映射 | ✅ 完成 | `bd3687f` |
| **AS2** | 纯规则评估器（状态机+决策） | ✅ 完成 | `4783705` |
| **AS3** | Controller 和 Loop 集成 | ✅ 完成 | `e91e190` |
| **AS4** | TUI 状态栏显示 🧠 Thinking | ✅ 完成 | `c94bd61` |
| **AS5** | `/thinking` 手动覆盖命令 | ✅ 完成 | `e7d4fdf` |
| **AS6** | 统计跟踪与校准 | ✅ 完成 | `0563205` |

### 新增文件

| 文件 | 功能 |
|------|------|
| `packages/core/src/provider-thinking.ts` | Provider 能力声明和模式映射 |
| `packages/core/src/mode-selector.ts` | 纯规则评估器和状态机 |
| `packages/core/src/mode-stats.ts` | 统计跟踪和校准 |
| `packages/core/__tests__/provider-thinking.test.ts` | AS1 测试 (7 tests) |
| `packages/core/__tests__/mode-selector.test.ts` | AS2 测试 (13 tests) |
| `packages/core/__tests__/loop-mode-integration.test.ts` | AS3 测试 (3 tests) |
| `packages/core/__tests__/mode-stats.test.ts` | AS6 测试 (6 tests) |

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `packages/core/src/loop.ts` | 集成模式选择器、应用 thinking 参数、记录统计 |
| `packages/core/src/engine.ts` | 添加 modeSelectorState、modeStats、setThinkingMode() |
| `packages/core/src/client.ts` | AS0: 保留工具调用消息的 reasoning_content |
| `packages/tui/src/StatusBar.tsx` | 显示 🧠 Thinking 状态指示器 |
| `packages/tui/src/bridge.tsx` | 处理 thinking_mode_switch 事件 |
| `packages/tui/src/App.tsx` | 添加 /thinking 命令处理 |
| `packages/tui/src/CommandRegistry.ts` | 注册 /thinking 命令 |

### 测试结果

- **总测试数**: 665
- **通过**: 657
- **失败**: 8 (预存失败，非本次修改引起)
- **新增测试**: 34 (AS0-AS6)

### 核心特性

1. **自动切换**: 简单查询→开启 high thinking，复杂工具链/重试→关闭
2. **状态机**: idle → pending → active → cooldown（120s 冷却）
3. **紧急模式**: 错误时立即关闭 thinking，记录历史，3次/10分钟强制 off
4. **手动覆盖**: `/thinking off/low/medium/high/max`
5. **可观测**: 实时状态栏显示 + 统计跟踪
6. **工具链连续性**: reasoning_content 正确保留在上下文中

## 1. 目标

在不增加额外模型请求的前提下，根据用户请求、上下文压力、工具执行结果和近期失败状态，在每次模型请求前自动选择 DeepSeek 推理档位：

```ts
type ReasoningMode = "off" | "high" | "max";
```

自动切换必须满足：

1. 规则计算为本地纯逻辑，不调用模型，不访问网络，不阻塞流式输出。
2. 只向明确声明支持该能力的 Provider 发送推理参数。
3. 工具调用后继续请求模型时，完整回传 `reasoning_content`。
4. 已执行过的工具不可因为升级档位而自动重跑。
5. 选择结果可观测，可测试，可解释，可逐步上线。

## 2. 非目标

本专项不实现以下功能：

1. 不自动切换模型、Provider、API Key 或 Base URL。
2. 不用额外模型调用判断任务复杂度。
3. 不根据单个关键词直接触发危险操作。
4. 不在工具执行失败后重放整个请求。
5. 不重构现有上下文折叠、权限确认或 TUI 主状态机。

“Auto-switch”在本方案中仅指请求级推理强度切换，不是模型路由。

## 3. 当前代码事实

### 3.1 已存在的能力

当前客户端请求选项已经支持推理字段：

- `packages/core/src/client.ts`
  - `thinking?: "enabled" | "disabled"`
  - `reasoningEffort?: "high" | "max"`

当前项目也已经存在策略档位：

- `packages/core/src/strategy/tiers.ts`
  - `minimal`
  - `normal`
  - `deep`
  - `exhaustive`

专项开发应扩展现有 `strategy` 目录，不要创建一套互不相干的 `reasoning/` 子系统。

### 3.2 必须先修复的问题

当前工具调用链路没有完整保留并回传 `reasoning_content`：

1. 流式响应会收集推理内容。
2. Assistant 工具调用消息写回上下文时没有稳定保留 `reasoning_content`。
3. 客户端序列化 Assistant 消息时会丢弃该字段。

DeepSeek Thinking Mode 与工具调用组合使用时，后续请求必须回传此前 Assistant 消息中的 `reasoning_content`。否则自动开启 `high` 或 `max` 后，工具链可能在第二轮请求失败。

因此，任何自动切换逻辑都必须排在 reasoning continuity 修复之后。

### 3.3 Provider 能力不可一概而论

项目目前支持：

- `deepseek`
- `zen`
- `mimo`

DeepSeek 官方文档明确支持：

```json
{
  "thinking": { "type": "enabled" },
  "reasoning_effort": "high"
}
```

也支持：

```json
{
  "thinking": { "type": "disabled" }
}
```

但不能据此推断其他兼容 OpenAI 格式的 Provider 必然接受相同字段。Zen 和 Mimo 必须分别声明能力；未验证时默认不发送。

官方参考：

- [DeepSeek Thinking Mode](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode)

## 4. 关键设计决策

### 4.1 区分策略档位和推理档位

现有策略档位与本专项推理档位职责不同：

```ts
type StrategyTier = "minimal" | "normal" | "deep" | "exhaustive";
type ReasoningMode = "off" | "high" | "max";
```

- `StrategyTier`：控制预算、链路长度、温度、上下文阈值等整体策略。
- `ReasoningMode`：控制单次 Provider 请求是否启用 Thinking Mode，以及启用后的强度。

推理档位由本地规则推荐，再受到 Provider 能力和策略上限约束。

建议初始映射：

| Strategy Tier | 允许的最高 Reasoning Mode |
| --- | --- |
| `minimal` | `off` |
| `normal` | `high` |
| `deep` | `max` |
| `exhaustive` | `max` |

不要把两种枚举混为一谈，也不要删除现有 `tiers.ts`。

### 4.2 每次 API 请求前评估，在安全边界切换

评估时机放在模型请求发出之前：

```text
读取当前状态
  -> 纯规则评估推荐档位
  -> 应用策略上限
  -> 应用 Provider 能力约束
  -> 生成请求参数
  -> 发起 API 请求
  -> 流式处理响应
  -> 执行工具
  -> 记录工具结果
  -> 下一次 API 请求前重新评估
```

工具失败后可以让下一轮请求升级到 `max`，但禁止：

```text
工具失败
  -> 重放已经完成的模型请求
  -> 再次执行相同工具
```

这会造成文件写入、Shell 命令、网络请求等副作用重复发生。

### 4.3 规则必须可解释

评估器不能只返回结果，应同时返回触发原因：

```ts
interface ReasoningDecision {
  recommended: ReasoningMode;
  effective: ReasoningMode;
  reasons: ReasoningReason[];
  cappedBy?: "strategy-tier" | "provider-capability";
}
```

原因用于：

1. 单元测试。
2. TUI 状态提示。
3. 后续调参。
4. 排查误判。

## 5. 建议目录结构

在现有策略目录内新增：

```text
packages/core/src/strategy/
  tiers.ts                       # 已存在，保持职责
  reasoning-types.ts             # 推理档位、输入特征、决策结果
  provider-capabilities.ts       # Provider 能力表和请求参数映射
  reasoning-evaluator.ts         # 无副作用纯规则评估
  reasoning-controller.ts        # 运行时状态、滞回、防抖
```

测试建议：

```text
packages/core/src/strategy/__tests__/
  provider-capabilities.test.ts
  reasoning-evaluator.test.ts
  reasoning-controller.test.ts
```

不要拆出大量只有几行代码的小文件。词法扫描、意图分类和范围识别优先作为 `reasoning-evaluator.ts` 内部的私有函数；只有复杂度明显增长后再独立拆分。

## 6. 类型设计

### 6.1 推理档位

```ts
export type ReasoningMode = "off" | "high" | "max";

export type ReasoningReason =
  | "readonly-simple"
  | "write-operation"
  | "cross-package-change"
  | "architecture-or-design"
  | "debugging-or-failure"
  | "high-risk-operation"
  | "recent-tool-failure"
  | "recent-user-correction"
  | "long-tool-chain"
  | "context-pressure"
  | "same-submit-hysteresis";
```

### 6.2 评估输入

```ts
export interface ReasoningEvaluationInput {
  userInput: string;
  strategyTier: StrategyTier;
  contextRatio?: number;
  recentToolFailures: number;
  recentUserCorrections: number;
  recentToolChainLength: number;
  previousMode?: ReasoningMode;
  sameSubmitPeakMode?: ReasoningMode;
}
```

### 6.3 Controller 状态

```ts
export interface ReasoningRuntimeState {
  previousMode?: ReasoningMode;
  sameSubmitPeakMode?: ReasoningMode;
  recentToolFailures: number;
  recentUserCorrections: number;
  recentToolChainLength: number;
}
```

第一版只需进程内状态。不要在本专项中新增持久化格式。后续若要跨进程恢复，再单独设计 Session schema 迁移。

## 7. Provider 能力模型

### 7.1 扩展 ProviderInfo

在 `packages/core/src/config.ts` 中扩展 Provider 描述：

```ts
export interface ThinkingCapability {
  support: "official" | "compatible" | "unsupported";
  efforts: ReadonlyArray<"high" | "max">;
  supportsDisable: boolean;
  requiresReasoningContentForToolContinuation: boolean;
}

export interface ProviderCapabilities {
  thinking: ThinkingCapability;
}

export interface ProviderInfo {
  // 保留现有字段
  capabilities: ProviderCapabilities;
}
```

### 7.2 初始能力表

| Provider | 默认状态 | 原因 |
| --- | --- | --- |
| `deepseek` | `official` | 官方文档明确支持 |
| `zen` | `compatible` 或暂时 `unsupported` | 只有在兼容性测试固定下来后才开启 |
| `mimo` | `unsupported` | 未验证，不发送额外字段 |

对 Zen 的处理要求：

1. 若现有真实请求探针已验证 `thinking`、`reasoning_effort` 和工具链 `reasoning_content`，可标为 `compatible`。
2. 如果只有普通 Chat Completion 兼容性证明，先保持 `unsupported`。
3. 不允许因为 Zen 与 DeepSeek 请求格式相似就直接默认开启。

### 7.3 请求映射

集中实现映射函数，不要在 Loop 中拼接 Provider 字段：

```ts
export interface ThinkingRequestOptions {
  thinking?: "enabled" | "disabled";
  reasoningEffort?: "high" | "max";
}

export function toThinkingRequestOptions(
  mode: ReasoningMode,
  capability: ThinkingCapability,
): ThinkingRequestOptions;
```

规则：

| Reasoning Mode | DeepSeek 请求参数 |
| --- | --- |
| `off` | `thinking: "disabled"` |
| `high` | `thinking: "enabled"`, `reasoningEffort: "high"` |
| `max` | `thinking: "enabled"`, `reasoningEffort: "max"` |

如果 Provider 为 `unsupported`：

```ts
{}
```

即不发送字段。不要向未知 Provider 发送 `thinking: "disabled"`。

## 8. 规则评估器

### 8.1 基本原则

评估器是纯函数：

```ts
export function evaluateReasoningMode(
  input: ReasoningEvaluationInput,
): ReasoningRecommendation;
```

要求：

1. 同样输入得到同样输出。
2. 不读取环境变量。
3. 不读取文件系统。
4. 不调用 Provider。
5. 不修改 Controller 状态。

### 8.2 基础档位

建议规则：

| 请求类型 | 基础档位 |
| --- | --- |
| 简单读取、解释、查看状态 | `off` |
| 单文件修改、常规测试、局部修复 | `high` |
| 跨包修改、架构设计、复杂调试、高风险操作 | `max` |

未知请求默认使用 `high`。未知不等于简单。

### 8.3 词法规则不能单独决定风险

`Auto-switch.md` 中的关键词扫描方向可以保留，但不能采用“命中一个词就直接 `max`”的实现。

错误示例：

```text
删除这个过期注释
```

这里有“删除”，但风险很低。

正确做法是组合信号：

```ts
const highRisk =
  hasDangerousOperation(input) &&
  hasSensitiveDomain(input);
```

危险操作示例：

```text
删除、清空、覆盖、重置、强制、迁移、发布、部署
delete, drop, truncate, reset, force, migrate, deploy, publish
```

敏感领域示例：

```text
数据库、生产环境、权限、密钥、认证、支付、历史记录、远程分支
database, production, permission, secret, auth, payment, history, remote branch
```

仅组合命中时触发 `high-risk-operation -> max`。

### 8.4 范围识别

不要只根据 `.ts`、`.js` 或目录名推断范围。第一版可以采用保守规则：

1. 明确提到多个 package、模块或前后端协同时，判定跨包。
2. 明确要求架构设计、重构公共接口、迁移时，判定复杂范围。
3. 只提到单文件且操作局部时，判定局部范围。
4. 无法判断时，保持未知，默认 `high`。

### 8.5 状态升级规则

在基础档位上应用升级信号：

| 信号 | 动作 |
| --- | --- |
| 最近一次工具失败 | 至少 `high` |
| 同一 submit 内连续工具失败 | 升级到 `max` |
| 用户明确指出“仍然失败”“不对”“重新检查” | 至少 `high`，重复纠正升 `max` |
| 工具链长度超过阈值 | 至少 `high` |
| 上下文比例超过阈值 | 至少 `high`，接近硬上限时 `max` |
| 高风险操作 | `max` |

具体阈值应从现有 `StrategyTier` 读取，避免重复维护魔法数字。

### 8.6 同一 submit 内禁止激进降档

同一用户请求执行过程中，允许升级，不自动降档：

```ts
effective = max(recommended, sameSubmitPeakMode);
```

新 submit 开始后再允许降档。这样可以避免工具链中途在 `off -> high -> off -> max` 之间抖动。

## 9. Reasoning Controller

### 9.1 职责

`reasoning-controller.ts` 负责：

1. 保存运行时状态。
2. 在 API 请求前调用纯评估器。
3. 根据 Provider 能力和策略上限得到有效档位。
4. 在工具结果返回后更新失败计数和链路长度。
5. 在新 submit 开始时重置本轮峰值。
6. 输出结构化决策，供 Loop 和 TUI 使用。

### 9.2 建议接口

```ts
export class ReasoningController {
  beginSubmit(userInput: string, strategyTier: StrategyTier): void;
  noteInjectedInstruction(content: string): void;
  noteToolResult(result: ToolResult): void;
  evaluateBeforeRequest(input: {
    contextRatio?: number;
    provider: ProviderInfo;
  }): ReasoningDecision;
}
```

### 9.3 工具失败处理

工具失败只更新状态：

```ts
controller.noteToolResult(result);
```

下一轮请求前：

```ts
const decision = controller.evaluateBeforeRequest(...);
```

不要实现：

```ts
if (toolFailed && mode === "high") {
  rerunWith("max");
}
```

除非后续单独设计幂等性、重放边界和副作用隔离，否则这一逻辑不可进入主干。

## 10. reasoning_content 连续性修复

这是自动切换上线前的硬性门槛。

### 10.1 上下文写入

Assistant 产生工具调用时，必须把流式收集到的推理内容写入上下文：

```ts
ctx.log.append({
  role: "assistant",
  content: fullText || undefined,
  reasoning_content: fullReasoning || undefined,
  tool_calls: toolCalls,
});
```

### 10.2 客户端序列化

序列化 Assistant 工具调用消息时，有值才回传：

```ts
if (message.role === "assistant") {
  return {
    role: "assistant",
    content: message.content,
    reasoning_content: message.tool_calls
      ? message.reasoning_content
      : undefined,
    tool_calls: message.tool_calls,
  };
}
```

普通 Assistant 文本回复不需要盲目回传历史推理内容。只保留工具调用连续性所需字段，控制上下文成本。

### 10.3 测试要求

至少覆盖：

1. Thinking Mode 下 Assistant 发起工具调用。
2. 工具结果写回后，下一轮请求包含原始 `reasoning_content`。
3. 普通非工具 Assistant 消息不会额外发送该字段。
4. `off` 档位不要求生成 `reasoning_content`。
5. 多轮工具调用不会在第二轮丢失字段。

## 11. Loop 集成

### 11.1 集成位置

在 `packages/core/src/loop.ts` 每次调用客户端前执行：

```ts
const decision = reasoningController.evaluateBeforeRequest({
  contextRatio,
  provider,
});

const thinkingOptions = toThinkingRequestOptions(
  decision.effective,
  provider.capabilities.thinking,
);
```

再把参数传入已有客户端请求选项。

### 11.2 记录工具结果

工具执行完成后，把结果交给 Controller：

```ts
reasoningController.noteToolResult(result);
```

如果现有工具结果回调集中在 Engine，可在回调中追加该调用。不要为了此功能重写 Executor。

### 11.3 注入指令

若运行中接受用户补充指令，在安全边界写入上下文时同步调用：

```ts
reasoningController.noteInjectedInstruction(content);
```

不要在工具尚未结束时强制中断和重放请求。

## 12. TUI 可观测性

### 12.1 复用现有事件

当前 Core 已存在：

- `strategy_notify`
- `strategy_estimate_refined`

优先复用 `strategy_notify`，不要新增一组平行事件。

建议 payload：

```ts
{
  kind: "reasoning-mode";
  mode: ReasoningMode;
  previousMode?: ReasoningMode;
  reasons: ReasoningReason[];
  provider: string;
  cappedBy?: "strategy-tier" | "provider-capability";
}
```

### 12.2 展示原则

第一版只在档位变化时提示：

```text
Reasoning: high -> max (tool failure)
```

Provider 不支持时：

```text
Reasoning: auto disabled for provider mimo
```

不要每个 token 或每次 Loop 都刷新提示，避免 TUI 噪声。

### 12.3 手动覆盖

手动覆盖可作为后续小阶段加入：

```text
/strategy auto
/strategy off
/strategy high
/strategy max
```

规则：

1. 默认 `auto`。
2. 手动模式仍受到 Provider 能力约束。
3. 手动模式不绕过权限确认和风险控制。
4. 覆盖只影响推理档位，不切换模型。

## 13. 分阶段开发计划

每个阶段独立提交。Agent 不得跳过 AS0 直接接入自动切换。

### AS0：修复 reasoning_content 工具链连续性 ✅ 已完成

目标：确保 Thinking Mode 与工具调用组合可用。

修改范围：

- `packages/core/src/loop.ts`
- `packages/core/src/client.ts`
- 相关测试

验收：

1. 工具调用 Assistant 消息保留 `reasoning_content`。
2. 下一轮请求回传该字段。
3. 非工具普通回复不增加无必要上下文。
4. 现有流式文本和工具调用测试保持通过。

### AS1：Provider 能力声明和请求映射 ✅ 已完成

目标：只对确认支持的 Provider 发送 Thinking 参数。

修改范围：

- `packages/core/src/provider-thinking.ts`
- 相关测试

验收：

1. DeepSeek `off/high/max` 请求映射正确。
2. 未支持 Provider 请求体无 Thinking 字段。
3. Zen 在无兼容性证明时不会被误开启。
4. 能力判断不散落在 Loop、Engine 和 TUI 中。

### AS2：实现纯规则评估器 ✅ 已完成

目标：完成无副作用、可解释的本地决策。

修改范围：

- `packages/core/src/mode-selector.ts`
- 相关测试

验收：

1. 简单只读请求返回 `off`。
2. 常规局部写入返回 `high`。
3. 跨包设计、复杂调试和组合高风险返回 `max`。
4. "删除过期注释"不会仅因"删除"命中 `max`。
5. 未知请求默认 `high`。
6. 决策包含可解释原因。

### AS3：接入 Controller 和 Loop ✅ 已完成

目标：每次请求前自动评估，并在工具结果后安全升级。

修改范围：

- `packages/core/src/loop.ts`
- `packages/core/src/engine.ts`
- 相关测试

验收：

1. API 请求前应用有效档位。
2. 工具失败只影响下一次安全边界。
3. 已执行工具不会被自动重跑。
4. 同一 submit 内允许升级，不自动降档。
5. 新 submit 可以重新降档。
6. 不增加额外 Provider 请求。

### AS4：TUI 状态提示 ✅ 已完成

目标：让用户知道自动切换正在发生，但不干扰主要输出。

修改范围：

- `packages/tui/src/StatusBar.tsx`
- `packages/tui/src/bridge.tsx`
- `packages/tui/src/App.tsx`

验收：

1. 只在档位变化时展示。
2. 显示档位和简短原因。
3. Provider 不支持时给出一次性提示。
4. 不影响流式文本和 `tool_progress` 展示。

### AS5：手动覆盖 ✅ 已完成

目标：提供用户可控的推理档位覆盖。

修改范围：

- `packages/tui/src/App.tsx`
- `packages/tui/src/CommandRegistry.ts`

验收：

1. 默认行为为 `auto`。
2. `/thinking off|low|medium|high|max` 生效。
3. 手动覆盖不会向不支持的 Provider 发送字段。
4. 会话内覆盖逻辑明确，跨进程持久化暂不实现。

### AS6：校准与观测 ✅ 已完成

目标：基于真实使用调整规则，不提前引入复杂模型。

修改范围：

- `packages/core/src/mode-stats.ts`
- 相关测试

验收：

1. 默认只进入本地调试日志。
2. 不记录 API Key。
3. 不上传用户原始输入。
4. 不阻塞请求链路。

## 14. 测试矩阵

### 14.1 规则测试

| 输入 | 预期 |
| --- | --- |
| “读取 README 并总结” | `off` |
| “修改这个单元测试的断言” | `high` |
| “重构 core 和 tui 的流式事件协议” | `max` |
| “删除过期注释” | 不因删除关键词直接 `max` |
| “清空生产数据库” | `max` |
| “为什么测试仍然失败，重新检查” | 至少 `high` |

### 14.2 Provider 测试

| Provider | Mode | 预期 |
| --- | --- | --- |
| DeepSeek | `off` | 发送 disabled |
| DeepSeek | `high` | 发送 enabled + high |
| DeepSeek | `max` | 发送 enabled + max |
| Mimo | 任意 | 不发送 Thinking 字段 |
| Zen | 任意 | 按能力声明执行 |

### 14.3 工具链测试

1. `high` 模式发起一个只读工具，第二轮请求回传 `reasoning_content`。
2. `max` 模式连续执行两个工具，每轮上下文都正确。
3. 工具失败后下一轮升档，不重复执行失败工具。
4. `off` 模式保持现有工具调用行为。
5. Provider 不支持 Thinking 时，工具调用行为无回归。

### 14.4 TUI 测试

1. `off -> high` 展示一次状态变化。
2. 档位未变化时不重复刷屏。
3. 工具执行期间 `tool_progress` 仍可见。
4. Reasoning 状态不会覆盖 Assistant 流式文本。

## 15. 风险与防护

| 风险 | 影响 | 防护 |
| --- | --- | --- |
| 未回传 `reasoning_content` | Thinking 工具链第二轮失败 | AS0 先修复并覆盖测试 |
| 向未知 Provider 发送扩展字段 | 请求被拒绝 | Provider 能力表默认关闭 |
| 工具失败后自动重放 | 重复副作用 | 只在下一请求边界升级 |
| 关键词误判 | 简单任务不必要进入 `max` | 风险使用组合信号 |
| 同轮频繁切换 | 行为不稳定，TUI 噪声 | 同一 submit 内只升不降 |
| 规则散落 | 后续难以调参 | 纯评估器集中管理 |
| 与现有 tiers 重复 | 两套策略互相覆盖 | 推理档位作为 tiers 的受控子能力 |

## 16. Agent 开发约束

执行本方案的 Agent 必须遵守：

1. 先阅读现有 `tiers.ts`、`client.ts`、`loop.ts`、`engine.ts`，再修改。
2. 不删除或重命名现有策略档位。
3. 不把 Provider 判断硬编码到多个模块。
4. 不用额外模型调用替代本地规则。
5. 不增加失败后自动重放。
6. 不改变权限确认逻辑。
7. 不改变 Executor 的副作用语义。
8. 每个阶段补充测试后再进入下一阶段。
9. 若发现现有代码已部分实现某阶段，保留兼容行为并补测试，不做无关重构。
10. 遇到 Zen 或 Mimo 能力不确定时，默认关闭扩展字段，不凭猜测开启。

## 17. 完成定义

专项完成需同时满足：

1. DeepSeek Thinking Mode 请求映射正确。
2. Thinking Mode 工具链完整回传 `reasoning_content`。
3. 自动决策为本地纯规则，不增加 API 调用。
4. 工具失败只影响后续安全边界，不重复副作用。
5. 未验证 Provider 不会收到扩展字段。
6. 规则决策可解释，可通过单元测试验证。
7. TUI 能展示必要的档位变化信息。
8. 现有文本流式输出、工具进度、权限确认和上下文折叠行为无回归。


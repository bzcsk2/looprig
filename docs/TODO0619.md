下面是一份可以直接交给实现 Agent 的实施计划，目标是：

> **DeepReef 的所有关键运行参数都应该有统一配置系统。
> 用户既可以在 TUI 中临时调整，也可以通过配置文件做更精细、可版本化、可迁移的调整。
> TUI 调整和配置文件不是两套系统，而是同一套配置 schema 的两个入口。**

---

# DeepReef 可配置参数系统实施方案

## 0. 总目标

DeepReef 现在正在走向：

```text
双 Agent 架构
Goal Runtime
Mailbox 通信
长期自动 loop
本地小模型 + 免费中等模型监督
```

这类系统的参数会越来越多。如果全部写死在代码里，后续会很难调优。

因此需要建立一套统一配置体系：

```text
配置文件
  ↓
配置加载器
  ↓
Zod schema 校验
  ↓
默认值合并
  ↓
运行时 ConfigManager
  ↓
TUI / Engine / Workflow / Goal / Tools / Providers 统一读取
```

不要只做“几个设置项”。要把它设计成 DeepReef 的长期控制面。

---

# 1. 配置系统的基本原则

## 1.1 配置文件是主入口

TUI 可以调整配置，但配置文件必须是更完整、更精细的入口。

用户应该能这样做：

```bash
deepreef config path
deepreef config edit
deepreef config validate
deepreef config doctor
```

配置文件建议路径：

```text
~/.deepreef/config.toml
```

项目级覆盖配置：

```text
<project>/.deepreef/config.toml
```

会话级状态不要混进主配置，放到：

```text
<project>/.deepreef/sessions/<sessionId>/
```

最终配置优先级建议：

```text
CLI flags
  > TUI 临时设置
  > 项目级 .deepreef/config.toml
  > 用户级 ~/.deepreef/config.toml
  > DeepReef 内置默认值
```

如果暂时不做 CLI flags，也要预留层级。

---

## 1.2 配置必须有 schema

不要手写散乱的 `config.foo?.bar ?? default`。

必须用 `zod` 定义完整 schema：

```ts
const DeepReefConfigSchema = z.object({
  version: z.number(),
  providers: z.object(...),
  agents: z.object(...),
  workflow: z.object(...),
  goal: z.object(...),
  mailbox: z.object(...),
  tools: z.object(...),
  tui: z.object(...),
  logging: z.object(...),
})
```

你项目已经装了 `zod`，正适合做这个。

目标是：

```text
用户写错配置 → 启动时给清晰错误
配置缺字段 → 自动用默认值补齐
旧版本配置 → 迁移到新版本
TUI 设置 → 也走同一套 schema
```

---

## 1.3 配置分成三类

不是所有参数都应该同等对待。

### A. 静态配置

启动后不建议热更新。

```text
provider baseUrl
model id
sandbox policy
workspace root
工具白名单
日志目录
```

### B. 动态配置

TUI 可以随时调整，配置文件也可以保存。

```text
当前模型
approval mode
reasoning effort
loop max rounds
temperature
goal auto continuation
TUI 显示选项
```

### C. 运行状态

不能写进 config。

```text
当前 goal status
mailbox messages
tokensUsed
当前 workflow phase
last worker report
session history
```

这类应该进 session state，而不是 config。

---

# 2. 建议的配置文件结构

建议使用 TOML。原因：

```text
比 JSON 易手写
比 YAML 少坑
适合 CLI 工具
Rust/JS/TS 生态都容易解析
```

示例：

```toml
version = 1

[providers.default]
supervisor = "deepseek-free"
worker = "local-qwen"

[providers.deepseek-free]
type = "openai-compatible"
base_url = "https://api.deepseek.com/v1"
api_key_env = "DEEPSEEK_API_KEY"
model = "deepseek-chat"
free = true

[providers.local-qwen]
type = "openai-compatible"
base_url = "http://localhost:11434/v1"
api_key = "none"
model = "qwen2.5-coder:7b"
local = true

[agents.supervisor]
provider = "deepseek-free"
temperature = 0.2
reasoning_effort = "high"
max_output_tokens = 4096

[agents.worker]
provider = "local-qwen"
temperature = 0.1
reasoning_effort = "medium"
max_output_tokens = 8192

[workflow]
default_mode = "loop"
max_rounds = 8
max_consecutive_errors = 2
ask_user_on_blocked = true
structured_protocol = true
require_json_decisions = true
legacy_text_fallback = true

[goal]
enabled = true
auto_continue = true
max_auto_continuations = 10
max_consecutive_blocked_turns = 3
default_token_budget = 0
completion_audit_required = true
blocked_audit_required = true

[mailbox]
enabled = true
storage = "jsonl"
wait_timeout_ms = 30000
max_messages_per_role = 200
mark_read_after_turn = true

[tools]
approval_policy = "on-request"
sandbox = "workspace-write"
dangerous_tools_enabled = false

[tools.supervisor.loop]
allow = [
  "get_goal",
  "update_goal",
  "send_message",
  "followup_task",
  "read_mailbox",
  "wait_message",
  "todowrite"
]
deny = [
  "bash",
  "edit_file",
  "apply_patch",
  "write_file",
  "AgentTool"
]

[tools.worker.loop]
allow = [
  "get_goal",
  "send_message",
  "followup_task",
  "read_mailbox",
  "wait_message",
  "bash",
  "read_file",
  "grep",
  "list_dir",
  "edit_file",
  "apply_patch"
]
deny = [
  "update_goal"
]

[tui]
theme = "default"
show_agent_comm_feed = true
show_goal_panel = true
show_token_usage = true
compact_reasoning = true

[logging]
level = "info"
events_jsonl = true
path = ".deepreef/logs"
```

注意：

```text
default_token_budget = 0
```

可以表示不限制。不要用 `null`，TOML 里处理不方便。

---

# 3. 需要暴露的参数清单

下面这部分最重要。实现 Agent 不要只加模型配置，要把 DeepReef 的核心调参面都设计出来。

---

## 3.1 Provider 配置

路径：

```toml
[providers.<name>]
```

字段：

```ts
type ProviderConfig = {
  type: "openai-compatible" | "ollama" | "lmstudio" | "custom"
  baseUrl: string
  apiKey?: string
  apiKeyEnv?: string
  model: string
  local?: boolean
  free?: boolean
  timeoutMs?: number
  maxRetries?: number
  headers?: Record<string, string>
}
```

用途：

```text
支持本地模型
支持 OpenAI-compatible API
支持免费模型 provider
支持用户自己添加 provider
```

不要把 provider 写死成 DeepSeek/OpenAI/Ollama。DeepReef 的核心卖点之一就是模型组合灵活。

---

## 3.2 Agent 配置

路径：

```toml
[agents.supervisor]
[agents.worker]
```

字段：

```ts
type AgentConfig = {
  provider: string
  model?: string
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  reasoningEffort?: "low" | "medium" | "high"
  systemPromptOverride?: string
  systemPromptAppend?: string
  contextStrategy?: "full" | "summary" | "last_n_turns"
  contextTurns?: number
}
```

建议：

```text
Supervisor 默认强模型、低温、高 reasoning。
Worker 默认本地模型、低温、中等上下文。
```

保留 `systemPromptAppend`，让高级用户微调角色行为，但不要鼓励直接 override。

---

## 3.3 Workflow 配置

路径：

```toml
[workflow]
```

字段：

```ts
type WorkflowConfig = {
  defaultMode: "alone" | "subagent" | "loop"
  maxRounds: number
  maxConsecutiveErrors: number
  supervisorInterventionErrorThreshold: number
  structuredProtocol: boolean
  requireJsonDecisions: boolean
  legacyTextFallback: boolean
  askUserOnBlocked: boolean
  autoResumeAfterAskUser: boolean
}
```

说明：

```text
maxRounds:
  一次 loop 最大轮数。

maxConsecutiveErrors:
  Worker 连续错误几次触发 Supervisor 干预。

structuredProtocol:
  是否启用 SupervisorPlan / WorkerReport / SupervisorDecision JSON 协议。

requireJsonDecisions:
  如果 true，SupervisorDecision JSON 解析失败就 block。
  如果 false，可以 fallback 到 legacy text parser。

legacyTextFallback:
  兼容旧逻辑。
```

---

## 3.4 Goal 配置

路径：

```toml
[goal]
```

字段：

```ts
type GoalConfig = {
  enabled: boolean
  autoContinue: boolean
  maxAutoContinuations: number
  maxConsecutiveBlockedTurns: number
  maxConsecutiveTurnErrors: number
  defaultTokenBudget: number
  completionAuditRequired: boolean
  blockedAuditRequired: boolean
  injectContinuationPrompt: boolean
  injectObjectiveUpdatedPrompt: boolean
  injectBudgetLimitPrompt: boolean
}
```

说明：

```text
autoContinue:
  是否在 idle 时自动继续 active goal。

maxAutoContinuations:
  防止无限跑。

defaultTokenBudget:
  0 表示不限制。

completionAuditRequired:
  Supervisor complete 前必须逐项审计。

blockedAuditRequired:
  blocked 必须满足连续阻塞规则。
```

---

## 3.5 Mailbox 配置

路径：

```toml
[mailbox]
```

字段：

```ts
type MailboxConfig = {
  enabled: boolean
  storage: "memory" | "jsonl"
  waitTimeoutMs: number
  maxMessagesPerRole: number
  markReadAfterTurn: boolean
  persistStructuredPayloads: boolean
  showInTui: boolean
}
```

说明：

```text
storage = memory:
  测试和临时运行。

storage = jsonl:
  推荐默认，方便回放和调试。

waitTimeoutMs:
  wait_message 默认等待时间。

maxMessagesPerRole:
  防止 mailbox 无限膨胀。
```

---

## 3.6 Tool 权限配置

路径：

```toml
[tools]
[tools.supervisor.loop]
[tools.worker.loop]
[tools.supervisor.subagent]
[tools.worker.subagent]
```

字段：

```ts
type ToolPolicyConfig = {
  approvalPolicy: "never" | "on-request" | "on-failure" | "always"
  sandbox: "read-only" | "workspace-write" | "danger-full-access"
  dangerousToolsEnabled: boolean
  perRoleMode: Record<string, {
    allow: string[]
    deny: string[]
  }>
}
```

这是最值得开放给高级用户的地方。

例如用户可以配置：

```toml
[tools.worker.loop]
allow = ["read_file", "grep", "list_dir", "bash"]
deny = ["edit_file", "apply_patch"]
```

这样 DeepReef 可以变成“只读分析模式”。

或者：

```toml
[tools.worker.loop]
allow = ["read_file", "grep", "list_dir", "edit_file", "apply_patch", "bash"]
deny = []
```

变成自动修复模式。

---

## 3.7 Context / Memory 配置

路径：

```toml
[context]
```

字段：

```ts
type ContextConfig = {
  strategy: "full" | "summary" | "sliding_window" | "goal_focused"
  maxInputTokens: number
  summaryEnabled: boolean
  summaryEveryTurns: number
  includeMailboxHistory: boolean
  includeGoalHistory: boolean
  includeToolEvents: boolean
}
```

用途：

```text
小模型非常需要上下文控制。
Goal loop 自动续跑时不能无限带历史。
Mailbox 也不能无限塞进 prompt。
```

建议默认：

```toml
[context]
strategy = "goal_focused"
max_input_tokens = 24000
summary_enabled = true
summary_every_turns = 4
include_mailbox_history = true
include_goal_history = true
include_tool_events = false
```

---

## 3.8 TUI 配置

路径：

```toml
[tui]
```

字段：

```ts
type TuiConfig = {
  theme: string
  showGoalPanel: boolean
  showAgentCommFeed: boolean
  showTokenUsage: boolean
  showToolEvents: boolean
  compactReasoning: boolean
  confirmBeforeReplacingGoal: boolean
  confirmDangerousToolPolicy: boolean
}
```

TUI 是配置入口之一，但不是配置系统本身。

---

## 3.9 Logging / Trace 配置

路径：

```toml
[logging]
[trace]
```

字段：

```ts
type LoggingConfig = {
  level: "debug" | "info" | "warn" | "error"
  path: string
  eventsJsonl: boolean
  mailboxJsonl: boolean
  workflowJsonl: boolean
  redactSecrets: boolean
}

type TraceConfig = {
  enabled: boolean
  includePrompts: boolean
  includeToolArgs: boolean
  includeToolResults: boolean
  includeModelOutputs: boolean
}
```

默认必须保护用户隐私：

```toml
[trace]
enabled = true
include_prompts = false
include_tool_args = true
include_tool_results = false
include_model_outputs = false
```

高级用户可以打开完整 trace。

---

# 4. 配置文件加载与合并

新增模块：

```text
packages/core/src/config/schema.ts
packages/core/src/config/defaults.ts
packages/core/src/config/loader.ts
packages/core/src/config/manager.ts
packages/core/src/config/migrations.ts
packages/core/src/config/errors.ts
```

---

## 4.1 schema.ts

职责：

```text
定义 zod schema
导出 DeepReefConfig 类型
导出 parseConfig(raw)
```

示例：

```ts
import { z } from "zod"

export const WorkflowConfigSchema = z.object({
  defaultMode: z.enum(["alone", "subagent", "loop"]).default("alone"),
  maxRounds: z.number().int().positive().default(6),
  maxConsecutiveErrors: z.number().int().positive().default(2),
  supervisorInterventionErrorThreshold: z.number().int().positive().default(2),
  structuredProtocol: z.boolean().default(true),
  requireJsonDecisions: z.boolean().default(true),
  legacyTextFallback: z.boolean().default(true),
  askUserOnBlocked: z.boolean().default(true),
  autoResumeAfterAskUser: z.boolean().default(false),
})

export const DeepReefConfigSchema = z.object({
  version: z.number().int().default(1),
  providers: z.record(z.string(), ProviderConfigSchema).default({}),
  agents: AgentsConfigSchema.default({}),
  workflow: WorkflowConfigSchema.default({}),
  goal: GoalConfigSchema.default({}),
  mailbox: MailboxConfigSchema.default({}),
  tools: ToolsConfigSchema.default({}),
  context: ContextConfigSchema.default({}),
  tui: TuiConfigSchema.default({}),
  logging: LoggingConfigSchema.default({}),
  trace: TraceConfigSchema.default({}),
})

export type DeepReefConfig = z.infer<typeof DeepReefConfigSchema>
```

注意命名问题：

TOML 建议 snake_case，但 TS 内部建议 camelCase。

需要做 normalize：

```text
config.toml:
  max_rounds

TS:
  maxRounds
```

可以用两种方案：

### 方案 A：配置文件也用 camelCase

简单，但不太符合 TOML 习惯。

### 方案 B：加载时 normalize snake_case 到 camelCase

稍复杂，但用户体验更好。

建议 Phase 1 先用 snake_case schema，内部转 camelCase。

---

## 4.2 defaults.ts

所有默认值集中在一个文件，不要散落在各模块。

```ts
export const DEFAULT_CONFIG: DeepReefConfig = {
  version: 1,
  providers: {},
  agents: {
    supervisor: {
      provider: "default",
      temperature: 0.2,
      reasoningEffort: "high",
      maxOutputTokens: 4096,
    },
    worker: {
      provider: "default",
      temperature: 0.1,
      reasoningEffort: "medium",
      maxOutputTokens: 8192,
    },
  },
  workflow: {
    defaultMode: "alone",
    maxRounds: 6,
    maxConsecutiveErrors: 2,
    supervisorInterventionErrorThreshold: 2,
    structuredProtocol: true,
    requireJsonDecisions: true,
    legacyTextFallback: true,
    askUserOnBlocked: true,
    autoResumeAfterAskUser: false,
  },
  goal: {
    enabled: true,
    autoContinue: true,
    maxAutoContinuations: 10,
    maxConsecutiveBlockedTurns: 3,
    maxConsecutiveTurnErrors: 2,
    defaultTokenBudget: 0,
    completionAuditRequired: true,
    blockedAuditRequired: true,
    injectContinuationPrompt: true,
    injectObjectiveUpdatedPrompt: true,
    injectBudgetLimitPrompt: true,
  },
  // ...
}
```

---

## 4.3 loader.ts

职责：

```text
1. 找用户级配置
2. 找项目级配置
3. 解析 TOML
4. 合并默认值
5. 应用环境变量替换
6. zod 校验
7. 返回 EffectiveConfig
```

接口：

```ts
export interface ConfigLoadOptions {
  cwd: string
  userConfigPath?: string
  projectConfigPath?: string
  cliOverrides?: Partial<DeepReefConfig>
}

export async function loadConfig(options: ConfigLoadOptions): Promise<{
  config: DeepReefConfig
  sources: ConfigSource[]
  warnings: ConfigWarning[]
}>
```

配置源：

```ts
type ConfigSource = {
  kind: "default" | "user" | "project" | "cli" | "tui"
  path?: string
  loaded: boolean
}
```

合并规则：

```text
对象递归合并
数组默认替换，不做 concat
null 表示显式清空
undefined 表示不覆盖
```

工具 allow/deny 数组尤其要注意：项目级配置应该可以完整覆盖用户级配置。

---

## 4.4 manager.ts

运行时统一入口。

```ts
export class ConfigManager {
  get(): DeepReefConfig
  getWorkflowConfig(): WorkflowConfig
  getGoalConfig(): GoalConfig
  getAgentConfig(role: "supervisor" | "worker"): AgentConfig
  getToolPolicy(role: AgentRole, mode: WorkflowMode): ToolRoleModePolicy
  update(partial: Partial<DeepReefConfig>, source: "tui" | "cli"): Promise<void>
  saveUserConfig(): Promise<void>
  saveProjectConfig(): Promise<void>
  reload(): Promise<void>
  onChange(listener: (config: DeepReefConfig) => void): () => void
}
```

注意：

```text
TUI 改配置时，不要直接改 engine 内部变量。
必须调用 ConfigManager.update()。
Engine / Coordinator / ToolResolver 从 ConfigManager 获取 effective config。
```

---

# 5. CLI 命令设计

新增：

```bash
deepreef config path
deepreef config print
deepreef config edit
deepreef config validate
deepreef config doctor
deepreef config init
```

## 5.1 `deepreef config path`

输出：

```text
User config:    ~/.deepreef/config.toml
Project config: /path/to/project/.deepreef/config.toml
Effective:      user + project + defaults
```

## 5.2 `deepreef config print`

输出 effective config。支持：

```bash
deepreef config print --json
deepreef config print --toml
deepreef config print --redact
```

默认 redact secrets：

```text
api_key = "***"
```

## 5.3 `deepreef config edit`

打开 `$EDITOR`。

```bash
deepreef config edit
deepreef config edit --project
```

## 5.4 `deepreef config validate`

校验配置。

输出：

```text
✓ Config valid
```

或：

```text
✗ Config invalid

[workflow.max_rounds]
Expected positive integer, received -1.

[providers.local.base_url]
Invalid URL.
```

## 5.5 `deepreef config doctor`

做更深检查：

```text
provider 是否可连接
api key env 是否存在
local base_url 是否可访问
worker/supervisor provider 是否存在
tool allow/deny 是否冲突
goal budget 是否合理
```

---

# 6. TUI 配置入口设计

TUI 不是配置的唯一入口，但应该能改常用项。

建议增加 `/config`：

```text
/config
/config workflow
/config goal
/config models
/config tools
/config tui
/config open
/config reload
```

## 6.1 `/config`

展示当前 effective config 摘要：

```text
Config
User: ~/.deepreef/config.toml
Project: .deepreef/config.toml

Supervisor: deepseek-free / deepseek-chat
Worker: local-qwen / qwen2.5-coder
Mode: loop
Goal auto continue: on
Max auto continuations: 10
Mailbox: jsonl
Tool approval: on-request

Commands:
/config models
/config workflow
/config goal
/config tools
/config open
/config reload
```

## 6.2 `/config goal`

可调：

```text
auto_continue
max_auto_continuations
token_budget
completion_audit_required
blocked_audit_required
```

## 6.3 `/config workflow`

可调：

```text
default_mode
max_rounds
structured_protocol
require_json_decisions
legacy_text_fallback
```

## 6.4 `/config tools`

可调：

```text
approval_policy
sandbox
dangerous_tools_enabled
role/mode tool policies
```

复杂 allow/deny 列表不要在 TUI 里完整编辑，给入口打开文件即可。

---

# 7. 配置热更新策略

不是所有配置都能热更新。

建议每个配置项定义 `reloadBehavior`：

```ts
type ReloadBehavior =
  | "immediate"
  | "next_turn"
  | "next_session"
  | "restart_required"
```

示例：

```text
tui.theme:
  immediate

workflow.maxRounds:
  next_turn

goal.autoContinue:
  immediate

providers.local-qwen.baseUrl:
  next_session 或 restart_required

tools.worker.loop.allow:
  next_turn

logging.level:
  immediate
```

实现上可以先简化：

```text
TUI 修改：
  立即更新 ConfigManager
  当前 running turn 不受影响
  下一 turn 生效
```

---

# 8. 配置迁移

新增：

```text
packages/core/src/config/migrations.ts
```

结构：

```ts
type ConfigMigration = {
  from: number
  to: number
  migrate(raw: unknown): unknown
}

export function migrateConfig(raw: unknown): unknown {
  // version 0 → 1
  // version 1 → 2
}
```

配置文件必须有：

```toml
version = 1
```

`deepreef config validate` 发现旧版本时提示：

```text
Config version 0 detected. Run:
deepreef config migrate
```

可选命令：

```bash
deepreef config migrate
deepreef config migrate --write
```

---

# 9. Secret 管理

不要鼓励用户把 API key 明文写进 config。

支持三种方式：

```toml
api_key_env = "DEEPSEEK_API_KEY"
```

```toml
api_key_cmd = "pass show deepseek/api-key"
```

```toml
api_key = "sk-..."
```

优先级：

```text
api_key
api_key_env
api_key_cmd
```

但 `config doctor` 如果发现明文 key，应警告：

```text
Warning: providers.deepseek.api_key stores a secret in plaintext.
Prefer api_key_env = "DEEPSEEK_API_KEY".
```

打印配置默认必须 redact。

---

# 10. 与现有模块的集成点

## 10.1 Provider / Model 选择

当前如果模型选择逻辑散落在 TUI 和 engine 里，需要集中到：

```text
ConfigManager.getAgentConfig(role)
ProviderRegistry.resolve(agentConfig.provider)
```

新增：

```ts
class ProviderRegistry {
  constructor(configManager: ConfigManager)
  getProvider(name: string): ProviderConfig
  createClient(name: string): ModelClient
  listProviders(): ProviderSummary[]
}
```

---

## 10.2 Tool Resolver

之前建议你改造 `resolveEffectiveTools()`，现在进一步要求：

```ts
resolveEffectiveTools({
  role,
  mode,
  requestedTools,
  config: configManager.getToolPolicy(role, mode),
})
```

逻辑：

```text
base tools
  ↓
role/mode built-in safety
  ↓
config allow/deny
  ↓
dangerous tools gate
  ↓
approval/sandbox gate
```

注意：用户配置不能突破硬安全边界。

例如：

```toml
[tools.supervisor.loop]
allow = ["bash"]
```

系统仍然应该拒绝，因为 Supervisor loop 硬规则不能执行工程工具。

所以要区分：

```text
hard deny:
  代码内不可突破

user deny:
  用户自定义禁用

user allow:
  只能在 hard allow 范围内开启
```

---

## 10.3 GoalRuntime

GoalRuntime 读取：

```ts
const goalConfig = configManager.get().goal
```

使用：

```text
autoContinue
maxAutoContinuations
maxConsecutiveBlockedTurns
defaultTokenBudget
completionAuditRequired
blockedAuditRequired
```

---

## 10.4 Mailbox

Mailbox 读取：

```ts
config.mailbox.storage
config.mailbox.waitTimeoutMs
config.mailbox.maxMessagesPerRole
config.mailbox.persistStructuredPayloads
```

---

## 10.5 WorkflowCoordinator

WorkflowCoordinator 读取：

```ts
config.workflow.maxRounds
config.workflow.structuredProtocol
config.workflow.requireJsonDecisions
config.workflow.legacyTextFallback
config.workflow.supervisorInterventionErrorThreshold
```

不要在 constructor 里把这些值复制成常量，除非明确只在 session start 生效。

---

# 11. 配置文档自动生成

因为配置项会多，必须自动生成文档。

新增：

```bash
deepreef config schema
deepreef config docs
```

输出：

```text
docs/configuration.md
```

每个配置项包括：

```text
路径
类型
默认值
说明
是否可热更新
示例
```

可以先手写 `docs/configuration.md`，后续再自动生成。

---

# 12. 默认配置模板

新增：

```text
packages/core/src/config/templates/default-config.toml
packages/core/src/config/templates/local-first-config.toml
packages/core/src/config/templates/safe-readonly-config.toml
packages/core/src/config/templates/autonomous-coding-config.toml
```

## 12.1 local-first-config

适合你的产品主张：

```toml
[providers.default]
supervisor = "deepseek-free"
worker = "local-qwen"

[goal]
auto_continue = true
max_auto_continuations = 20

[tools.worker.loop]
allow = ["read_file", "grep", "list_dir", "bash", "edit_file", "apply_patch"]
deny = []

[tools]
approval_policy = "on-request"
sandbox = "workspace-write"
```

## 12.2 safe-readonly-config

```toml
[tools.worker.loop]
allow = ["read_file", "grep", "list_dir"]
deny = ["bash", "edit_file", "apply_patch", "write_file"]

[tools]
approval_policy = "always"
sandbox = "read-only"
```

## 12.3 autonomous-coding-config

```toml
[goal]
auto_continue = true
max_auto_continuations = 50

[tools]
approval_policy = "on-failure"
sandbox = "workspace-write"
dangerous_tools_enabled = false
```

---

# 13. 实施阶段

## Phase 1：配置 schema 和加载器

任务：

```text
1. 新增 config/schema.ts
2. 新增 config/defaults.ts
3. 新增 config/loader.ts
4. 支持 ~/.deepreef/config.toml
5. 支持 <project>/.deepreef/config.toml
6. 支持默认值合并
7. 支持 zod 校验
```

验收：

```bash
deepreef config validate
```

能校验配置并输出清晰错误。

---

## Phase 2：ConfigManager

任务：

```text
1. 新增 ConfigManager
2. 启动时加载 effective config
3. Provider / Workflow / Goal / ToolResolver 改为从 ConfigManager 取配置
4. 禁止模块内部散落默认值
```

验收：

```text
修改 workflow.max_rounds 后，loop 最大轮数变化。
修改 agents.worker.provider 后，Worker 使用新 provider。
```

---

## Phase 3：CLI 配置命令

任务：

```text
1. deepreef config path
2. deepreef config print
3. deepreef config validate
4. deepreef config init
5. deepreef config edit
6. deepreef config doctor
```

验收：

```bash
deepreef config init --template local-first
deepreef config validate
deepreef config print --redact
```

---

## Phase 4：TUI 配置入口

任务：

```text
1. /config
2. /config workflow
3. /config goal
4. /config models
5. /config tools
6. /config open
7. /config reload
```

验收：

```text
TUI 可以查看 effective config。
TUI 修改 goal.auto_continue 后，GoalRuntime 下一次 idle 生效。
```

---

## Phase 5：Tool policy 外部化

任务：

```text
1. 改造 resolveEffectiveTools()
2. 支持 role/mode allow/deny
3. 实现 hard deny
4. 实现 user deny
5. 实现 dangerous tool gate
```

验收：

```text
配置 deny apply_patch 后，Worker 不能改文件。
配置 allow bash 但 Supervisor loop 仍不能 bash。
```

---

## Phase 6：Goal / Mailbox / Workflow 参数接入

任务：

```text
1. GoalRuntime 接入 goal config
2. Mailbox 接入 mailbox config
3. WorkflowCoordinator 接入 workflow config
4. structured protocol 接入 requireJsonDecisions / fallback
```

验收：

```text
max_auto_continuations = 1 时，goal 最多自动续跑一轮。
wait_timeout_ms 改变 wait_message 行为。
require_json_decisions = true 时，非法 JSON 会 block。
```

---

## Phase 7：文档和模板

任务：

```text
1. docs/configuration.md
2. default-config.toml
3. local-first-config.toml
4. safe-readonly-config.toml
5. autonomous-coding-config.toml
```

验收：

```bash
deepreef config init --template safe-readonly
```

生成对应配置。

---

# 14. 给实现 Agent 的提示词

你可以直接把下面这段交给实现 Agent。

```markdown
你要为 DeepReef 实现统一配置系统，让用户既可以通过 TUI 调整常用参数，也可以通过配置文件精细控制 DeepReef 的 provider、agent、workflow、goal、mailbox、tools、context、tui、logging、trace 等参数。

核心要求：
1. 配置文件是主入口，TUI 是同一套配置系统的 UI。
2. 使用 TOML 配置文件。
3. 支持用户级配置：~/.deepreef/config.toml。
4. 支持项目级配置：<project>/.deepreef/config.toml。
5. 合并优先级：CLI overrides > TUI runtime overrides > project config > user config > defaults。
6. 使用 zod 定义完整 schema 和默认值。
7. 配置错误必须给出清晰路径和原因。
8. secrets 默认 redacted，推荐 api_key_env。
9. Tool policy 必须有 hard safety boundary，用户配置不能突破 Supervisor loop 禁止工程工具等硬限制。
10. 所有默认值集中在 config/defaults.ts，不要散落到业务模块。

请按阶段实现：

Phase 1:
- 新增 packages/core/src/config/schema.ts
- 新增 packages/core/src/config/defaults.ts
- 新增 packages/core/src/config/loader.ts
- 新增 packages/core/src/config/manager.ts
- 支持读取 ~/.deepreef/config.toml 和 <project>/.deepreef/config.toml
- 支持默认值合并和 zod 校验

Phase 2:
- 新增 CLI 命令：
  - deepreef config path
  - deepreef config print --redact
  - deepreef config validate
  - deepreef config init
  - deepreef config edit
  - deepreef config doctor

Phase 3:
- 将 ProviderRegistry / AgentRuntime / WorkflowCoordinator / GoalRuntime / Mailbox / resolveEffectiveTools 改为读取 ConfigManager。
- 不允许这些模块继续使用散落的硬编码默认值。

Phase 4:
- 实现 tool policy：
  - [tools.supervisor.loop]
  - [tools.worker.loop]
  - [tools.supervisor.subagent]
  - [tools.worker.subagent]
- 支持 allow/deny。
- 实现 hard deny：
  - Supervisor + loop 永远不能 bash/edit/apply_patch/write_file/AgentTool。
  - Worker + loop 永远不能 update_goal。

Phase 5:
- 新增 TUI 命令：
  - /config
  - /config workflow
  - /config goal
  - /config models
  - /config tools
  - /config open
  - /config reload

Phase 6:
- 新增配置模板：
  - default-config.toml
  - local-first-config.toml
  - safe-readonly-config.toml
  - autonomous-coding-config.toml
- 新增 docs/configuration.md。

配置 schema 至少覆盖：
- providers
- agents.supervisor
- agents.worker
- workflow
- goal
- mailbox
- tools
- context
- tui
- logging
- trace

验收标准：
1. 用户可以通过 ~/.deepreef/config.toml 设置默认 Supervisor/Worker provider。
2. 项目级 .deepreef/config.toml 可以覆盖用户级配置。
3. deepreef config validate 能显示准确错误路径。
4. deepreef config print --redact 不泄露 API key。
5. 修改 workflow.max_rounds 后 loop 轮数变化。
6. 修改 goal.max_auto_continuations 后 goal 自动续跑次数变化。
7. 修改 mailbox.wait_timeout_ms 后 wait_message 行为变化。
8. deny apply_patch 后 Worker 无法改文件。
9. 用户即使 allow bash，Supervisor loop 仍不能执行 bash。
10. TUI 修改的配置和配置文件系统使用同一套 ConfigManager。
```

---

# 15. 最终效果

实现后，DeepReef 会变成这种形态：

```text
用户级配置
  ~/.deepreef/config.toml

项目级配置
  .deepreef/config.toml

运行时配置
  TUI /config

统一入口
  ConfigManager

下游模块
  ProviderRegistry
  AgentRuntime
  WorkflowCoordinator
  GoalRuntime
  AgentCommController
  ToolResolver
  TUI
```

这样 DeepReef 的核心能力就不再是硬编码的，而是可以被用户调优：

```text
想安全：safe-readonly-config
想本地优先：local-first-config
想长期自动工作：autonomous-coding-config
想精细控制：直接改 TOML
```

这会非常符合你的产品方向：**让小模型真正能干活，而且用户可以像调工程系统一样调 Agent 系统。**

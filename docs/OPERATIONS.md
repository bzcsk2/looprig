# Operations

最后整合日期：2026-06-25。

本文档是安装、运行、配置、诊断和安全使用 Covalo 的操作参考。

## 安装与启动

安装已发布的 CLI：

```bash
npm install -g @covalo/cli
```

或：

```bash
bun install -g @covalo/cli
```

从源码运行：

```bash
git clone https://github.com/bzcsk2/Covalo.git
cd Covalo
bun install
bun run dev
```

顶级 CLI 命令：

```bash
covalo                         # 启动交互式 TUI
covalo --help                  # 显示帮助
covalo --version               # 显示版本
covalo config <subcommand>     # 管理配置
```

## TUI 命令

常用斜杠命令：

| 命令 | 用途 |
| --- | --- |
| `/help` | 显示帮助。 |
| `/model` | 切换当前角色的提供商/模型/基础 URL/API 密钥。 |
| `/workflow` | 启动或控制 Supervisor/Worker 循环。 |
| `/goal` | 查看或管理活跃的循环目标。 |
| `/sessions` | 浏览和恢复会话。 |
| `/skill` | 浏览和启用技能。 |
| `/status` | 显示运行时状态。 |
| `/context` | 调整上下文策略。 |
| `/thinking` | 调整思考模式。 |
| `/harness` | 调整弱模型执行约束。 |
| `/lang` | 切换中/英文界面语言。 |
| `/config` | 显示或更改配置。 |

目标命令仅在循环/工作流模式下有意义：

```text
/goal
/goal <objective>
/goal edit <new objective>
/goal pause
/goal resume
/goal clear
/goal budget <tokens>
/goal no-budget
```

目标状态与会话一起持久化：

```text
.covalo/sessions/<sessionId>/goal.json
```

## 配置

Covalo 现在拥有统一的 TOML 配置系统。配置通过 Zod 验证，并从默认值、用户配置、项目配置以及 CLI/TUI 覆盖中加载。

有效优先级（从低到高）：

```text
built-in defaults
  < user config: ~/.covalo/config.toml
  < project config: <project>/.covalo/config.toml
  < CLI overrides
  < TUI/session-level temporary overrides
```

运行时状态不属于静态配置。会话、活跃目标状态、邮箱条目、令牌用量和工作流阶段仍然是运行时/会话数据。

### 配置 CLI

```bash
covalo config path
covalo config print
covalo config print --redact
covalo config print --json
covalo config validate
covalo config doctor
covalo config edit
covalo config init
covalo config init --template local-first
covalo config init --template safe-readonly
covalo config init --template autonomous-coding
```

使用 `--project` 配合 `init` 或 `edit` 可针对项目配置而非用户配置。

### 配置结构

规范的代码内模式使用 camelCase 键。解析器也能规范化 snake_case 输入，但新的文档和示例应优先使用 camelCase。

最小示例：

```toml
version = 1

[workflow]
defaultMode = "loop"
maxRounds = 6
structuredProtocol = true
requireJsonDecisions = true
legacyTextFallback = true
askUserOnBlocked = true
autoResumeAfterAskUser = false
maxConsecutiveErrors = 2
supervisorInterventionErrorThreshold = 2

[goal]
enabled = true
autoContinue = true
maxAutoContinuations = 10
maxConsecutiveBlockedTurns = 3
maxConsecutiveTurnErrors = 2
defaultTokenBudget = 0
completionAuditRequired = true
blockedAuditRequired = true
injectContinuationPrompt = true
injectObjectiveUpdatedPrompt = true
injectBudgetLimitPrompt = true

[tools]
approvalPolicy = "on-request"
sandbox = "workspace-write"
dangerousToolsEnabled = false

[tools.supervisor.loop]
allow = []
deny = ["bash", "edit_file", "apply_patch", "write_file", "AgentTool"]

[tools.worker.loop]
allow = []
deny = ["update_goal"]

[logging]
level = "info"
path = ".covalo/logs"
eventsJsonl = true
mailboxJsonl = true
workflowJsonl = true
redactSecrets = true
```

提供商示例：

```toml
[providers.local]
type = "openai-compatible"
baseUrl = "http://localhost:11434/v1"
apiKey = "none"
model = "qwen2.5-coder:7b"
local = true
free = false
timeoutMs = 30000
maxRetries = 3
headers = {}

[agents.worker]
provider = "local"
reasoningEffort = "medium"
temperature = 0.1
topP = 1
maxOutputTokens = 8192
contextStrategy = "full"
contextTurns = 20
```

### 配置故障排查

```bash
# 显示配置路径
covalo config path

# 验证用户/项目/有效配置
covalo config validate

# 打印有效配置（机密信息已脱敏）
covalo config print --redact

# 检查可能的配置问题
covalo config doctor
```

如果配置未生效，请检查目标路径，运行 `covalo config validate`，在 TUI 中重新加载（如适用），并确认是否有优先级更高的项目配置覆盖了用户配置。

## 模型提供商

Covalo 支持内置的提供商系列以及任意兼容 OpenAI 的端点。使用 `/model` 进行交互式选择和角色分配。

| 系列 | 说明 |
| --- | --- |
| DeepSeek | `deepseek-v4-flash-free`、`deepseek-v4-flash`、`deepseek-v4-pro`；支持用户 API 密钥。 |
| Mimo | `mimo-v2.5-free`、`mimo-v2.5-pro`、`mimo-v2.5`；支持用户 API 密钥。 |
| Qwen | 通过 vLLM、Ollama、llama.cpp 或兼容 OpenAI 的端点使用 Qwen 模型。 |
| Gemma | 通过 vLLM、Ollama、llama.cpp 或兼容 OpenAI 的端点使用 Gemma 模型。 |
| Kimi | Kimi 模型预设；支持用户 API 密钥。 |
| GLM/ZAI | GLM 模型预设；支持用户 API 密钥。 |
| Minimax | Minimax 模型预设。 |
| Stepfun | `step-3.7-flash-free`、`step-3.7-flash`、`step-3.7-turbo`；支持用户 API 密钥。 |
| NVIDIA | Nemotron/NIM 预设；支持 NIM API 密钥。 |
| OpenAI | 兼容 OpenAI 的预设，如 `gpt-oss-120b`；支持用户 API 密钥。 |
| Custom | 任意兼容 OpenAI 的端点。 |

思考模式：

```text
/thinking off
/thinking high
/thinking max
```

DeepSeek 风格用法的推荐分工：

- Supervisor：较强模型，较高思考层级，偏重审查的角色。
- Worker：较便宜/免费/本地模型，偏重执行的的角色，配备更严格的约束和证据报告。

提供商/模型 ID 的变更速度快于架构。更新本节时，以 `packages/core/src/config.ts` 为准。

## 日志与诊断

统一配置中包含 `[logging]` 部分：

```toml
[logging]
level = "info"          # debug | info | warn | error
path = ".covalo/logs"
eventsJsonl = true
mailboxJsonl = true
workflowJsonl = true
redactSecrets = true
```

预期的日志布局：

```text
.covalo/logs/
  runtime-YYYY-MM-DD.jsonl
  mailbox-YYYY-MM-DD.jsonl
  workflow-YYYY-MM-DD.jsonl
```

JSONL 记录旨在配合 `jq` 使用：

```bash
# 检查警告/错误
cat .covalo/logs/*.jsonl | jq 'select(.level == "warn" or .level == "error")'

# 检查工具失败
cat .covalo/logs/*.jsonl | jq 'select(.event == "tool.execute.done" and .isError == true)'

# 检查 API 用量（如存在）
cat .covalo/logs/*.jsonl | jq 'select(.event == "api.usage")'
```

API 密钥、授权头、令牌、cookies、密码和机密等敏感字段应被脱敏。除非在仅本地的临时环境中调试，否则请保持 `redactSecrets = true`。

## 追踪

追踪配置位于 `[trace]` 下：

```toml
[trace]
enabled = true
includePrompts = false
includeToolArgs = true
includeToolResults = false
includeModelOutputs = false
```

如果启用了提示词或模型输出捕获，请将追踪文件视为敏感产物。

## 安全边界

Covalo 是一个本地工程代理。它可以读写文件、运行命令、访问网络以及调用扩展工具。它不是一个完整的沙箱。

当前的安全机制包括：

- 基于拒绝列表的权限引擎，
- 写入和 shell 权限检查，
- 危险命令拦截，
- 过期读取编辑保护，
- 文件快照，
- 网络请求 SSRF 防护，
- 基于角色/模式/工作流阶段的工具过滤，
- 可配置的硬拒绝工具策略。

操作规则：

- 请勿提交 API 密钥或 `.covalo/` 运行时/会话数据。
- 请勿在你无法审查变更的仓库中运行自主编码模式。
- 对于审计、新手上手和仓库探索，建议使用 `safe-readonly` 配置。
- 对于团队/仓库策略，建议使用项目级配置；对于个人模型/提供商偏好，建议使用用户级配置。

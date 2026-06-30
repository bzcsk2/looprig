# LoopRig Observability and Eval Logging Spec

本文档是给后续 agent 实施的开发规范。目标是让 LoopRig 的普通运行日志、loop 模式日志、eval 模式日志能够精确反映系统状态，支持开发者快速判断问题属于 Worker、Supervisor、模型、工具、sandbox、verifier、registry 还是 LoopRig 自身架构。

本 spec 不采用 OpenFugu 式 learned router 方案。这里只处理 LoopRig 自身的日志、trace、report、cache 命中观测和 eval 失败归因。

## Current Problems

当前系统已有基础日志能力，但不足以支撑可靠开发诊断：

- Runtime logger 是通用 JSONL，但事件 schema 松散，默认关闭，且缺少统一 `runId/caseId/workflowId/phase` 关联字段。
- Eval `trace.jsonl` 粒度太粗，主要只有 `eval-start/preflight/case-start/case-end`，不能还原 setup、worker、tool、verifier、policy gate、supervisor review 的完整生命周期。
- Manifest missing 只增加 `errored` 计数，不生成 `CaseResult` 和 case artifact，导致 summary/report 统计失真。
- Verifier 基础设施失败会被当作普通 Worker fail。例如 `No tests found`、`Script not found`、缺 binary/module 等不应计入 Worker 能力失败。
- `provider-env.json` 记录 host 环境多，记录 sandbox 实际隔离策略少，不能证明本次 eval 的真实 sandbox 状态。
- Tool tracking 只有全局 calls/failures，缺工具名、cwd、permission decision、exit code、stdout/stderr 摘要。
- Cache 命中是 LoopRig 关键设计，但 eval report 没有按 run/case/submit 聚合 `cacheHitTokens/cacheMissTokens`，也没有记录 prefix cache 是否命中。
- Report summary 的 breakdown 依赖 `suiteSummary.results`，但部分错误路径没有进入 results，导致 infrastructure/task failure 统计不可信。

## Target Outcome

每一次 LoopRig 运行，尤其是 eval 运行，必须能回答这些问题：

```text
这次运行用的是什么模式、模型、provider、workflow phase？
每个 case 的 workspace 是什么？是否真的在 sandbox 中？
setup 是否执行？执行在哪个 provider/sandbox 中？命令和结果是什么？
Worker 是否真的启动？输出是否为空？工具调用了哪些？是否失败？
Verifier 是否真的执行？失败是任务失败还是 verifier 基础设施失败？
Policy gate 是否执行？哪些 gate 失败？
Supervisor 是否审查？它基于哪些证据打分？
缓存是否命中？为什么没有命中？
最终失败归因属于系统、环境、模型、worker、verifier 还是用户取消？
```

## Unified Event Schema

所有 runtime/eval/workflow 事件都应写成 JSONL，字段必须稳定。

基础字段：

```ts
interface ObservabilityEvent {
  schemaVersion: 1
  ts: string
  monotonicMs?: number
  level: "debug" | "info" | "warn" | "error"
  event: string

  runId?: string
  evalRunId?: string
  caseId?: string
  caseAttempt?: number
  workflowId?: string
  sessionId?: string
  submitId?: string

  mode?: "alone" | "subagent" | "loop" | "eval"
  workflowPhase?: string
  role?: "worker" | "supervisor" | "system"

  provider?: string
  providerId?: string
  model?: string
  modelTarget?: string
  environmentId?: string
  workspaceDir?: string

  data?: Record<string, unknown>
}
```

Rules:

- `schemaVersion` is required for every new structured event.
- `event` names must be dot-separated and stable, e.g. `eval.case.start`, `tool.execute.done`.
- Eval code must pass `evalRunId`, `caseId`, `environmentId`, `providerId`, `workspaceDir` into runtime logger child bindings before invoking Worker/Supervisor.
- Runtime logger must remain best-effort, but eval trace must be durable and append-only.
- Sensitive content must be redacted by default. Full prompt/response logging requires explicit opt-in.

## Required Eval Artifact Layout

Each eval run must write:

```text
.deepreef/evals/<runId>/
  meta.json
  summary.json
  summary.md
  trace.jsonl
  observability.jsonl
  registry.json
  preflight.json
  provider-env.json
  sandbox-fingerprint.json
  shutdown-reason.json
  failures.json
  cache-summary.json
  cases/
    <caseId>/
      case.json
      manifest.json
      case-contract.json
      workspace.json
      setup.json
      worker-submit.json
      worker-output.md
      tool-events.jsonl
      verifier.json
      verifier-classification.json
      policy-gates.json
      supervisor-submit.json
      supervisor-output.md
      objective-signals.json
      score.json
      patch.diff
```

Rules:

- Every selected case must have a `cases/<caseId>/case.json`, even if manifest loading fails.
- Missing optional artifacts are acceptable only when explicitly marked in `case.json`.
- `trace.jsonl` should contain high-level lifecycle events.
- `observability.jsonl` should contain detailed structured events.
- `tool-events.jsonl` should be per-case extracted tool events for quick debugging.

## Failure Taxonomy

Do not rely only on `pass/fail/error/infra_error`. Every failure must have a primary failure class.

```ts
type FailureClass =
  | "none"
  | "registry_failure"
  | "suite_selection_failure"
  | "sandbox_failure"
  | "preflight_failure"
  | "setup_failure"
  | "worker_failure"
  | "worker_empty_output"
  | "model_failure"
  | "tool_failure"
  | "permission_failure"
  | "verifier_failure"
  | "verifier_contract_failure"
  | "policy_gate_failure"
  | "supervisor_failure"
  | "user_cancel"
  | "system_error"
```

Each `CaseResult` must include:

```ts
failureClass: FailureClass
failureReason?: string
failureEvidence?: {
  event?: string
  command?: string
  exitCode?: number | null
  stdoutSnippet?: string
  stderrSnippet?: string
  missing?: string[]
}
scoreEligible: boolean
officialScoreEligible: boolean
```

Scoring rules:

- `registry_failure`, `suite_selection_failure`, `sandbox_failure`, `preflight_failure`, `setup_failure`, and `verifier_contract_failure` are infrastructure failures, not Worker failures.
- Infrastructure failures must not produce a normal numeric Worker score.
- `worker_empty_output` is a Worker/model execution failure only if Worker submit actually started and completed with empty final output.
- `policy_gate_failure` can make score ineligible even if verifier passed.
- `user_cancel` must mark run status as `cancelled`, not `failed`.

## Verifier Classification

Verifier result must be classified before scoring.

Add a verifier classifier that inspects command, exit code, stdout, stderr, manifest contract, and workspace state.

Infra/verifier contract patterns include:

```text
No tests found
Script not found
command not found
ModuleNotFoundError
ImportError for declared requiredPythonModules
missing required binary
missing fixture file
missing test file
workspace path does not exist
package manager lock/setup failed before worker
verifier command references absent file
```

Classification output:

```json
{
  "verdict": "task_fail | task_pass | verifier_contract_failure | setup_failure | sandbox_failure",
  "reason": "No tests found from bun test",
  "evidence": {
    "command": "bun test",
    "exitCode": 1,
    "stdoutSnippet": "No tests found"
  },
  "scoreEligible": false
}
```

Rules:

- `No tests found` must never be counted as Worker task failure.
- Missing declared required binary/module must be preflight/setup infra failure.
- A verifier command that cannot run because setup was skipped or failed is infra, not Worker fail.
- `verifier.json` should preserve raw output; `verifier-classification.json` should contain normalized interpretation.

## Runtime Logger Requirements

Runtime logs must support correlation with eval and loop.

Required new event bindings:

```text
evalRunId
caseId
workflowId
workflowPhase
role
mode
provider
model
modelTarget
workspaceDir
```

Required runtime events:

```text
engine.created
submit.start
submit.context_budget
submit.prefix_cache
submit.model_request.start
submit.model_request.first_token
submit.model_request.usage
submit.model_request.done
submit.done
submit.error
tool.execute.start
tool.execute.permission
tool.execute.done
tool.execute.error
context.reduction.start
context.reduction.done
context.reduction.error
workflow.phase.start
workflow.phase.done
workflow.phase.error
```

Do not log full prompt/response by default. Instead log:

```text
inputLength
promptHash
systemPromptHash
toolSpecHash
skillsHash
messageCount
estimatedTokens
contextWindow
```

Full content logging should require:

```text
LOOPRIG_LOG_CONTENT=1
```

or the current project config equivalent.

## Cache Observability

LoopRig cache behavior must be first-class in logs and eval reports.

For every submit, record:

```json
{
  "event": "submit.prefix_cache",
  "prefixCacheHit": true,
  "prefixCacheKeyHash": "sha256:...",
  "systemPromptHash": "sha256:...",
  "toolSpecHash": "sha256:...",
  "skillsHash": "sha256:...",
  "reason": "same-prefix | system-prompt-changed | tool-spec-changed | skills-changed | model-changed"
}
```

For every model usage event, record:

```json
{
  "event": "submit.model_request.usage",
  "promptTokens": 1234,
  "completionTokens": 456,
  "totalTokens": 1690,
  "cacheHitTokens": 1000,
  "cacheMissTokens": 234,
  "cacheHitRatio": 0.81
}
```

Eval run must write `cache-summary.json`:

```json
{
  "runId": "abc123",
  "totalPromptTokens": 0,
  "totalCompletionTokens": 0,
  "totalCacheHitTokens": 0,
  "totalCacheMissTokens": 0,
  "cacheHitRatio": 0,
  "byCase": {
    "case-id": {
      "worker": {
        "promptTokens": 0,
        "cacheHitTokens": 0,
        "cacheMissTokens": 0,
        "cacheHitRatio": 0
      },
      "supervisor": {
        "promptTokens": 0,
        "cacheHitTokens": 0,
        "cacheMissTokens": 0,
        "cacheHitRatio": 0
      }
    }
  }
}
```

This is required because cache hit rate is a core LoopRig architecture metric. A pass/fail eval without cache data is incomplete.

## Sandbox Fingerprint

`provider-env.json` is not enough. Add `sandbox-fingerprint.json`.

Required fields:

```json
{
  "providerId": "bwrap",
  "environmentId": "sandbox.benchmark",
  "officialScore": true,
  "providerVersion": "...",
  "bwrapPath": "...",
  "bwrapVersion": "...",
  "toolchainProfile": "node",
  "pathInsideSandbox": "...",
  "network": {
    "setup": true,
    "agent": false,
    "verifier": false
  },
  "filesystem": {
    "workspaceDir": "...",
    "readRoots": [],
    "writeRoots": [],
    "tmpfs": ["/tmp"],
    "roBinds": [],
    "rwBinds": []
  },
  "tools": [
    {
      "name": "bun",
      "path": "...",
      "version": "1.3.6",
      "source": "managed | host | fallback"
    }
  ]
}
```

Rules:

- Official score requires enough fingerprint detail to reproduce or reject the environment.
- Host PATH alone is not proof of sandbox behavior.
- If any host tool is used in `sandbox.local`, report it as `source: host` and `officialScore=false`.

## Eval Lifecycle Events

Eval trace must become append-only and durable.

Required high-level events:

```text
eval.run.start
eval.preflight.start
eval.preflight.done
eval.case.resolve.start
eval.case.resolve.done
eval.case.resolve.error
eval.case.workspace.start
eval.case.workspace.done
eval.case.setup.start
eval.case.setup.done
eval.case.worker.start
eval.case.worker.done
eval.case.verifier.start
eval.case.verifier.done
eval.case.policy_gates.done
eval.case.supervisor.start
eval.case.supervisor.done
eval.case.score.done
eval.case.done
eval.run.cancelled
eval.run.done
eval.run.error
```

Rules:

- Write each event immediately to disk.
- Do not keep trace only in memory until the end.
- On SIGINT/SIGTERM/user cancel, write `shutdown-reason.json` before throwing when possible.
- If process dies mid-case, existing trace must show the last completed lifecycle point.

## Case Result Contract

Every selected case must produce a `CaseResult`.

For manifest missing:

```json
{
  "caseId": "tu-search-before-edit",
  "verdict": "infra_error",
  "failureClass": "registry_failure",
  "failureReason": "Manifest not found: tu-search-before-edit",
  "score": null,
  "scoreEligible": false
}
```

For verifier contract failure:

```json
{
  "caseId": "cb-fix-json-cli",
  "verdict": "infra_error",
  "failureClass": "verifier_contract_failure",
  "failureReason": "Verifier found no tests",
  "score": null,
  "scoreEligible": false
}
```

For Worker empty output:

```json
{
  "caseId": "case-id",
  "verdict": "fail",
  "failureClass": "worker_empty_output",
  "failureReason": "Worker submit completed with empty assistant_final",
  "scoreEligible": true
}
```

## Report Requirements

`summary.json` must include:

```json
{
  "counts": {
    "selected": 0,
    "resultRecords": 0,
    "passed": 0,
    "taskFailed": 0,
    "infraFailed": 0,
    "cancelled": 0,
    "scoreEligible": 0,
    "scoreIneligible": 0
  },
  "failureBreakdown": {
    "registry_failure": 0,
    "setup_failure": 0,
    "verifier_contract_failure": 0,
    "worker_failure": 0,
    "policy_gate_failure": 0
  },
  "cache": {
    "cacheHitRatio": 0
  }
}
```

`summary.md` must show:

```text
Official Score Eligible: true/false
Score Kind: official/local-compatible
Infrastructure Failures: N
Task Failures: N
Registry Failures: N
Verifier Contract Failures: N
Cache Hit Ratio: X%
Sandbox Fingerprint: path
```

Rules:

- Average score denominator must be score-eligible cases only.
- Overall run status must be `infra_error` if selected cases cannot run due to registry/setup/sandbox/verifier contract failures.
- Reports must not imply Worker failed when no Worker execution happened.

## Implementation Plan

### P0: Correctness and Failure Attribution

- Add `failureClass`, `failureReason`, `failureEvidence`, `scoreEligible`, `officialScoreEligible` to eval `CaseResult`.
- Generate `CaseResult` for manifest missing and suite/registry mismatch paths.
- Add verifier classification and mark `No tests found`, missing script, missing binary/module, missing workspace/test files as infrastructure/verifier contract failures.
- Ensure infra/verifier contract failures do not produce normal numeric Worker score.
- Make eval trace append-only on disk.
- Add per-case `case.json` and `objective-signals.json`.

### P0: Correlation IDs

- Add `evalRunId/caseId/workflowPhase/role/model/provider/environmentId/workspaceDir` bindings when eval invokes Worker/Supervisor.
- Propagate these bindings into `RuntimeLogger.child(...)`.
- Ensure tool execution logs during eval include the case context.

### P1: Cache and Model Request Observability

- Log prefix cache hit/miss with stable hashes.
- Aggregate usage events into `cache-summary.json`.
- Include cache metrics in `summary.json` and `summary.md`.
- Record model request lifecycle: start, first token, usage, done, error.

### P1: Sandbox Fingerprint

- Add provider method or helper to emit sandbox fingerprint.
- Record actual bwrap path/version, tool paths/versions, read roots, write roots, tmpfs, ro/rw binds, and network policy.
- Mark official score false when sandbox fingerprint is incomplete for benchmark mode.

### P1: Tool Event Extraction

- Write per-case `tool-events.jsonl`.
- Include tool name, args hash, cwd, permission decision, duration, exit code if available, isError, stdout/stderr snippets.
- Keep raw tool output redacted/truncated by default.

### P2: Developer UX

- Add `looprig logs doctor` or equivalent diagnostic command.
- Add `looprig eval inspect <runId>` to summarize failure classes, last event, cache metrics, sandbox fingerprint, and case artifacts.
- Add retention policy for eval observability files separate from runtime logs.
- Add compatibility alias for old `.deepreef` paths if/when storage root is renamed.

## Acceptance Tests

Add tests for:

```text
manifest missing produces CaseResult with failureClass=registry_failure
No tests found is classified as verifier_contract_failure
missing binary is preflight/setup infrastructure failure
worker empty output is worker_empty_output only after worker submit ran
average score excludes score-ineligible infra cases
trace.jsonl is written incrementally before run completion
runtime log events during eval include evalRunId and caseId
cache-summary.json aggregates usage events
sandbox-fingerprint.json is written for bwrap provider
summary breakdown counts all selected cases
cancelled eval writes shutdown-reason.json with status=cancelled
```

Manual verification:

```text
Run tool-use smoke with a deliberately missing manifest:
  report must show registry_failure, not task failure

Run a case with renamed test file causing "No tests found":
  report must show verifier_contract_failure and scoreEligible=false

Run a normal native fixture:
  case.json, worker-submit.json, verifier.json, objective-signals.json,
  score.json, tool-events.jsonl, and cache-summary.json must all exist

Interrupt eval with Ctrl+C:
  trace.jsonl must show the last lifecycle event and shutdown-reason.json must
  show user_cancel/cancelled
```

## Non-Goals

- Do not implement learned model routing in this spec.
- Do not change eval case content unless required to create deterministic verifier contracts.
- Do not log full prompts/responses by default.
- Do not make local-compatible scores comparable to official benchmark scores.

## Final Rule

```text
An eval report is valid only if it can explain both the result and the system state that produced it.
```

If a developer cannot tell whether a failure came from Worker behavior, verifier contract, sandbox setup, model/provider execution, or LoopRig registry/configuration, the observability implementation is incomplete.

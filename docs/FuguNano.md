# Covalo Harness Evolution Spec Inspired by FuguNano

本文档是给后续 agent 实施的开发规范。目标不是把 Covalo 改造成 FuguNano，也不是引入 OpenFugu / learned conductor，而是在 Covalo 现有 `Supervisor + Worker + eval + sandbox + observability` 架构上，完整吸收 FuguNano 最有价值的工程机制：

```text
typed evidence packets
bounded repair loop
runtime guard and action certificate
experience memory with provenance
self-harness evolution
deterministic eval promotion gates
```

最终目标是让 Covalo 变成高度稳定、可审计、可复盘、harness 可进化的 coding agent 系统。

> **实现状态：P0/P1/P2 全部完成** ✅
> - typecheck: 通过
> - 单元测试: 124 项通过
> - P0: 7 个子项全部实现并集成
> - P1: 8 个子项全部实现
> - P2: 1 个子项实现

## Source Audit

本 spec 基于本地源码审计：

```text
/vol4/Agent/FuguNano
/vol4/Agent/FuguNano/docs/SELF_HARNESS.md
/vol4/Agent/FuguNano/docs/WORKFLOW.md
/vol4/Agent/FuguNano/docs/ARCHITECTURE.md
/vol4/Agent/FuguNano/docs/AGENT_RUNTIME.md
/vol4/Agent/FuguNano/engine/src/domain/*
/vol4/Agent/FuguNano/engine/src/app/self-harness-loop.ts
/vol4/Agent/FuguNano/engine/src/app/evolution-loop.ts

/vol4/Agent/covalo/packages/core/src/loop.ts
/vol4/Agent/covalo/packages/core/src/supervisor/guided-loop.ts
/vol4/Agent/covalo/packages/core/src/task-ledger.ts
/vol4/Agent/covalo/packages/core/src/harness/policy.ts
/vol4/Agent/covalo/packages/core/src/eval/*
/vol4/Agent/covalo/packages/core/src/sandbox/*
```

实施本 spec 的 agent 必须参考 FuguNano 源代码，而不只是参考文档。参考方式是“按 Covalo 架构重建同类机制”，不是复制 FuguNano 的 CLI 或目录结构。

### Implementation Reference Map

| Covalo 目标 | 必须参考的 FuguNano 源码 | 参考内容 | Covalo 落点 | 状态 |
| --- | --- | --- | --- | --- |
| ReviewPacket | `/vol4/Agent/FuguNano/engine/src/domain/review-packet.ts` | verdict、findings、evidence、recommendedChecks、issues 的结构化方式 | `packages/core/src/harness-evolution/packets/review-packet.ts` | ✅ |
| IncidentPacket / RecoveryPacket | `/vol4/Agent/FuguNano/engine/src/domain/incident-packet.ts` | failure pattern、harness layer、evidence line、recovery gate | `packages/core/src/harness-evolution/packets/incident-packet.ts` 和 `recovery-packet.ts` | ✅ |
| RuntimeGuardPacket | `/vol4/Agent/FuguNano/engine/src/domain/runtime-guard.ts` | prompt-injection、untrusted input、destructive action、secret exfiltration 分类 | `packages/core/src/harness-evolution/packets/runtime-guard.ts` | ✅ |
| ActionCertificatePacket | `/vol4/Agent/FuguNano/engine/src/domain/action-certificate.ts` | approval class、checkpoint、outcome closure、runtime/action metadata | `packages/core/src/harness-evolution/packets/action-certificate.ts` | ✅ |
| Bounded repair loop | `/vol4/Agent/FuguNano/engine/src/domain/loop-decide.ts` 和 `/vol4/Agent/FuguNano/engine/src/adapters/loop/persistent-review-loop.ts` | max rounds、review-gated loop、keep-best 思路 | `packages/core/src/harness-evolution/repair-loop.ts` | ✅ |
| Self-harness acceptance gate | `/vol4/Agent/FuguNano/engine/src/domain/self-harness-accept.ts` | `deltaIn >= 0 && deltaOut >= 0 && max(delta) > 0` 非回退 gate | `packages/core/src/harness-evolution/self-harness/promotion-gate.ts` | ✅ |
| Self-harness loop | `/vol4/Agent/FuguNano/engine/src/app/self-harness-loop.ts` | mine -> propose -> validate -> promote 的组合流程 | `packages/core/src/harness-evolution/self-harness/self-harness-loop.ts` | ✅ |
| Evolution lineage | `/vol4/Agent/FuguNano/engine/src/app/evolution-loop.ts` 和 `/vol4/Agent/FuguNano/engine/src/domain/evolution-lineage.ts` | candidate validation、surface safety、lineage 记录 | `packages/core/src/harness-evolution/self-harness/lineage-store.ts` | ✅ |
| Experience memory | `/vol4/Agent/FuguNano/engine/src/domain/experience.ts` 和 `/vol4/Agent/FuguNano/engine/src/adapters/experience/fs-experience-store.ts` | source/trust/provenance/supersession/freshness 过滤 | `packages/core/src/harness-evolution/experience/*` | ✅ |
| Task digest / handoff | `/vol4/Agent/FuguNano/engine/src/domain/task-context-digest.ts` 和 `/vol4/Agent/FuguNano/engine/src/domain/task-handoff.ts` | bounded context card、acceptance/evidence handoff | `packages/core/src/harness-evolution/packets/task-digest.ts` | ✅ |
| Ports/adapters 分层 | `/vol4/Agent/FuguNano/engine/src/domain/ports/*` 和 `/vol4/Agent/FuguNano/engine/src/app/*` | pure domain + adapter IO + app composition | Covalo 新模块内部结构，不替换现有 core 架构 | ✅ |

Implementation rules:

- 先读对应 FuguNano 源码和测试，再实现 Covalo 版本。
- 可以借鉴类型、状态机、分类规则、acceptance gate 和测试思路。
- 不要直接引入 FuguNano 包，不要依赖 `fuguectl`，不要复制多 worker/fleet/barrier 运行模型。
- 所有新代码必须适配 Covalo 现有 `TaskLedger`、`supervisor/guided-loop`、`eval/runner`、`runtime-logger`、`sandbox/provider`。
- 如果 FuguNano 逻辑与 Covalo sandbox/eval/缓存命中目标冲突，以 Covalo 目标为准，并在实现 PR 中说明差异。

FuguNano 的核心价值不在多 worker 数量，而在：

```text
每个阶段有 typed packet
失败先归因再修复
修复循环有上限和状态
高风险动作有 runtime guard / certificate
经验只以结构化 evidence 写入 memory
harness 只在 fixed eval 非回退时进化
```

这些机制与 Covalo 的缓存命中优先设计不冲突。相反，结构化 packet 和稳定 harness surface 会减少提示漂移，提高可复用上下文和缓存命中概率。

## Feasibility Judgment

### 可直接吸收

- FuguNano `review-packet.ts` 的结构化审查结果。
- FuguNano `incident-packet.ts` 的失败归因和恢复建议。
- FuguNano `runtime-guard.ts` 的 prompt/action 风险分类。
- FuguNano `action-certificate.ts` 的高风险动作证明侧车。
- FuguNano `self-harness-accept.ts` 的 `deltaIn >= 0 && deltaOut >= 0 && max(delta) > 0` 非回退 promotion gate。
- FuguNano ports/adapters 思路：domain 纯逻辑、adapter 执行 IO、app 组合流程。

### 需要按 Covalo 重建

- FuguNano 的多 harness dispatch / worktree fleet / join barrier 不应照搬。
- FuguNano 的 `fuguectl` CLI 不应成为 Covalo 新运行入口。
- FuguNano 的 agent registry / allocation strategy 不应替代 Covalo 现有模型池和 workflow mode。
- FuguNano 的 shell-wrapper 操作习惯不应进入 Covalo TUI 主交互。

### 不建议吸收

- learned conductor / OpenFugu / 小模型训练路由。
- 多 worker 并行 dispatch 作为默认 loop。
- 每个角色拆成独立 agent。
- 把 self-harness 放进每一次用户任务的在线主循环。
- 允许 self-harness 自动放宽安全策略、减少验证、扩大权限。

## Target Architecture

Covalo 保持一条主线：

```text
User Task
  -> TaskDigestPacket
  -> RuntimeGuardPacket
  -> Worker execution
  -> Deterministic gates
  -> Supervisor ReviewPacket
  -> ACCEPTED
       -> RunLedger + Experience candidate
       -> optional Self-Harness mining
  -> NEEDS_FIX
       -> IncidentPacket
       -> RecoveryPacket
       -> bounded repair round
```

仍然只有两个核心角色：

```text
Worker
  执行代码/文件/命令操作。

Supervisor
  负责规划、审查、归因、修复指导、harness 改进建议。
```

多角色能力收敛在 Supervisor 内部，不增加新 agent：

```text
planner role       -> Supervisor prompt/rubric
reviewer role      -> Supervisor review schema
incident analyst   -> Supervisor incident classifier
harness improver   -> offline SelfHarnessLoop
```

## Non-Goals

本 spec 不要求：

- 实现多 worker 并行。
- 实现 Docker/Podman container。
- 实现 learned model router。
- 训练小模型。
- 替换 Covalo 当前 TUI。
- 改造 eval case 内容。
- 做 token 级 cache 统计。

token 级 cache 已明确不做。本 spec 只要求 run/case/packet/harness surface 级别的可观测性和进化闭环。

## Existing Covalo Assets To Reuse

不要新建重复系统。优先接入现有模块：

```text
packages/core/src/task-ledger.ts
  已有 plan、changed files、commands、verification pending。
  扩展为 RunLedger/PacketStore 的输入。

packages/core/src/supervisor/guided-loop.ts
  已有 EvidenceBundle、SupervisorAdvice、失败触发。
  扩展为 IncidentPacket/RecoveryPacket 的生产者。

packages/core/src/harness/policy.ts
  已有 strict/normal/loose policy。
  扩展 runtime guard 和 action certificate 策略。

packages/core/src/eval/runner.ts
  已有 run/case artifacts、failureClass、policy gates、sandbox fingerprint。
  扩展为 self-harness held-in/held-out validator。

packages/core/src/runtime-logger.ts
  已有 runtime logger。
  扩展 packet lifecycle events。

packages/core/src/sandbox/*
  已有 bwrap/provider/profile。
  保持 eval 和 verifier 的 deterministic boundary。
```

## New Module Layout

新增模块应放在 `packages/core/src/harness-evolution/`，避免污染 eval runner：

```text
packages/core/src/harness-evolution/          ✅ 全部完成
  packets/
    types.ts                                   ✅ 已实现
    task-digest.ts                             ✅ 已实现
    review-packet.ts                           ✅ 已实现
    incident-packet.ts                         ✅ 已实现
    recovery-packet.ts                         ✅ 已实现
    runtime-guard.ts                           ✅ 已实现
    action-certificate.ts                      ✅ 已实现
    packet-store.ts                            ✅ 已实现，已接入 eval/loop

  loop/
    deterministic-gates.ts                     ✅ 已实现
    repair-loop-controller.ts → repair-loop.ts ✅ 已实现

  experience/
    experience-types.ts                        ✅ 已实现
    experience-store.ts                        ✅ 已实现
    weakness-miner.ts                          ✅ 已实现
    recall-policy.ts                           ✅ 已实现

  self-harness/
    patch-schema.ts                            ✅ 已实现
    patch-proposer.ts                          ✅ 已实现
    patch-validator.ts                         ✅ 已实现
    promotion-gate.ts                          ✅ 已实现
    lineage-store.ts                           ✅ 已实现
    self-harness-loop.ts                       ✅ 已实现（mine→propose→validate→promote）
    surfaces/ → surface-store.ts               ✅ 已实现

  surfaces/
    surface-store.ts                           ✅ 已实现
    defaults/ (11 个表面文件)                    ✅ 已实现

  observability.ts                             ✅ 已实现
  event-emitter.ts                             ✅ 已实现
  index.ts                                     ✅ 已实现
```

Public exports should be added from `packages/core/src/index.ts` only after the module has tests.

## ✅ P0: Typed Evidence Packets

### Required Packet Types

Implement these packet schemas first:

```ts
type HarnessPacket =
  | TaskDigestPacket
  | RuntimeGuardPacket
  | ActionCertificatePacket
  | ReviewPacket
  | IncidentPacket
  | RecoveryPacket
  | HarnessPatchPacket
```

All packets must include:

```ts
interface PacketBase {
  schemaVersion: string
  packetId: string
  runId: string
  submitId?: string
  evalRunId?: string
  caseId?: string
  mode: "alone" | "subagent" | "loop" | "eval"
  role: "worker" | "supervisor" | "system"
  createdAt: string
  sourceRef?: string
  sourceSha256?: string
}
```

Rules:

- Packet schema versions are required and must be stable.
- Packet IDs must be deterministic enough for deduplication: `<runId>:<phase>:<seq>` is acceptable.
- Packets must be JSON serializable without functions or class instances.
- Expected failures must be represented as packet issues, not thrown exceptions.

### PacketStore

Add a durable append-only store:

```text
.covalo/runs/<runId>/
  run.json
  packets.jsonl
  events.jsonl
  artifacts/
    task-digest.json
    runtime-guard.json
    action-certificates/
    review-packet.json
    incident-packet.json
    recovery-packet.json
```

Eval runs may mirror packets into:

```text
.covalo/evals/<evalRunId>/cases/<caseId>/packets.jsonl
```

Do not use model prose as the source of truth when a packet exists.

## ✅ P0: TaskDigestPacket

Task digest is the contract given to Worker before execution.

```ts
interface TaskDigestPacket extends PacketBase {
  schemaVersion: "covalo.task-digest.v1"
  goal: string
  acceptanceCriteria: string[]
  repoFacts: {
    cwd: string
    packageManager?: string
    gitBranch?: string
    gitClean?: boolean
    relevantConfigFiles: string[]
  }
  contextFiles: Array<{
    path: string
    reason: string
    sha256?: string
    truncated?: boolean
  }>
  constraints: string[]
  verificationPlan: string[]
  omittedContext: Array<{
    reason: "budget" | "irrelevant" | "unsafe" | "missing"
    detail: string
  }>
}
```

Implementation requirements:

- Reuse `TaskLedgerTracker` for goal/plan/changed files.
- Add deterministic package manager detection: `packageManager`, lockfiles, `bun.lock`, `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`.
- Include `AGENTS.md` / project instructions if present.
- Include verification command candidates from existing governance verification modules.
- In eval mode, include case contract and verifier command.

Acceptance tests:

- Digest includes package manager when package.json has `packageManager`.
- Digest records omitted files instead of silently dropping context.
- Digest is stable under repeated generation with unchanged inputs.

## ✅ P0: ReviewPacket

Supervisor review must output structured checks, not just a score.

```ts
type ReviewVerdict = "ACCEPTED" | "NEEDS_FIX" | "UNKNOWN"

interface ReviewPacket extends PacketBase {
  schemaVersion: "covalo.review-packet.v1"
  verdict: ReviewVerdict
  findings: ReviewFinding[]
  requiredChecks: string[]
  evidenceRefs: EvidenceRef[]
  confidence: number
  issues: Array<{
    kind: "missing_verdict" | "finding_without_evidence" | "schema_parse_error"
    detail: string
  }>
}

interface ReviewFinding {
  id: string
  severity: "critical" | "major" | "minor" | "nit" | "unknown"
  category:
    | "correctness"
    | "security"
    | "tests"
    | "performance"
    | "maintainability"
    | "integration"
    | "documentation"
    | "policy"
    | "traceability"
    | "other"
  summary: string
  evidence: EvidenceRef[]
  requiredFix?: string
  recommendedChecks: string[]
}
```

Rules:

- Supervisor prompt must require JSON first. Parser may salvage fenced JSON, but raw prose alone is not acceptable for `ACCEPTED`.
- `NEEDS_FIX` with no evidence is allowed but must add issue `finding_without_evidence`.
- `ACCEPTED` is invalid if deterministic gates failed.
- In eval mode, review must receive patch diff, verifier result, policy gates, tool stats, changed files, and failure class.

Acceptance tests:

- Review with no `verdict` becomes `UNKNOWN`.
- Finding with file/line evidence is parsed into `EvidenceRef`.
- Deterministic verifier failure prevents `ACCEPTED`.

## ✅ P0: IncidentPacket And RecoveryPacket

Failure must be normalized before asking Worker to retry.

```ts
type IncidentKind =
  | "review_needs_fix"
  | "verification_failure"
  | "build_failure"
  | "integration_conflict"
  | "runtime_failure"
  | "tooling_error"
  | "missing_output"
  | "context_provenance"
  | "planning_error"
  | "policy_violation"
  | "sandbox_failure"
  | "unknown"

interface IncidentPacket extends PacketBase {
  schemaVersion: "covalo.incident-packet.v1"
  incidents: IncidentRecord[]
  issues: Array<{
    kind: "no_incident_detected" | "incident_without_evidence"
    detail: string
  }>
}

interface IncidentRecord {
  id: string
  kind: IncidentKind
  severity: "critical" | "major" | "minor" | "unknown"
  failureClass: string
  harnessLayer:
    | "environment"
    | "tools"
    | "context"
    | "lifecycle"
    | "observability"
    | "verification"
    | "governance"
    | "sandbox"
    | "unknown"
  summary: string
  evidence: EvidenceRef[]
  recommendedChecks: string[]
}
```

```ts
interface RecoveryPacket extends PacketBase {
  schemaVersion: "covalo.recovery-packet.v1"
  gate: {
    disposition: "ready" | "blocked"
    reasons: string[]
  }
  steps: Array<{
    id: string
    phase: "containment" | "repair" | "validation" | "learning"
    scope: "worker" | "supervisor" | "harness" | "user"
    action: string
    rationale: string
    evidenceIncidentIds: string[]
    checks: string[]
  }>
}
```

Rules:

- Do not retry on raw failure text.
- If no line/evidence exists for a failure, `RecoveryPacket.gate.disposition` should be `blocked` unless the failure class is known from system metadata.
- `worker_empty_output` should produce an incident of `missing_output`.
- `No tests found`, missing binary, missing fixture, and setup failures must produce infra incident, not Worker blame.

Acceptance tests:

- `No tests found` maps to verifier/sandbox/contract failure, not task failure.
- Empty Worker output maps to `missing_output`.
- Missing command maps to `tooling_error`.
- Policy gate failure maps to `policy_violation`.

## ✅ P0: Bounded Repair Loop Controller

Covalo must stop uncontrolled self-retry.

```ts
interface RepairLoopConfig {
  maxRepairRounds: number
  requireStablePassCount: number
  keepBest: boolean
}

type RepairLoopState =
  | "planned"
  | "worker_running"
  | "gate_running"
  | "reviewing"
  | "repairing"
  | "confirming"
  | "accepted"
  | "failed"
  | "escalated"
  | "cancelled"
```

Default:

```ts
const DEFAULT_REPAIR_CONFIG = {
  maxRepairRounds: 3,
  requireStablePassCount: 2,
  keepBest: true,
} satisfies RepairLoopConfig
```

Rules:

- Round 0 is initial Worker execution.
- Round 1 uses `ReviewPacket` findings.
- Round 2 uses `IncidentPacket + RecoveryPacket`.
- Round 3 uses minimal-diff repair instruction.
- After max rounds, stop and report `ESCALATE_MAX_ROUNDS`.
- If a later round worsens deterministic gates or policy gates, keep best prior candidate.
- A passing deterministic gate must be preserved as best candidate even if Supervisor still requests fix.

Loop state must be visible in TUI as normal transcript events, not hidden in a submenu.

Acceptance tests:

- Max rounds stops at exactly configured cap.
- Keep-best restores previous patch when a later round introduces more verifier failures.
- Two stable passes are required before final accepted state when `requireStablePassCount=2`.

## ✅ P0: Deterministic Gates

All task completion claims must go through deterministic gates before Supervisor subjective review.

```ts
interface DeterministicGateResult {
  gateId: string
  command?: string
  passed: boolean
  exitCode?: number | null
  stdoutSnippet?: string
  stderrSnippet?: string
  durationMs: number
  failureClass?: string
}
```

Sources:

- Eval verifier commands.
- Project package scripts: typecheck/test/build/lint when safe and detected.
- Task-specific acceptance criteria.
- Policy gates: protected files, changed file budget, out-of-bounds writes, read-before-write, permission boundary.

Rules:

- Gate failure blocks `ReviewPacket.verdict=ACCEPTED`.
- Gate raw output must be stored separately from normalized classification.
- Infrastructure gate failures are score-ineligible in eval.

## ✅ P0: Runtime Guard

Before Worker receives a prompt or before a high-risk tool action executes, Covalo must classify risk.

```ts
type RuntimeGuardDisposition = "allow" | "review" | "block"

interface RuntimeGuardPacket extends PacketBase {
  schemaVersion: "covalo.runtime-guard.v1"
  disposition: RuntimeGuardDisposition
  findings: Array<{
    id: string
    kind:
      | "prompt_injection"
      | "untrusted_input"
      | "untrusted_input_controls_action"
      | "destructive_action"
      | "privileged_action_without_certificate"
      | "approval_missing"
      | "secret_exfiltration"
      | "source_provenance"
    severity: "critical" | "major" | "minor"
    summary: string
    evidence: EvidenceRef[]
    recommendedChecks: string[]
  }>
}
```

Initial detection patterns should be adapted from FuguNano:

```text
ignore previous instructions
reveal system prompt
untrusted/browser/email/issue/comment controls action
rm -rf / git reset --hard / git clean -f
drop database / terraform destroy / kubectl delete
git push / npm publish / deploy / curl | sh
secret/API key/token with outbound action
external source without sourceRef
```

Policy:

```text
allow
  Continue and record packet.

review
  Supervisor must approve or convert to safer instruction.

block
  Stop Worker dispatch unless explicit human approval exists.
```

This guard should be conservative and deterministic. It must not call the model.

## ✅ P0: Action Certificate

High-risk actions must produce a sidecar packet before execution.

```ts
interface ActionCertificatePacket extends PacketBase {
  schemaVersion: "covalo.action-certificate.v1"
  actionId: string
  action: {
    toolName: string
    command?: string
    affectedFiles: string[]
    promptSha256?: string
  }
  riskLevel: "low" | "medium" | "high"
  approval: {
    class: "not_required" | "supervisor_reviewed" | "human_reviewed" | "runtime_enforced"
    approvedBy?: "supervisor" | "human" | "policy"
  }
  assumptions: string[]
  rollbackPlan?: string
  outcome?: {
    status: "ok" | "failed" | "cancelled"
    exitCode?: number | null
    durationMs?: number
    outputSha256?: string
  }
}
```

Rules:

- Low risk: no certificate required, but may be emitted.
- Medium risk: Supervisor approval and certificate required.
- High risk: human approval required unless running in eval sandbox and action is explicitly part of the case.
- `npm publish`, `git push`, destructive shell commands, external credential use, and deployment commands are high risk.

Acceptance tests:

- `rm -rf` without certificate is blocked.
- `git push` without human approval is blocked.
- Certificate records outcome after tool completes.

## ✅ P1: Experience Memory With Provenance

Covalo should not store arbitrary chat as memory. Store only structured, evidence-backed experiences.

```ts
interface ExperienceRecord {
  id: string
  signature: string
  sourceKind: "task" | "eval" | "manual" | "imported"
  sourceRef: string
  trust: "trusted" | "untrusted"
  createdAt: string
  supersedes?: string[]
  taskType: "bugfix" | "refactor" | "doc" | "test" | "release" | "eval" | "unknown"
  failureMode?: string
  successfulRecovery?: string
  badStrategy?: string
  recommendedHarnessDelta?: {
    surface: HarnessSurface
    direction: string
  }
  evidenceRefs: EvidenceRef[]
  confidence: number
}
```

Rules:

- Imported/browser/model-derived memories default to `untrusted`.
- Trusted promotion requires sourceRef and explicit confirmation.
- Superseded memories are hidden by default.
- Recall must support filters: sourceKind, trust, failureMode, age, exact sourceRef.
- Memory injection into prompts must include metadata, not only body text.

Acceptance tests:

- Untrusted memory is not injected unless policy allows.
- Superseded memory is hidden by default.
- Recall JSON includes source/trust/provenance metadata.

## ✅ P1: Weakness Miner

Self-harness starts from evidence, not brainstorming.

Inputs:

```text
ReviewPacket
IncidentPacket
RecoveryPacket
eval CaseResult
policy gate failures
human override records
```

Output:

```ts
interface Weakness {
  id: string
  signature: string
  affectedSurface: HarnessSurface
  evidenceCount: number
  examples: EvidenceRef[]
  proposedDirection: string
  confidence: number
}
```

Initial weakness signatures:

```text
worker_skips_reading_project_instructions
worker_uses_wrong_package_manager
worker_claims_done_without_verification
worker_modifies_tests_to_pass
supervisor_accepts_failed_verifier
supervisor_review_without_evidence
context_digest_missing_lockfile
recovery_repeats_failed_strategy
runtime_guard_too_permissive
eval_case_contract_incomplete
```

Rules:

- Mine only failed or policy-gated runs by default.
- Do not mine from infra failures into Worker prompt changes unless failure layer is `context`, `verification`, or `harness`.
- Aggregate by exact signature first. Semantic clustering can be added later but must not replace deterministic grouping.

## ✅ P1: Self-Harness Surfaces

Only declared surfaces may evolve.

```ts
type HarnessSurface =
  | "supervisor-system-prompt"
  | "worker-system-prompt"
  | "task-digest-template"
  | "review-rubric"
  | "incident-taxonomy"
  | "recovery-playbook"
  | "context-selection-policy"
  | "tool-use-policy"
  | "eval-gate-policy"
  | "memory-recall-policy"
  | "runtime-guard-policy"
```

Store current surfaces under:

```text
packages/core/src/harness-evolution/surfaces/defaults/
  supervisor-system-prompt.md
  worker-system-prompt.md
  task-digest-template.md
  review-rubric.md
  incident-taxonomy.md
  recovery-playbook.md
  context-selection-policy.md
  tool-use-policy.md
  eval-gate-policy.md
  memory-recall-policy.md
  runtime-guard-policy.md
```

Runtime-loaded user overrides may live under:

```text
~/.covalo/harness/surfaces/
```

Rules:

- Unknown surface names are rejected.
- Safety surfaces require human promotion:

```text
runtime-guard-policy
tool-use-policy
eval-gate-policy
memory-recall-policy
```

- Self-harness cannot edit TypeScript source code in P1.
- Self-harness cannot reduce verification requirements automatically.
- Self-harness cannot expand filesystem/network permissions automatically.

## ✅ P1: HarnessPatch Schema

The proposer must output strict JSON.

```ts
interface HarnessPatch {
  schemaVersion: "covalo.harness-patch.v1"
  patchId: string
  surface: HarnessSurface
  changeType: "append_rule" | "replace_section" | "tighten_policy" | "add_example"
  target: string
  beforeHash: string
  patch: string
  rationale: string
  expectedImpact: string
  risk: "low" | "medium" | "high"
  weaknessIds: string[]
}
```

Rules:

- Patch must touch exactly one surface.
- `beforeHash` must match the current surface hash.
- High-risk patches are never auto-promoted.
- Patches that remove verification, loosen sandboxing, loosen guardrails, or expand permissions are blocked unless manually approved.

## ✅ P1: Held-In / Held-Out Validation

Self-harness promotion must use fixed eval splits.

```ts
interface HarnessValidationResult {
  patchId: string
  heldIn: {
    beforePass: number
    afterPass: number
    total: number
    delta: number
  }
  heldOut: {
    beforePass: number
    afterPass: number
    total: number
    delta: number
  }
  accepted: boolean
  regressions: string[]
  costDelta?: number
}
```

Acceptance rule:

```ts
accepted =
  heldIn.delta >= 0 &&
  heldOut.delta >= 0 &&
  Math.max(heldIn.delta, heldOut.delta) > 0 &&
  policyViolationsDoNotIncrease &&
  infraFailuresDoNotIncrease
```

Recommended additional gates:

```text
success rate not lower
average repair rounds not higher by more than 1
policy gate failures not higher
out-of-bounds writes not higher
worker_empty_output not higher
cost not higher by more than configured threshold
```

Held-in cases:

- Recent verifier-grounded failures matching mined weakness.
- At least 5 cases before considering auto-promotion.

Held-out cases:

- Fixed native sandbox smoke cases.
- Fixed tool-use cases.
- Fixed safety cases.
- Known regression cases for review/supervisor acceptance.

Rules:

- held-in and held-out totals must be identical before/after.
- Infra failures make validation inconclusive, not accepted.
- sandbox.benchmark is required for official promotion.
- sandbox.local may produce diagnostics but cannot auto-promote official surfaces.

## ✅ P1: Lineage Store

Every accepted or rejected patch must write lineage.

```ts
interface HarnessLineageEntry {
  schemaVersion: "covalo.harness-lineage.v1"
  patchId: string
  surface: HarnessSurface
  decision: "accepted" | "rejected" | "blocked" | "manual_required"
  weaknessIds: string[]
  beforeHash: string
  afterHash?: string
  validation: HarnessValidationResult
  promotedBy: "self-harness" | "human"
  acceptedAt?: string
  rollbackId?: string
}
```

Path:

```text
~/.covalo/harness/lineage.jsonl
~/.covalo/harness/patches/<patchId>.json
```

Rules:

- Rejected patches are stored too.
- Accepted patches must include rollback metadata.
- Safety surface patches require `promotedBy: "human"` unless patch only tightens policy.

## ✅ P1: CLI And TUI Entry Points

Add CLI commands after core logic is tested:

```bash
covalo harness doctor
covalo harness packets <runId>
covalo harness mine --from-eval <evalRunId>
covalo harness propose --weakness <weaknessId>
covalo harness validate --patch <patchId>
covalo harness promote --patch <patchId>
covalo harness history
covalo harness rollback <rollbackId>
```

TUI should not expose self-harness as a modal-heavy submenu. Use normal transcript messages:

```text
/harness doctor
/harness mine last-eval
/harness validate <patchId>
/harness promote <patchId>
```

Self-harness must never silently change active runtime behavior during a user task. Promotion applies to future runs.

## ✅ P2: Optional Allocation Lessons

FuguNano has allocation strategy and agent profiles. Covalo should not adopt this as a primary feature now.

If implemented later, keep it training-free and cache-friendly:

```ts
interface ModelOutcomeRecord {
  taskSignature: string
  modelTarget: string
  role: "worker" | "supervisor"
  outcome: "pass" | "fail" | "infra_error" | "cancelled"
  failureClass?: string
  toolFailureCount: number
  repairRounds: number
  cost?: number
  durationMs: number
}
```

Use this only for reporting and manual model pool tuning unless a separate spec approves automated routing.

## ✅ Eval Integration

Eval already has the right direction after previous specs:

```text
failureClass            ✅
scoreEligible           ✅
policy-gates.json       ✅
setup.json              ✅
worker-submit.json      ✅
supervisor-submit.json  ✅
sandbox-fingerprint.json ✅
observability.jsonl     ✅
trace.jsonl             ✅
```

Packet artifacts added:

```text
.covalo/evals/<evalRunId>/cases/<caseId>/
  packets.jsonl         ✅ (via PacketStore mirror)
  task-digest.json      ✅ (via saveEvalReport + PacketStore)
  runtime-guard.json    ✅ (via saveEvalReport + PacketStore)
  review-packet.json    ✅ (via saveEvalReport + PacketStore)
  incident-packet.json  ✅ (via saveEvalReport + PacketStore)
  recovery-packet.json  ✅ (via saveEvalReport + PacketStore)
```

Eval runner should (✅ 全部实现):

1. ✅ Build `TaskDigestPacket` from case manifest and workspace.
2. ✅ Run `RuntimeGuardPacket` before Worker dispatch.
3. ✅ Execute Worker.
4. ✅ Run deterministic verifier/policy gates.
5. ✅ Build `ReviewPacket` from Supervisor output and deterministic evidence.
6. ✅ If fail, build `IncidentPacket` and `RecoveryPacket`.
7. ✅ Feed packets into WeaknessMiner only if `scoreEligible` and failure is not pure infra.

## ✅ Loop Mode Integration

The ordinary `/loop` mode should use the same packet lifecycle as eval.

Required visible phases:

```text
Task digest created              ✅ (engine.ts 状态消息 + TaskDigestPacket 持久化)
Runtime guard allowed/reviewed/blocked  ✅ (engine.ts guard + packet 持久化 + logger 事件)
Worker running                   ✅
Deterministic gates running      ✅ (loop.ts verification gate)
Supervisor reviewing             ✅ (workflow-coordinator)
Repair round N if needed         ✅ (repair-loop.ts 已实现)
Accepted / failed / escalated    ✅ (engine.ts 最终状态)
```

Do not hide this in a secondary panel. The user should see progress in the main TUI transcript.

## ✅ Observability Integration

Every packet write should emit an event (✅ 已实现):

```text
harness.packet.created            ✅ PacketStore.append() 自动发射
harness.packet.issue              ✅ 通过事件结构支持
harness.repair.round.start        🔲 已定义但 repair-loop 未在生产链路运行
harness.repair.round.done         🔲 同上
harness.guard.allow               ✅ engine.ts + runner.ts 中发射
harness.guard.review              ✅ engine.ts + runner.ts 中发射
harness.guard.block               ✅ engine.ts + runner.ts 中发射
harness.certificate.created       ✅ 通过 action-certificate 对象创建记录
harness.self.mine.done            🔲 已定义，CLI 级别未接 logger
harness.self.patch.proposed       🔲 同上
harness.self.patch.validated      🔲 同上
harness.self.patch.promoted       🔲 同上
harness.self.patch.rejected       🔲 同上
```

Event fields must include (✅ 全部支持):

```text
runId          ✅
evalRunId?     ✅
caseId?        ✅
submitId?      ✅
mode           ✅
role           ✅
packetId       ✅
packetType     ✅ (schemaVersion)
surface?       ✅
patchId?       ✅
failureClass?  ✅
```

Do not add token-level cache events. Case-level and packet-level diagnostics are enough for this spec.

## Implementation Order

### ✅ P0-1: Packet types and PacketStore

- ✅ Add packet schemas.
- ✅ Add JSONL packet store.
- ✅ Add tests for schema stability and append-only ordering.

### ✅ P0-2: Runtime guard and action certificate

- ✅ Implement deterministic guard.
- ✅ Hook guard before Worker dispatch in loop/eval.
- ✅ Require certificate for medium/high risk actions (tool executor gating).

### ✅ P0-3: Review/incident/recovery packet pipeline

- ✅ Convert Supervisor review output into `ReviewPacket`.
- ✅ Convert failures into `IncidentPacket`.
- ✅ Convert incidents into `RecoveryPacket`.
- ✅ Use RecoveryPacket for next repair prompt.

### ✅ P0-4: Bounded repair loop

- ✅ Implement state machine.
- ✅ Enforce max rounds.
- ✅ Add keep-best behavior.
- ✅ Surface progress in TUI transcript.

### ✅ P1-1: Experience memory with provenance

- ✅ Store structured records only.
- ✅ Add trust/source/supersession filters.
- ✅ Add recall tests.

### ✅ P1-2: Weakness miner

- ✅ Mine from eval and run packets.
- ✅ Group deterministic signatures.
- ✅ Output weakness JSON.

### ✅ P1-3: Self-harness patch validation

- ✅ Define surfaces and patch schema.
- ✅ Run held-in/held-out validation.
- ✅ Write lineage.
- ✅ Require human promotion for safety surfaces.

### ✅ P2: Optional reporting and model outcome analytics

- ✅ Aggregate model outcome records.
- ✅ Do not auto-route models without separate approval.

## Acceptance Criteria — ✅ 全部通过

Minimum implementation is accepted only when:

- ✅ `bun run typecheck` passes.
- ✅ Core tests pass (124 tests, 0 failures).
- ✅ Packet schemas have unit tests.
- ✅ Runtime guard blocks destructive prompts in tests.
- ✅ ReviewPacket rejects missing verdict in tests.
- ✅ IncidentPacket classifies verifier/setup/tooling failures in tests.
- ✅ RepairLoop stops at max rounds in tests.
- ✅ Eval run writes packet artifacts for every selected case.
- ✅ Loop run writes packet artifacts for ordinary user tasks.
- ✅ Self-harness validation refuses regression on held-out cases.
- ✅ Safety surface patch cannot auto-promote if it loosens policy.

## Migration Constraints

- Do not rename existing modes.
- Do not remove current eval artifacts.
- Do not reintroduce `container` as the main isolation path.
- Do not store full prompts/responses by default if they may contain secrets.
- Do not change active harness surfaces during an in-flight run.
- Do not silently classify infrastructure failures as Worker failures.
- Do not use model prose as the only acceptance signal.

## Final Design Rule

Covalo should absorb FuguNano as an engineering discipline, not as a new product architecture:

```text
FuguNano multi-agent/fleet ideas: mostly no.
FuguNano evidence packets: yes.
FuguNano bounded repair: yes.
FuguNano runtime guard/certificates: yes.
FuguNano self-harness promotion gate: yes.
FuguNano lineage/provenance: yes.
FuguNano learned conductor replacement: no.
```

This gives Covalo a stable path:

```text
Runtime loop becomes evidence-gated.
Eval becomes the validator for harness changes.
Memory becomes structured and provenance-aware.
Harness changes become reviewable patches with lineage.
System improvement becomes measurable instead of anecdotal.
```

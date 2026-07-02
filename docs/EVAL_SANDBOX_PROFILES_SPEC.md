# Eval Sandbox Profiles Implementation Spec

本文档是给后续 agent 实施的开发规范。目标是用轻量 sandbox profile 体系替代当前未实现的 Docker/Podman container 路线，同时保持 Covalo npm 包尽量小。

## 结论

采用两个用户可见 eval 环境：

```text
sandbox.benchmark
  标准评测沙箱。
  Covalo 管理固定版本工具链。
  首次运行或显式 prepare 时按需下载安装。
  可作为 official benchmark score。

sandbox.local
  本地适配沙箱。
  使用用户本机已有工具链。
  严重缺失时安装 fallback 工具链到 Covalo cache。
  默认只作为 diagnostic / local compatibility score。
```

这条路线比 Docker 更轻，更适合 npm 分发。npm 包不应携带 Node/Bun/Python/uv/rg/jq 等大工具链。用户首次选择 `sandbox.benchmark` 或执行 `covalo eval prepare sandbox.benchmark` 时，再下载和校验所需工具链。

## 方案优劣

### 优点

- npm 包保持小。发布包只包含 JS/TS 代码、manifest、少量 runner 逻辑，以及必要的小型 bootstrap。不要把完整工具链打进 npm tarball。
- 用户体验更可控。首次 benchmark 准备慢，后续复用 cache 快。
- 不依赖 Docker daemon。避免 Docker Desktop、rootless Docker、Podman 兼容性、镜像拉取、权限组等复杂问题。
- 能保留 sandbox 边界。通过 `bwrap`/后续 macOS seatbelt/平台策略限制 workspace、HOME、网络和敏感路径。
- scoring 语义清晰。benchmark 追求公平，local 追求贴近用户机器，两个分数不混用。

### 缺点和边界

- 不如 Docker 完全可复现。没有完整 distro image 时，glibc、系统动态库、编译器行为仍可能受 host 影响。
- Python/SWE-bench 复杂依赖仍可能需要系统库。需要 case contract 明确 `requiredSystemBinaries` 或把复杂 case 标成 unsupported/infra_error。
- `bwrap` 主要是 Linux 路线。macOS/Windows 要么先禁用 official score，要么后续接 seatbelt/WSL/其他 provider。
- Worker 工具链必须真正接入 provider。只把 setup/verifier 放进 sandbox 不够，Worker 的 shell 工具也必须走同一个 sandbox provider。

## 环境命名和迁移

当前代码里有：

```text
sandbox
localenv
container
diagnostic
```

目标用户侧改为：

```text
sandbox.benchmark
sandbox.local
```

兼容策略：

```text
old sandbox  -> sandbox.benchmark
old localenv -> sandbox.local
old container -> deprecated / hidden
diagnostic -> internal alias only, 不出现在 /cases 用户菜单
```

`container` 不再作为默认规划路线。可以保留内部 enum 兼容旧 report，但 UI 不应把它作为可选项，除非未来真的实现 Docker/Podman provider。

## 核心原则

### Toolchain 和 dependencies 分离

```text
toolchain:
  node / bun / python / uv / git / rg / jq / gcc / go / rust 等基础工具

dependencies:
  node_modules
  Python venv / uv cache
  cargo crates
  go modules
  repo-specific generated files
```

规则：

- sandbox profile 管理 toolchain。
- case setup 管理 project dependencies。
- 不要预装所有项目依赖到一个巨大 sandbox。
- setup 必须可追踪、可超时、可缓存、可报告。

## 用户菜单

`/eval` 或 `/cases` 的环境选择应显示：

```text
1. sandbox.benchmark
   标准工具链评测环境。
   Covalo 会准备固定版本工具链。
   适合模型能力对比和官方评分。
   首次运行可能需要下载工具链。

2. sandbox.local
   本地工具链沙箱环境。
   使用你机器上的 Node/Bun/Python 等版本。
   严重缺失时由 Covalo 安装 fallback 工具。
   适合检查 Covalo 在你本机环境里的可用性。
```

不要让用户直接选择 `benchmark-node`、`benchmark-python`、`local-node`。这些由 case manifest 自动选择。

## Case Manifest 扩展

新增或整理 manifest 字段：

```yaml
environment: sandbox.benchmark

requires:
  toolchainProfile: node
  tools:
    required:
      - git
      - bun
    recommended:
      - rg
    optional:
      - jq
  pythonModules: []
  systemBinaries: []
  network:
    setup: true
    agent: false
    verifier: false

workspace:
  mode: fixture-copy

setup:
  commands:
    - bun install --frozen-lockfile
  timeoutMs: 300000

verify:
  commands:
    - bun test ./case.test.ts
```

Profile 解析：

```text
sandbox.benchmark + toolchainProfile=node
  -> benchmark-node toolchain manifest

sandbox.local + toolchainProfile=node
  -> local-node detection/fallback policy
```

## Toolchain Profiles

### benchmark-node

```yaml
id: benchmark-node
environment: sandbox.benchmark
officialScore: true
tools:
  node: 22.17.0
  bun: 1.3.1
  git: 2.45.x
  rg: 14.1.1
  jq: 1.7.1
installRoot: ~/.covalo/toolchains/benchmark/node
pathOrder:
  - node/bin
  - bun/bin
  - git/bin
  - rg/bin
  - jq/bin
sha256Required: true
```

### benchmark-python

```yaml
id: benchmark-python
environment: sandbox.benchmark
officialScore: true
tools:
  python: 3.11.x
  uv: pinned
  git: 2.45.x
  rg: 14.1.1
  jq: 1.7.1
installRoot: ~/.covalo/toolchains/benchmark/python
sha256Required: true
```

### local-node / local-python

```yaml
id: local-node
environment: sandbox.local
officialScore: false
hostAccepted: true
fallbackRoot: ~/.covalo/toolchains/local-fallback
minimumVersions:
  node: ">=20"
  bun: ">=1.2"
  git: ">=2.30"
fallbackInstall:
  bun: true
  rg: true
  jq: true
```

## Toolchain Cache Policy

Covalo npm package must not include managed toolchains.

Use:

```text
~/.covalo/toolchains/benchmark/<profile>/<version>/
~/.covalo/toolchains/local-fallback/<tool>/<version>/
~/.covalo/cache/eval/
```

Each installed tool must have:

```text
toolchain.json
sha256
source URL
installedAt
platform
arch
version
```

Do not install into project workspace. Do not mutate system PATH globally.

## Commands

Add CLI commands:

```bash
covalo eval doctor
covalo eval prepare sandbox.benchmark
covalo eval prepare sandbox.local
covalo eval clean-toolchains
```

`doctor` output should be human-readable and machine-readable with `--json`.

Example:

```text
Covalo Eval Doctor

sandbox.benchmark:
  bwrap               installed
  node 22.17.0        missing, can install
  bun 1.3.1           installed
  python 3.11         missing, can install
  uv                  installed
  rg 14.1.1           installed
  jq 1.7.1            missing, can install
  agent network off   supported

sandbox.local:
  node                host 22.14.0 accepted
  bun                 missing, fallback available
  python              host 3.12.2 accepted
  git                 host 2.45.0 accepted
  rg                  missing, optional
```

## sandbox.benchmark Flow

When user selects `sandbox.benchmark`:

```text
1. Resolve selected category/suite/cases.
2. Read each case's requires.toolchainProfile.
3. Compute required benchmark profiles.
4. Check managed toolchain cache.
5. If missing, prompt once or auto-install according to eval settings.
6. Download tools after user chooses benchmark, not during npm install.
7. Verify sha256 and executable versions.
8. Create isolated case workspace.
9. Enter OS-level sandbox with managed PATH.
10. Run setup with setup network policy.
11. Run Worker with agent network policy.
12. Run verifier with verifier network policy.
13. Write report with environment fingerprint.
```

`officialScore=true` only if:

```text
all required benchmark tools are managed and sha256-verified
case setup succeeds
agent/verifier run under sandbox provider
network policy is enforced
verifier passes
policy gates pass
```

## sandbox.local Flow

When user selects `sandbox.local`:

```text
1. Detect host tools from current PATH.
2. Validate minimum versions.
3. For required missing tools, install fallback into ~/.covalo/toolchains/local-fallback or return infra_error if install fails.
4. For recommended missing tools, install fallback if allowed; otherwise warn.
5. For optional missing tools, warn only.
6. Create isolated workspace.
7. Run with sandbox boundary and local/fallback PATH.
8. Record full environment fingerprint.
```

`officialScore=false` by default.

Report label:

```text
Local Compatibility Report
```

## Worker Execution Requirement

This is P0.

Current architecture already routes setup and verifier through `SandboxProvider.run()`. That is not enough.

Eval Worker execution must ensure:

```text
read/list/search/edit/write:
  limited to case workspace

bash/shell:
  executed through active EvalSandboxProvider.run()
  inherits profile PATH
  uses the same workspace cwd
  respects network policy

verifier:
  executed through same provider/profile

setup:
  executed through same provider/profile
```

Do not claim sandbox.benchmark official scoring if Worker shell still spawns on the host.

Implementation options:

1. Extend `ToolContext` with `sandboxProvider` / `sandboxEnvironment`.
2. Make `bash` tool call `provider.run()` when context has an active eval provider.
3. Keep file tools on host filesystem but enforce realpath workspace boundary.
4. Record every tool command with provider id and profile id.

## Provider Design

Create profile-aware sandbox provider:

```ts
interface EvalSandboxProfile {
  id: "sandbox.benchmark" | "sandbox.local";
  toolchainProfile: "node" | "python" | "mixed";
  officialScore: boolean;
  path: string[];
  toolchainFingerprint: ToolchainFingerprint;
  networkPolicy: {
    setup: boolean;
    agent: boolean;
    verifier: boolean;
  };
}
```

Provider behavior:

```text
BwrapProfileProvider
  wraps command with bwrap
  binds workspace writable
  binds managed toolchain dirs readonly
  exposes HOME as temp/home inside workspace
  blocks sensitive host dirs
  controls network where platform supports it
```

`sandbox.local` can reuse bwrap but PATH comes from accepted host tools plus fallback tool dirs.

## Network Policy

Default:

```text
sandbox.benchmark:
  setup network: allowed only if case explicitly requires it
  agent network: false
  verifier network: false

sandbox.local:
  setup network: case controlled
  agent network: false by default
  verifier network: false by default
```

If bwrap cannot enforce network off on current platform, report must mark:

```text
networkIsolation: unsupported
officialScore: false
```

## Environment Fingerprint

Every report must include:

```json
{
  "environment": "sandbox.benchmark",
  "officialScore": true,
  "sandboxProvider": "bwrap",
  "toolchainProfile": "node",
  "toolchain": {
    "node": {
      "source": "covalo-managed",
      "version": "22.17.0",
      "path": "~/.covalo/toolchains/benchmark/node/node-22.17.0/bin/node",
      "sha256": "..."
    },
    "bun": {
      "source": "covalo-managed",
      "version": "1.3.1",
      "sha256": "..."
    }
  },
  "network": {
    "setup": true,
    "agent": false,
    "verifier": false
  }
}
```

For local:

```json
{
  "environment": "sandbox.local",
  "officialScore": false,
  "toolchain": {
    "node": {
      "source": "host",
      "version": "22.14.0"
    },
    "bun": {
      "source": "covalo-fallback",
      "version": "1.3.1"
    }
  }
}
```

## Scoring Rules

### sandbox.benchmark

Can produce:

```text
Official Benchmark Score
```

Only if:

```text
managed toolchain resolved
sha256 verified
profile matches case requirements
setup passed
verifier passed
policy gates passed
provider can enforce sandbox boundary
```

### sandbox.local

Produces:

```text
Local Compatibility Score
```

Never mix with official score by default.

Use:

```text
officialScore: false
scoreKind: local-compatible
```

## Case Classification

Source of truth for the initial migration is `docs/eval-case-descriptions.md`, with these corrections:

```text
case count:
  eval-case-descriptions.md currently summarizes SWE-bench Lite as 11 cases,
  but its tables list 12 cases
  implementation must use the generated manifest/registry as source of truth
  and fix the description summary during migration

localenv:
  removed from user-facing eval environments
  migrate to sandbox.benchmark or sandbox.local

Covalo-Real:
  removed entirely from current eval registry, menus, generated metadata, and reports
  do not reintroduce as sandbox.local unless a separate design is approved

container:
  not used for this migration
```

The old `smoke / standard` split is only historical documentation. The new registry must classify cases by execution environment and benchmark eligibility.

Use these fields in generated case metadata:

```yaml
environment: sandbox.benchmark | sandbox.local
scoreKind: official | local-compatible
benchmarkEligibility: ready | pending-profile | local-only
requires:
  toolchainProfile: node | python | shell-tools | python-native | ml | system-service
```

Definitions:

```text
ready:
  can run as sandbox.benchmark after managed toolchain/profile preparation

pending-profile:
  suitable for benchmark in principle, but blocked until a dedicated managed profile,
  dependency lock, or setup contract exists

local-only:
  should run only as sandbox.local diagnostic because it depends on host services,
  kernel/system configuration, heavyweight ML stacks, interactive terminals, or
  difficult-to-pin native/compiler behavior
```

### Native Fixtures

All 9 native smoke fixtures are valid in both profiles.

```text
sandbox.benchmark:
  cb-fix-ts-type
  cb-fix-json-cli
  cb-fix-test-fail
  tu-search-before-edit
  tu-run-verify
  tu-retry-on-fail
  sa-no-escape-fixture
  sa-deny-command
  sa-readonly-no-diff

sandbox.local:
  same 9 cases as diagnostic mirror
```

Benchmark requirements:

```text
toolchainProfile: node
required tools: bun, git, sh
officialScore: true only in sandbox.benchmark
```

### Terminal-Bench Allocation

Terminal-Bench contains a mix of deterministic CLI/data tasks and host-sensitive system tasks. Do not bulk-move all Terminal-Bench cases into benchmark.

#### Terminal-Bench: `sandbox.benchmark` Ready

These cases are suitable for official benchmark once their managed profile and setup contract are implemented.

| Category | Case IDs | Required profile |
|----------|----------|------------------|
| coding-basics | `fix-permissions`, `fix-pandas-version`, `csv-to-parquet`, `organization-json-generator`, `heterogeneous-dates`, `jsonl-aggregator`, `tree-directory-parser`, `simple-sheets-put`, `postgres-csv-clean`, `multi-source-data-merger`, `count-dataset-tokens` | `python` or `shell-tools` |
| tool-use | `openssl-selfsigned-cert`, `jq-data-processing`, `sqlite-db-truncate`, `analyze-access-logs`, `log-summary-date-ranges`, `processing-pipeline`, `git-multibranch`, `log-summary` | `shell-tools` |
| safety | `fix-code-vulnerability`, `password-recovery`, `extract-safely`, `vulnerable-secret`, `sql-injection-attack`, `new-encrypt-command` | `python` or `shell-tools` |
| supervisor-recovery | `fix-permissions`, `csv-to-parquet`, `organization-json-generator`, `heterogeneous-dates`, `fix-code-vulnerability`, `jsonl-aggregator`, `openssl-selfsigned-cert`, `postgres-csv-clean`, `sqlite-db-truncate`, `multi-source-data-merger`, `tree-directory-parser` | same as wrapped case |
| long-run | `parallelize-compute-squares`, `large-scale-text-editing` | `python` or `shell-tools` |
| weak-model | `hello-world`, `broken-python`, `countdown-game`, `pandas-etl`, `schedule-vacation`, `flood-monitoring-basic`, `sha-puzzle`, `cross-entropy-method` | `python` or `shell-tools` |

Additional benchmark requirements:

```text
network.agent: false
network.verifier: false
network.setup: true only when dependency install is required
setup must be deterministic enough to report exact package versions
verifier must execute real tests or deterministic command checks
```

#### Terminal-Bench: `sandbox.local` Default

These cases should initially be local-compatible diagnostic only.

| Category | Case IDs | Reason |
|----------|----------|--------|
| coding-basics | `polyglot-c-py` | C/Python compiler and ABI behavior need a dedicated native profile before official scoring |
| tool-use | `nginx-request-logging`, `create-bucket`, `polyglot-rust-c`, `tmux-advanced-workflow` | daemon/cloud/interactivity/Rust-C toolchain behavior is host-sensitive or profile-heavy |
| safety | `acl-permissions-inheritance`, `privilege-escalation`, `decommissioning-service-with-sensitive-data`, `intrusion-detection`, `git-workflow-hack`, `sanitize-git-repo` | ACL/security/service/history-rewrite semantics need stricter audit before benchmark |
| supervisor-recovery | `polyglot-c-py` | inherits native compiler risk from wrapped case |
| long-run | `broken-networking`, `configure-git-webserver`, `install-klee-minimal`, `build-cython-ext`, `pytorch-model-recovery`, `mnist-learning-fix`, `pytorch-model-cli`, `model-extraction-relu-logits`, `modernize-fortran-build`, `predict-customer-churn` | network/service/compiler/ML/Fortran stacks are too heavy or host-sensitive for the initial benchmark profile |
| weak-model | `simple-web-scraper`, `cobol-modernization`, `vimscript-vim-quine`, `mlflow-register` | web access, COBOL/Vim/MLflow dependencies require dedicated profiles or services |

Some `sandbox.local` cases can later move to `sandbox.benchmark` after dedicated profiles exist:

```text
python-native:
  polyglot-c-py
  build-cython-ext

rust-c:
  polyglot-rust-c

ml:
  pytorch-model-recovery
  mnist-learning-fix
  pytorch-model-cli
  model-extraction-relu-logits
  predict-customer-churn

system-service:
  nginx-request-logging
  configure-git-webserver
  mlflow-register
```

Until those profiles exist, these cases must not contribute to official score.

### SWE-bench Lite Allocation

SWE-bench cases are benchmark-oriented, but they require per-repository source snapshots, dependency locks, and reproducible setup. They should not run as official score from ad-hoc host Python environments.

#### SWE-bench: `sandbox.benchmark` Target

These cases are suitable for benchmark once per-repo managed Python profiles are implemented.

| Repository | Case IDs | Profile requirement |
|------------|----------|---------------------|
| `psf/requests` | `psf__requests-863`, `psf__requests-1963`, `psf__requests-2148`, `psf__requests-2317`, `psf__requests-2674`, `psf__requests-3362` | `benchmark-python-requests` |
| `pallets/flask` | `pallets__flask-4045`, `pallets__flask-4992`, `pallets__flask-5063` | `benchmark-python-flask` |
| `pytest-dev/pytest` | `pytest-dev__pytest-11143`, `pytest-dev__pytest-11148`, `pytest-dev__pytest-7168` | `benchmark-python-pytest` |

Initial implementation rule:

```text
If a per-repo benchmark profile and lock file are missing:
  expose these cases under sandbox.local only
  or mark sandbox.benchmark entry as pending-profile and do not allow run
```

Benchmark setup contract for each SWE-bench repo:

```text
source snapshot:
  fixed commit or fixture tarball

dependency setup:
  pinned Python version
  pinned dependency lock or recorded resolver output
  setup command runs inside provider

verifier:
  targeted regression test first
  optional broader suite second
  no grep-only verifier

protected files:
  test files, config files, and verifier files protected unless the upstream task explicitly requires editing them
```

#### SWE-bench: `sandbox.local` Diagnostic Mirror

All SWE-bench Lite cases may also be offered in `sandbox.local` as local-compatible diagnostics:

```text
officialScore: false
scoreKind: local-compatible
toolchain sources may be host or local-fallback
report must show Python version, pip/uv version, installed package versions, and setup output
```

### Registry Rules

Generated registry must not infer environment from old suite names.

Required behavior:

```text
Native fixtures:
  create both sandbox.benchmark and sandbox.local entries

Terminal-Bench ready cases:
  create sandbox.benchmark entries with benchmarkEligibility=ready
  optionally create sandbox.local mirror entries

Terminal-Bench local-default cases:
  create sandbox.local entries only
  optional hidden sandbox.benchmark entries may exist only with benchmarkEligibility=pending-profile

SWE-bench:
  create sandbox.benchmark entries only after per-repo profile exists
  otherwise create sandbox.local entries or pending-profile metadata

Covalo-Real:
  create no entries
```

The `/cases` menu must group by user-visible environment:

```text
sandbox.benchmark:
  official, managed toolchain cases only

sandbox.local:
  local-compatible diagnostic cases
```

Do not display old `localenv`, `container`, `smoke`, or `standard` labels as selectable environments.

## Required Missing Tool Semantics

Use three levels:

```text
required:
  missing means case cannot run

recommended:
  missing means degraded experience; fallback install allowed

optional:
  missing means warning only
```

Benchmark:

```text
all declared tools resolved from managed manifest
missing -> prepare/install
install failure -> infra_error
host substitution -> not allowed for official score
```

Local:

```text
required missing -> fallback install; if fail, case skipped or infra_error
recommended missing -> fallback install or warning
optional missing -> warning only
```

Prefer `infra_error` when a selected case was expected to run but environment prep failed.

## npm Package Size Policy

The npm package must not include:

```text
node distributions
bun distributions
python distributions
uv binaries
rg/jq binaries
Terminal-Bench/SWE-bench source repos
large fixture workspaces
prebuilt dependency caches
```

Allowed:

```text
small manifests
installer code
checksums
case metadata
small native fixtures
small sandbox helper binary only if necessary and size-bounded
```

If bundled `bwrap` remains, keep it small and optional. Full toolchains must be lazy-installed.

## Implementation Plan

### P0: Environment Model

- Replace user-visible `sandbox/localenv/container` menu with `sandbox.benchmark/sandbox.local`.
- Keep old ids only as migration aliases.
- Hide `container` from UI.
- Update `EvalEnvironmentId`, registry filtering, reports, and command parsing.
- Reports must include `environment`, `scoreKind`, `officialScore`.

### P0: Profile-Aware Provider

- Add profile resolver.
- Add managed PATH support to bwrap provider.
- Add environment fingerprint output.
- Ensure setup/verifier use selected profile.
- Ensure Worker shell uses provider, not host spawn.

### P0: Toolchain Doctor and Prepare

- Implement `covalo eval doctor`.
- Implement `covalo eval prepare sandbox.benchmark`.
- Implement `covalo eval prepare sandbox.local`.
- Add JSON output for CI/debugging.
- Do not download anything during npm install.

### P0: Case Contract

- Add `requires.toolchainProfile`.
- Add `required/recommended/optional` tools.
- Add setup network policy.
- Add setup timeout.
- Make missing required tools `infra_error`.

### P1: Managed Toolchain Installer

- Download pinned tools into `~/.covalo/toolchains`.
- Verify sha256.
- Support Linux x64 first.
- Mark unsupported platforms as `infra_error` or diagnostic-only.
- Cache and reuse downloads.

### P1: Reports

- Add environment fingerprint.
- Add toolchain source/version/path/sha256.
- Separate official benchmark score and local compatibility score.
- Show setup install duration.
- Show whether any host tool was used.

### P1: Registry Migration

- Native fixtures should be available in both profiles.
- Terminal-Bench/SWE-bench should not be official until benchmark profiles and setup contracts are verified.
- Remove Covalo-Real completely from source loading, generated registry, tests, docs, and descriptions.

### P2: Cross-Platform

- Linux: bwrap provider first.
- macOS: seatbelt or diagnostic-only until equivalent isolation exists.
- Windows: WSL/provider design later.

## Acceptance Tests

Required:

```bash
bun run typecheck
bun test packages/core/__tests__/sandbox.test.ts
bun test packages/core/__tests__/fixed-eval.test.ts
bun test packages/core/__tests__/eval-case-verifier-contract.test.ts
bun test packages/tui/__tests__/commands.test.ts
```

Add new tests:

```text
doctor reports missing benchmark tools without downloading
prepare downloads only selected benchmark profile
sandbox.benchmark uses managed PATH, not host PATH
sandbox.local records host/fallback tool sources
Worker bash in eval calls provider.run()
setup/verifier/Worker shell share same provider/profile
officialScore=false when host tools are used
container is hidden or disabled
Covalo-Real manifests are absent
```

Manual verification:

```text
/eval -> /cases -> sandbox.benchmark -> native smoke
  first run prompts/prepares missing toolchains
  report officialScore=true if managed tools verified

/eval -> /cases -> sandbox.local -> native smoke
  uses host/fallback tools
  report officialScore=false
```

## Non-Goals

- Do not implement Docker/Podman provider in this iteration.
- Do not bundle full toolchains in npm.
- Do not make local scores comparable to official benchmark scores.
- Do not reintroduce Covalo-Real as an eval source in this migration.

## Final Rule

```text
sandbox.benchmark = fairness and reproducibility
sandbox.local     = local compatibility and product diagnosis
```

Both must keep sandbox boundaries. Only benchmark can become official score.

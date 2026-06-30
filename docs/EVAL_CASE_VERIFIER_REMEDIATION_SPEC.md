# Eval Case Verifier Remediation Spec

本文档是给后续 agent 执行的整改规范。目标不是让当前分数变好看，而是保证 LoopRig `/eval` 中每个 case 都能在对应环境里被客观、可复现地验证。

## 背景结论

用户在 `tool-use / smoke / sandbox` 下看到：

```text
Eval complete: passed=0 failed=3 score=17.33
Report: .deepreef/evals/0b54eefc
```

审计该 run 后确认：

- 运行环境正常：`providerId=bwrap`、`environmentId=sandbox`、`preflight allFound=true`。
- 运行未被中断：`shutdown-reason.json` 为 `completed`。
- 实际只运行了 3 个 case：`tu-search-before-edit`、`tu-run-verify`、`tu-retry-on-fail`。
- 三个 case 的 verifier 全部失败于 `bun run test` 找不到测试：`No tests found!`。

这说明问题不在 sandbox，而在 case/verifier 质量和菜单计数表达。

## 已发现的严重问题

### P0: Native sandbox fixture 的 Bun 测试发现规则错误

以下 5 个 native fixture 都有同类问题：

```text
cb-fix-json-cli      -> cli.fixture-spec.ts
cb-fix-test-fail     -> utils.fixture-spec.ts
tu-search-before-edit -> index.fixture-spec.ts
tu-run-verify        -> calculator.fixture-spec.ts
tu-retry-on-fail     -> integration.fixture-spec.ts
```

它们的 `package.json` 均使用：

```json
{
  "scripts": {
    "test": "bun test"
  }
}
```

Bun 默认发现规则不匹配 `*.fixture-spec.ts`。直接运行 `bun run test` 会得到：

```text
No tests found!
Tests need ".test", "_test_", ".spec" or "_spec_" in the filename
```

这导致这些 case 当前不是在测试 Worker 能力，而是在稳定触发 verifier 配置错误。

### P0: 菜单/报告必须按 environment 显示真实 case 数

用户认为自己选择了 tool-use 20 项，但实际 run 的是：

```text
categoryId=tool-use
suiteId=smoke
environmentId=sandbox
totalCases=3
```

当前信息展示容易把 `localenv`/真实任务数量与 `sandbox` 官方轻量 case 混在一起。任何 `/cases` 菜单、summary、预估 case count 都必须基于三元组：

```text
categoryId + environmentId + suiteId
```

不得只按 category 聚合展示为用户即将运行的数量。

### P0: 空 `file-assert` 必须禁止

`packages/core/src/eval/sources/terminal-bench.ts` 中存在危险逻辑：

```ts
if (!hasTests) {
  return { type: "file-assert", fileAssertions: [] };
}
```

当前锁定的 72 个 Terminal-Bench 实例都有 `tests/test_outputs.py`，所以这段暂未触发。但这是一条假通过入口：空 `fileAssertions` 会被 verifier 视为通过。

规则：

- `file-assert` 的 `fileAssertions` 不能为空。
- source materializer 遇到缺少测试目录或测试文件时，必须把 case 标记为不可用或 infra_error。
- 不允许用空 verifier 让 case 继续进入官方评分。

### P1: `requiredBinaries` 不完整

native coding/tool-use case 使用 `bun`、部分使用 `tsc`，但 manifest 未全部声明 `requiredBinaries`。

规则：

- 使用 `bun run test` / `bun test` 的 case 必须声明 `requiredBinaries: ["bun"]`。
- 使用 `bun run tsc` 的 case 至少声明 `requiredBinaries: ["bun"]`，如直接调用 `tsc` 才声明 `tsc`。
- Terminal-Bench Python verifier 必须声明 `python3` 和 `pytest`，如果 setup 使用 `pip`/`pip3`，也必须声明或在 setup preflight 中单独检查。
- SWE-bench Python verifier 必须声明 Python、pytest、pip/git 等真实依赖。

缺少 required binary 时，case 结果必须是 `infra_error`，不得算作 Worker fail。

### P1: 真实任务不能混入 sandbox 官方评分

当前 real source 包含：

- Terminal-Bench：72 个。
- SWE-bench：12 个。
- looprig-real：12 个。

这些任务依赖真实 repo、Python 包、pip install、历史测试环境或当前 LoopRig 仓库。它们适合 `localenv` 诊断或未来 `container` 强隔离评测，不应在 container provider 未完成前进入 `sandbox` 官方评分池。

规则：

```text
sandbox   -> 只允许 native fixture-copy / small git-worktree case
container -> Terminal-Bench / SWE-bench / 复杂依赖 case
localenv  -> 当前项目和真实本地诊断，不进入官方模型能力分
```

## 必须执行的整改任务

### 1. 修复 native fixture 测试发现

推荐方案：统一重命名测试文件，让 Bun 默认发现：

```text
*.fixture-spec.ts -> *.fixture.spec.ts
```

需要修改的文件：

```text
packages/core/src/eval/fixtures/cb-fix-json-cli/cli.fixture-spec.ts
packages/core/src/eval/fixtures/cb-fix-test-fail/utils.fixture-spec.ts
packages/core/src/eval/fixtures/tu-search-before-edit/index.fixture-spec.ts
packages/core/src/eval/fixtures/tu-run-verify/calculator.fixture-spec.ts
packages/core/src/eval/fixtures/tu-retry-on-fail/integration.fixture-spec.ts
```

接受的替代方案：不重命名文件，但把每个 fixture 的 `package.json` 改为显式路径：

```json
{
  "scripts": {
    "test": "bun test ./*.fixture-spec.ts"
  }
}
```

二选一即可。优先重命名，因为它符合测试框架默认约定，也能被自动 protected-file 规则识别为测试文件。

验收要求：

```bash
cd packages/core/src/eval/fixtures/cb-fix-json-cli && bun run test
cd packages/core/src/eval/fixtures/cb-fix-test-fail && bun run test
cd packages/core/src/eval/fixtures/tu-search-before-edit && bun run test
cd packages/core/src/eval/fixtures/tu-run-verify && bun run test
cd packages/core/src/eval/fixtures/tu-retry-on-fail && bun run test
```

在未修复源代码的 baseline 下，这些命令可以失败，但失败原因必须是具体断言失败、import 失败或业务 bug，绝不能是 `No tests found`。

### 2. 增加 verifier 自检测试

新增或扩展 core 测试，覆盖所有 native sandbox case：

- 创建 case workspace。
- 执行 manifest verifier。
- 断言 verifier 实际启动了测试框架。
- 断言 stdout/stderr 不包含 `No tests found`。
- 对 intentionally failing baseline，允许 verifier fail，但必须记录真实失败原因。

建议测试文件：

```text
packages/core/__tests__/eval-case-verifier-contract.test.ts
```

建议断言：

```ts
expect(output).not.toContain("No tests found");
expect(output).toMatch(/Ran .* tests|pass|fail|expect|SyntaxError|error/i);
```

不要只断言 exit code。baseline case 通常应该先失败，否则无法证明 Worker 修复了什么。

### 3. 禁止空 file-assert

修复点：

```text
packages/core/src/eval/loader.ts
packages/core/src/eval/verifier.ts
packages/core/src/eval/sources/terminal-bench.ts
```

要求：

- loader schema 对 `type: "file-assert"` 要求 `fileAssertions.length > 0`。
- `runFileAssertVerifier()` 遇到空 assertions 时返回 `verdict: "error"`，不能 pass。
- Terminal-Bench source 遇到缺少 `tests/test_outputs.py` 时，不生成空 verifier；应抛出 materialization/manifest error，或生成明确的 infra_error marker。

验收测试：

- 空 `file-assert` manifest 加载失败，或 verifier 返回 error。
- Terminal-Bench 缺测试文件的模拟任务不会进入 pass。

### 4. 补齐 requiredBinaries 和 preflight 契约

修复 native fixture manifest：

```text
cb-fix-ts-type       -> ["bun"]
cb-fix-json-cli      -> ["bun"]
cb-fix-test-fail     -> ["bun"]
tu-search-before-edit -> ["bun"]
tu-run-verify        -> ["bun"]
tu-retry-on-fail     -> ["bun"]
```

Terminal-Bench / SWE-bench / looprig-real source 也必须根据 verifier/setup 自动填充 `requiredBinaries`。

验收要求：

- 缺少 binary 时 case 是 `infra_error`。
- summary/report 中显示 binary 缺失原因。
- 不允许把缺 binary 计为模型 fail。

### 5. 修正 `/cases` 和报告中的 case 数

所有展示 case 数的地方必须按以下参数过滤：

```text
categoryId
environmentId
suiteId
```

具体要求：

- 在选择 category 时，可以展示总量，但必须标明按环境拆分，例如 `sandbox: 3, localenv: 17, container: unavailable`。
- 在选择 environment 后，只能展示该 environment 下可运行 suite 的 case 数。
- 启动前确认文案必须显示即将运行的真实数量。
- `Eval complete` 里的 `totalCases` 要和菜单启动前显示的数量一致。

### 6. 把真实任务环境边界写死

在 registry/build categories 层保证：

- native fixture smoke -> `sandbox`。
- Terminal-Bench/SWE-bench -> `container`，在 container provider 未实现时展示 unavailable，不允许启动。
- looprig-real/current project -> `localenv`，默认 `officialScore=false`。

如果短期仍把 Terminal-Bench/SWE-bench 放在 `localenv`，必须在 UI 和 report 中显示：

```text
diagnostic only, not official score
```

不得标记为 sandbox official score。

## 验收清单

后续 agent 完成后必须提供以下证据：

```bash
bun run typecheck
bun test packages/core/__tests__/eval-case-verifier-contract.test.ts
bun test packages/core/__tests__/fixed-eval.test.ts packages/core/__tests__/eval-runner.test.ts
bun test packages/core packages/tui
```

还必须手动或自动运行一次：

```text
/eval
/cases
tool-use -> sandbox -> smoke
```

验收结果必须满足：

- 启动前显示 3 个 case，而不是 20 个。
- 报告中 `environmentId=sandbox`、`providerId=bwrap`。
- verifier 输出不再出现 `No tests found`。
- fail 时能看到具体业务断言或 Worker 行为失败，而不是测试发现失败。
- `infraErrorCount=0` 只在依赖齐全且 verifier 可启动时成立。

## 禁止事项

- 不要把 verifier 改成 `grep -q` 或只检查字符串存在。
- 不要用空 `file-assert` 代替真实测试。
- 不要为了让 baseline pass 而删除失败测试。
- 不要把 Terminal-Bench/SWE-bench 强行塞进 `sandbox` 官方评分。
- 不要把缺依赖、测试找不到、setup 失败计为 Worker 能力失败。
- 不要只修 tool-use 三个 case；coding-basics 两个同类 fixture 必须一起修。

## 最终判断标准

一个 case 只有满足以下条件，才允许进入官方评分：

```text
workspace 可创建
setup 可复现
required binaries 齐全
verifier 能启动真实测试或真实检查
baseline 失败原因与任务目标相关
Worker 修改后通过 verifier 才算 pass
policy gates 没有失败
report 能解释失败属于 task failure 还是 infra failure
```

如果不满足这些条件，case 必须从 official scoring pool 移除，或标记为 `infra_error` / `diagnostic only`。

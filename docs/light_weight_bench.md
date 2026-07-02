# Covalo Eval NPM 自包含资产改造 Spec

## 0. 一句话目标

让用户通过 npm 安装 Covalo 后，可以直接运行内置 eval 模式，不再因为缺少外部 benchmark 文件、SWE-bench git bundle、Terminal-Bench task 文件、PyTorch `.pt` 文件而失败。

```text id="ou6lx1"
npm install -g @covalo/cli
covalo
  -> 在 TUI 中使用现有 eval 入口
```

应满足：

```text id="kltjgv"
1. 能列出内置 eval cases
2. 能物化内置 eval workspace
3. 能运行内置 eval 主流程
4. 不依赖包外 benchmark 数据文件
5. 不依赖完整 git 历史 bundle
6. 不要求用户额外下载 .pt / .pth / SWE-bench repos
```

本 spec 只处理 **eval 数据资产自包含**。系统运行时依赖，例如 Node、Python、git、pytest、shell 工具、sandbox provider，仍由当前 preflight/setup 机制处理。

注意：当前 CLI 的 `covalo eval` 只包含 `doctor / prepare / clean-toolchains` 子命令。除非本次实现明确新增 CLI list/run 子命令，否则验收不得使用 `covalo eval --list` 或 `covalo eval --category ...` 作为既有入口。

---

## 1. 当前 eval 运行逻辑确认

当前 eval 主流程不应被重构。本次改造必须尊重现有链路。

### 1.1 Manifest 注册

当前 eval 入口会注册两类 manifests：

```text id="o1ws3s"
fixtures manifests
real manifests:
  - Terminal-Bench
  - SWE-bench
```

当前结构大致是：

```text id="boh9r6"
packages/core/src/eval/index.ts
  -> registerBuiltinManifests(ALL_MANIFESTS)
  -> getRealManifests()
  -> loadTerminalBenchManifests()
  -> loadSweBenchManifests()
  -> refreshRegistry()
```

改造后仍保留这个注册模型，但 real manifests 的数据源不应再依赖 `packages/core/src/eval/curated/**` 在 npm 包中存在，而应从包内 `resources/eval-assets/**` 读取。

### 1.2 `runFixedEval()` 主流程

当前 `runFixedEval()` 负责：

```text id="dilc16"
1. resolveSandboxProvider()
2. setVerifierSandboxProvider()
3. setEvalSandboxProvider()
4. 创建 .covalo/evals/<runId>
5. getSuite(categoryId, suiteId, environmentId)
6. preflight
7. 遍历 caseRefs
8. getManifest()
9. createCaseWorkspace()
10. runSingleCase()
11. 汇总 results / failures / cache-summary / report
```

本次不要重写 `runFixedEval()` 的主循环。允许增加 asset preflight，但不要改变 runner 的核心责任边界。

### 1.3 `createCaseWorkspace()` 主流程

当前 `createCaseWorkspace()` 负责：

```text id="wfwr3x"
1. 创建 caseDir/workspaceDir
2. 如果 fixtureSource 是普通目录，则 cp fixture
3. 如果 fixtureSource 以 "__" 开头，则 runMaterializers()
4. 执行 manifest.setup commands
5. git init
6. git config user
7. git add -A
8. git commit -m baseline --allow-empty
```

本次改造的关键点在第 3 步：替换 materializer 获取真实 benchmark 文件的方式。

### 1.4 `runSingleCase()` 主流程

当前 `runSingleCase()` 负责：

```text id="4c4zry"
1. requiredBinaries / requiredPythonModules 检查
2. 构造 worker prompt
3. executeWorker()
4. 记录 worker-output / task-digest / runtime-guard
5. runVerifier()
6. 收集 git diff / objective signals
7. policy gates
8. optional executeSupervisor()
9. score
10. incident/recovery/review packets
11. case result
```

本次不要改动 worker/verifier/policy/scoring 主逻辑。

---

## 2. 当前问题

当前 benchmark 空间大头有三类：

| 问题                                  |   大小 | 现状                                                             |
| ----------------------------------- | ---: | -------------------------------------------------------------- |
| `pytest` 完整 git 历史 bundle           | ~40M | SWE-bench materializer 通过 bundle clone 后 checkout `baseCommit` |
| `requests + flask` 完整 git 历史 bundle | ~26M | 同上                                                             |
| `pytorch-model-recovery` 权重/数据      | ~10M | `weights.pt`、`dataset.pt`、`tests/weights_gtruth.pt` 作为大二进制资产存在 |

根因：

```text id="5jjq73"
当前实现为了得到 baseCommit 对应的工作区，保存了完整 git 历史。
但 eval 后续只依赖 workspace 当前文件树和 baseline git diff，不依赖完整历史。
```

SWE-bench 当前 materializer 逻辑：

```text id="7750qt"
repo bundle
  -> git clone bundle
  -> git checkout baseCommit
  -> git apply testPatch
```

目标逻辑：

```text id="mjk35f"
baseCommit snapshot
  -> 解压 snapshot 到 workspace
  -> git apply testPatch
  -> createCaseWorkspace() 继续执行 git init baseline
```

---

## 3. 改造边界

### 3.1 允许修改

允许修改：

```text id="o0l840"
packages/core/src/eval/sources/**
packages/core/src/eval/materialize/**
packages/core/src/eval/generated/**
packages/core/src/eval/curated/**
resources/eval-assets/**
scripts/eval-assets/**
package.json scripts
README / DEVELOPMENT docs
```

允许小幅修改：

```text id="uzk0gd"
packages/core/src/eval/workspace.ts
```

仅用于：

```text id="a3mzgl"
1. 更明确地处理 materializer error
2. 增加 asset preflight hooks
3. 防止 materializer 静默失败后继续跑空 workspace
```

### 3.2 不应修改

不要重构：

```text id="lrrim7"
runFixedEval()
runSingleCase()
computeScore()
policy gates
supervisor review prompt
verifier classifier
sandbox provider resolution
```

除非是为了接入明确的 `MissingEvalAssetError` / `CorruptEvalAssetError` 分类。

---

## 4. 总体设计

新增一个 npm 包内置资产目录：

```text id="xmdzne"
resources/
  eval-assets/
    assets.lock.json

    swe-bench/
      lock.json
      snapshots/
        psf_requests/
          <baseCommit>.tar.gz
        pallets_flask/
          <baseCommit>.tar.gz
        pytest-dev_pytest/
          <baseCommit>.tar.gz

    terminal-bench/
      lock.json
      category-map.json
      tasks/
        <taskId>/
          task.yaml
          tests/
          ...
      assets/
        # optional: only present if a PyTorch case is kept after shrinking.
        <taskId>/
          <small-assets>
          manifest.json
```

原则：

```text id="efnkm6"
1. resources/eval-assets 是 npm 安装后的唯一内置 benchmark 资产来源
2. packages/core/src/eval/curated 只保留开发期辅助，或迁移为空壳
3. 完整 .git 历史不进入 resources
4. .bundle / .pack / .idx 不进入 resources
5. category-map、SWE lock、Terminal-Bench lock、task 文件都必须能从 resources/eval-assets 解析
6. 大型 .pt / .pth case 优先从 npm 内置 eval 中移除；确需保留时才压缩、缩小、生成并纳入 assets.lock.json 管控
```

---

## 5. 资源定位规则

新增文件：

```text id="qywkna"
packages/core/src/eval/assets/resolve-assets-root.ts
```

职责：

```ts id="3xqzcj"
export function getEvalAssetsRoot(): string;
export function getEvalAssetPath(relativePath: string): string;
export function assertSafeAssetRelativePath(relativePath: string): void;
```

查找顺序：

```text id="m7g7cm"
1. COVALO_EVAL_ASSETS_DIR
2. npm package root/resources/eval-assets
3. repo root/resources/eval-assets
4. development fallback: packages/core/src/eval/curated
```

注意：

```text id="pfyk77"
npm 发布后只有 dist/ 和 resources/ 可靠存在。
不要在运行期依赖 packages/core/src/eval/curated 一定存在。
development fallback 只能服务源码开发；npm pack/install 验收必须关闭或绕过 fallback，确保缺 resources 时失败可见。
```

资产 root 解析必须兼容：

```text id="1doxuj"
1. 源码开发：bun run dev
2. 构建后运行：node dist/index.js
3. npm global install 后运行
```

推荐实现：

```text id="d67juv"
从 import.meta.url / process.argv[1] / process.cwd() 多路径向上查找 package.json，
找到 package root 后优先读取 packageRoot/resources/eval-assets。
```

---

## 6. `assets.lock.json` 格式

新增：

```text id="qcl394"
resources/eval-assets/assets.lock.json
```

格式：

```json id="lcv1y7"
{
  "version": 1,
  "createdAt": "2026-07-01T00:00:00.000Z",
  "sweBench": {
    "dataset": "SWE-bench_Lite",
    "datasetVersion": "20240627",
    "snapshots": {
      "psf/requests#a0df2cbb10419037d11d04352b3175405ab52941": {
        "repo": "psf/requests",
        "baseCommit": "a0df2cbb10419037d11d04352b3175405ab52941",
        "path": "swe-bench/snapshots/psf_requests/a0df2cbb10419037d11d04352b3175405ab52941.tar.gz",
        "format": "tar.gz",
        "sha256": "<sha256>",
        "sizeBytes": 1234567
      }
    }
  },
  "terminalBench": {
    "dataset": "terminal-bench-core",
    "datasetVersion": "0.1.0",
    "tasksRoot": "terminal-bench/tasks",
    "assets": {}
  }
}
```

要求：

```text id="8tz5nv"
1. 所有 path 必须是相对 resources/eval-assets 的路径
2. path 不允许以 "/" 开头
3. path 不允许包含 ".."
4. path 不允许包含 Windows 盘符
5. path 不允许解析到 assets root 外
6. 每个文件必须记录 sha256
7. CI 必须校验 sha256
```

---

## 7. SWE-bench 改造

### 7.1 当前逻辑

当前 SWE-bench manifest 数据来自：

```text id="90c1mu"
swe-bench.lock.json
```

每个 instance 包含：

```text id="sykhxd"
instanceId
repo
baseCommit
environmentSetupCommit
category
suite
version
failToPass
instruction
description
patch
testPatch
```

SWE-bench materializer 当前根据 repo 找 bundle：

```text id="1mho81"
psf/requests      -> psf_requests.bundle
pallets/flask     -> pallets_flask.bundle
pytest-dev/pytest -> pytest-dev_pytest.bundle
```

然后：

```text id="b6ojbv"
git clone bundle workspace
git checkout baseCommit
git apply __test.patch
```

### 7.2 新逻辑

删除 bundle 依赖，改为 snapshot：

```text id="5izb7l"
repo + baseCommit
  -> resolveSweBenchSnapshot()
  -> verify sha256
  -> extract tar.gz into workspace
  -> apply testPatch
```

新增：

```text id="3ljs3y"
packages/core/src/eval/materialize/swe-bench-snapshot.ts
```

接口：

```ts id="wmbjjo"
export interface SweBenchSnapshotRef {
  repo: string;
  baseCommit: string;
  path: string;
  format: "tar.gz";
  sha256: string;
  sizeBytes?: number;
}

export function resolveSweBenchSnapshot(
  repo: string,
  baseCommit: string,
): SweBenchSnapshotRef;

export async function materializeSweBenchSnapshot(
  ref: SweBenchSnapshotRef,
  workspaceDir: string,
): Promise<void>;
```

### 7.3 Materializer 修改要求

修改：

```text id="eybg6o"
packages/core/src/eval/materialize/swe-bench.ts
```

伪代码：

```ts id="0b3m3v"
async materialize(manifest, workspaceDir) {
  const instanceId = manifest.fixtureSource.slice(SWE_PREFIX.length);
  const sourceMeta = manifest.sourceMeta as Record<string, unknown> | undefined;

  const repoName = getRepoName(sourceMeta ?? {});
  if (!repoName) {
    throw new MissingEvalAssetError(`Cannot determine SWE-bench repo for ${manifest.id}`);
  }

  const baseCommit = sourceMeta?.sourceCommit as string | undefined;
  if (!baseCommit) {
    throw new MissingEvalAssetError(`Missing SWE-bench baseCommit for ${manifest.id}`);
  }

  const lockData = getLockInstanceData(instanceId);
  if (!lockData) {
    throw new MissingEvalAssetError(`Missing SWE-bench lock data for ${instanceId}`);
  }

  const snapshot = resolveSweBenchSnapshot(repoName, baseCommit);
  await verifyEvalAsset(snapshot.path, snapshot.sha256);
  await extractSafeTarGz(snapshot.path, workspaceDir);

  const patchFile = join(workspaceDir, "__test.patch");
  writeFileSync(patchFile, lockData.testPatch, "utf-8");

  execFileSync("git", ["apply", "__test.patch"], {
    cwd: workspaceDir,
    stdio: "pipe",
    timeout: 30000
  });

  rmSync(patchFile, { force: true });
}
```

禁止继续使用：

```text id="7gewav"
git clone "<bundle>"
git checkout <baseCommit>
curated/swebench-repos/*.bundle
```

### 7.4 失败行为

当前部分 materializer 路径使用：

```text id="sxhbfm"
console.error(...)
return
```

这会导致 `createCaseWorkspace()` 继续初始化空 workspace。必须改为 throw。

`runMaterializers()` 找不到任何 handler 时也必须 throw，不能静默返回。否则错误的 `fixtureSource` 或未注册 materializer 会被误判成空 workspace 成功。

新增错误类型：

```ts id="4rwivy"
export class MissingEvalAssetError extends Error {}
export class CorruptEvalAssetError extends Error {}
export class UnsafeEvalAssetPathError extends Error {}
export class EvalAssetExtractionError extends Error {}
```

失败时：

```text id="ac3li8"
缺 snapshot -> MissingEvalAssetError
sha256 不匹配 -> CorruptEvalAssetError
tar entry 不安全 -> UnsafeEvalAssetPathError
解压失败 -> EvalAssetExtractionError
git apply testPatch 失败 -> EvalAssetExtractionError 或 SetupFailedError 同级错误
fixtureSource 无 handler -> MissingEvalAssetError 或 setup_failure
```

---

## 8. Snapshot 生成脚本

新增：

```text id="fyy8vg"
scripts/eval-assets/build-swe-snapshots.ts
```

命令：

```bash id="4k93ls"
bun run scripts/eval-assets/build-swe-snapshots.ts
```

输入：

```text id="d0popc"
resources/eval-assets/swe-bench/lock.json
```

或开发期输入：

```text id="83o5ba"
packages/core/src/eval/curated/swe-bench.lock.json
```

输出：

```text id="2mobve"
resources/eval-assets/swe-bench/snapshots/**
resources/eval-assets/assets.lock.json
```

流程：

```text id="zjotd3"
1. 读取 SWE-bench lock
2. 按 repo + baseCommit 去重
3. 对每个 repo 建本地 build cache
4. fetch 对应 baseCommit
5. checkout baseCommit
6. 删除 .git 与无关缓存
7. 打包当前工作区文件树为 tar.gz
8. 计算 sha256
9. 写入 assets.lock.json
```

本地 build cache：

```text id="jkys4w"
.covalo/eval-build-cache/repos/<safeRepoName>
```

输出路径：

```text id="j03oqb"
resources/eval-assets/swe-bench/snapshots/<safeRepoName>/<baseCommit>.tar.gz
```

`safeRepoName` 规则：

```text id="olv8io"
psf/requests      -> psf_requests
pallets/flask     -> pallets_flask
pytest-dev/pytest -> pytest-dev_pytest
```

### 8.1 打包排除规则

必须排除：

```text id="m23kkq"
.git/
.github/
.pytest_cache/
__pycache__/
.mypy_cache/
.ruff_cache/
.tox/
.nox/
build/
dist/
*.pyc
*.pyo
```

谨慎排除，第一版默认不排除：

```text id="oojlql"
docs/
examples/
benchmarks/
tests/
```

不要为了省空间误删测试依赖文件。

### 8.2 可复现 tar.gz

Linux CI 上建议使用稳定参数：

```bash id="nl2ple"
tar \
  --sort=name \
  --mtime='UTC 2020-01-01' \
  --owner=0 \
  --group=0 \
  --numeric-owner \
  -czf <out.tar.gz> .
```

Windows/macOS 开发环境可允许非稳定 tar，但 release 资产必须由 Linux CI 生成。

---

## 9. 安全解压

新增：

```text id="w4k7fb"
packages/core/src/eval/assets/extract-safe.ts
```

接口：

```ts id="thiv79"
export async function extractSafeTarGz(
  assetRelativePath: string,
  workspaceDir: string,
): Promise<void>;
```

要求：

```text id="7zqd37"
1. 解压前先列出 tar entries
2. 每个 entry 不允许绝对路径
3. 每个 entry 不允许包含 ..
4. 每个 entry 不允许 Windows drive path
5. symlink 不允许指向 workspace 外
6. workspaceDir 必须存在
7. 解压结果必须落在 workspaceDir 内
```

可以先用系统 tar：

```bash id="vwi2mo"
tar -tzf asset.tar.gz
tar -xzf asset.tar.gz -C workspaceDir
```

但必须在 `tar -xzf` 之前完成 entry 校验。

---

## 10. Terminal-Bench 改造

### 10.1 当前逻辑

Terminal-Bench manifest 当前从 lock 中读取：

```text id="y9o4bw"
repoPath
tasksDir
commit
instances[]
```

然后 materializer 通过 `sourceTaskPath` 复制 task 目录到 workspace，并排除 Dockerfile、task.yaml、solution、run-tests 等文件。

### 10.2 新逻辑

Terminal-Bench task 文件也必须进入 npm 包内：

```text id="np3zz0"
resources/eval-assets/terminal-bench/tasks/<taskId>/**
```

修改 `loadTerminalBenchManifests()`：

```text id="0wdw84"
sourceRepoPath 不再指向 packages/core/src/eval/curated 或外部 repo
sourceTaskPath 指向 resources/eval-assets/terminal-bench/tasks/<taskId>
```

要求：

```text id="zp5pkw"
1. npm 安装后 sourceTaskPath 仍可解析
2. 不依赖当前工作目录
3. 不依赖源码路径存在
4. lock.json 中 repoPath 可保留为元数据，但运行时 task root 由 getEvalAssetsRoot() 决定
```

### 10.3 Task 复制

保持当前 `terminalBenchMaterializer` 的职责：

```text id="o7ocv9"
copy task files into workspace
patchTestPaths()
createTestRunner()
```

但 taskPath 来源改为 package assets。

---

## 11. PyTorch 大权重 case 处理

### 11.1 目标

当前 `pytorch-model-recovery` 包含 `weights.pt`、`dataset.pt`、`tests/weights_gtruth.pt` 等大二进制文件，单个 case 就接近 10M。`pytorch-model-cli` 也包含 `.pth` 权重文件。

默认目标：

```text id="ilqtqn"
这些大权重 case 不进入 npm 内置 eval assets。
```

处理原则：

```text id="d3ne0i"
1. 优先从 resources/eval-assets/terminal-bench/lock.json 的内置 case 列表中移除大权重 case
2. 对应 task 目录和 .pt / .pth 文件不进入 resources/eval-assets
3. 不要求 npm 包用户额外下载或放置权重
4. 不在 postinstall 中下载权重
5. 移除 case 后，manifest 列表、suite、category 不能引用这些 case
```

### 11.2 可选保留方案：确定性生成小资产

只有在明确决定保留某个 PyTorch case 时，才新增生成脚本。否则不要为了单个重资产 case 增加迁移复杂度。

新增：

```text id="ph5b9a"
scripts/eval-assets/generate-<taskId>.py
```

职责：

```text id="fzoitv"
1. 固定 random seed
2. 生成小型 .pt / .pth / dataset 资产
3. 同步更新 task tests 中对资产尺寸、shape、数值的期待
4. 写入 resources/eval-assets/terminal-bench/assets/<taskId>/
5. 生成 manifest.json
6. 更新 assets.lock.json
```

输出：

```text id="c6fbef"
resources/eval-assets/terminal-bench/assets/<taskId>/
  <small .pt/.pth/assets>
  manifest.json
```

### 11.3 Materializer 复制规则

如果保留 PyTorch case，Terminal-Bench materializer 可以对该 task 增加特殊处理：

```text id="8m4u3l"
if taskId has packaged extra assets:
  copy resources/eval-assets/terminal-bench/assets/<taskId>/* -> workspace expected paths
```

缺文件必须 throw `MissingEvalAssetError`。

如果移除 PyTorch case，则不应存在对应 manifest，不应触发 materializer 特殊分支。

### 11.4 不允许

不允许：

```text id="lijqlc"
1. 从网络下载 .pt
2. 要求用户手动放置 .pt
3. 在 npm postinstall 中下载 .pt
4. 使用 Git LFS
5. 保留 10M 原始大文件而不纳入 size gate
6. 在 lock 中保留已移除 task，导致 npm 安装后 manifest 加载或 materializer 失败
```

---

## 12. Manifest/lock 迁移

### 12.1 SWE-bench lock

迁移：

```text id="crx1c3"
packages/core/src/eval/curated/swe-bench.lock.json
  -> resources/eval-assets/swe-bench/lock.json
```

开发期可以保留原文件副本，但运行时 loader 应优先读取 resources 版本。

### 12.2 Terminal-Bench lock

迁移：

```text id="akoo7m"
packages/core/src/eval/curated/terminal-bench.lock.json
  -> resources/eval-assets/terminal-bench/lock.json
```

运行时 task root 不应再由 lock 中的 `"repoPath": "./"` 决定，而应由 `getEvalAssetsRoot()` 决定。

### 12.3 Loader 行为

`loadSweBenchManifests()`、`loadTerminalBenchManifests()` 和 real category registry 改成：

```text id="ysla86"
1. 先从 resources/eval-assets 读取 SWE lock、Terminal-Bench lock、category-map
2. 如果不存在，再尝试开发期 curated fallback
3. fallback 只用于源码开发，不用于 npm 发布验收
```

当前 `generated/registry.ts` 直接 import `../curated/category-map.json`。这条路径也必须迁移或改为通过 asset resolver 读取；否则 npm 包即使带了 `resources/eval-assets`，real category 构建仍可能依赖源码目录。

---

## 13. Package 发布配置

当前 npm 发布 files 应继续包含：

```text id="wqbqoc"
dist
resources
README.md
README.zh.md
LICENSE
CHANGELOG.md
```

需要确保：

```text id="7bc3tq"
resources/eval-assets/** 被 npm pack 包含
```

新增 scripts：

```json id="oinb4s"
{
  "scripts": {
    "eval:assets:build": "bun run scripts/eval-assets/build-swe-snapshots.ts",
    "eval:assets:verify": "bun run scripts/eval-assets/verify-assets.ts",
    "eval:assets:size": "bun run scripts/eval-assets/check-size.ts",
    "pack:dry-run": "npm pack --dry-run",
    "prepublishOnly": "bun run build && bun run eval:assets:verify && bun run eval:assets:size"
  }
}
```

注意：

```text id="tr1nyp"
prepublishOnly 不应重新 clone/fetch 上游 repo。
prepublishOnly 只做 verify 和 size gate。
资产生成应在 release 准备阶段显式执行。
如果保留某个小型 PyTorch case，它的生成脚本必须由 release 准备阶段显式调用；默认发布流程不应为了已移除的大权重 case 生成资产。
```

---

## 14. Verify 脚本

新增：

```text id="8n0hho"
scripts/eval-assets/verify-assets.ts
```

必须检查：

```text id="j0an3a"
1. resources/eval-assets/assets.lock.json 存在
2. assets.lock.json 可解析
3. 所有 path 安全
4. 所有文件存在
5. 所有 sha256 匹配
6. SWE-bench lock 中每个 repo + baseCommit 都有 snapshot
7. Terminal-Bench lock 中每个 taskId 都有 task directory
8. Terminal-Bench lock 中引用的额外资产都存在
9. resources/eval-assets 下不存在未登记的大文件
10. resources/eval-assets 下不存在 .git / .bundle / .pack / .idx
11. 已从 lock 移除的 PyTorch 大权重 task 不再出现在 manifest/suite 中
```

失败时输出明确报告：

```text id="w0ocy6"
Missing SWE-bench snapshot:
  pytest-dev/pytest#<baseCommit>

Corrupt asset:
  terminal-bench/assets/<taskId>/<asset>
  expected sha256: ...
  actual sha256: ...

Forbidden asset:
  resources/eval-assets/swe-bench/snapshots/pytest.bundle
```

---

## 15. Size gate

新增：

```text id="70km5r"
scripts/eval-assets/check-size.ts
```

### 15.1 禁止类型

仓库中禁止提交：

```text id="w7yaq6"
*.bundle
*.pack
*.idx
.git/
```

除非是测试 fixture 且小于 50KB，并在 allowlist 中说明。

### 15.2 资源大小预算

目标预算：

```text id="f4ho9j"
resources/eval-assets 总大小 <= 35M
单个 SWE snapshot <= 8M
单个可选 PyTorch case 额外资产 <= 2M，最高不得超过 5M
npm packed size <= 30M
npm unpacked size <= 60M
```

若第一阶段达不到 35M，允许临时上限：

```text id="1d3tgn"
resources/eval-assets 总大小 <= 45M
```

但必须比当前三类大头合计显著减少，并在 `docs/DEVELOPMENT.md` 记录原因和后续压缩计划。

### 15.3 npm pack 检查

脚本应调用：

```bash id="4ha0ea"
npm pack --dry-run
```

并解析 packed/unpacked size。不能只检查 git 工作区大小。

---

## 16. 默认 eval 可运行性

为了满足“npm 安装后直接能跑 eval 模式”，需要区分两层：

### 16.1 Eval 模式可启动

必须保证：

```text id="g4r4ip"
covalo --help
covalo eval doctor
现有 TUI eval 入口或新增的 CLI eval list/run 入口
```

不会因为缺 benchmark 文件而崩溃。

当前 CLI 不存在 `covalo eval --list` / `covalo eval --category ...`。如果实现者希望把这些命令作为验收项，必须把新增子命令写入本次改造范围；否则使用现有 TUI 入口和 core integration test 验收。

### 16.2 默认 smoke suite 应尽量轻依赖

新增或指定一个默认 smoke suite：

```text id="uqcdao"
category: weak-model
suite: smoke
```

要求：

```text id="1w24ku"
1. 不依赖 torch
2. 不依赖外部下载
3. 不依赖 SWE-bench 大 snapshot
4. 尽量只依赖 Node/bash/git 或项目已有基础工具
5. 能在普通 npm 安装后跑通
```

完整 SWE-bench cases 可以仍然依赖 Python/pytest 等运行环境，但不能依赖包外 benchmark 文件。缺运行工具时应走当前 infra_error/preflight 路径，而不是 missing asset。PyTorch 大权重 cases 默认不进入 npm 内置 eval；如果保留小型 PyTorch case，缺 torch 也应走 preflight/infra_error。

---

## 17. 错误分类与 runner 集成

新增错误类型后，`createCaseWorkspace()` 或 `runFixedEval()` catch 分支应能区分：

```text id="ocrk4a"
MissingEvalAssetError     -> infra_error, failureClass: "setup_failure" 或新增 "asset_missing"
CorruptEvalAssetError     -> infra_error, failureClass: "setup_failure" 或新增 "asset_corrupt"
UnsafeEvalAssetPathError  -> infra_error, failureClass: "setup_failure" 或新增 "asset_unsafe"
EvalAssetExtractionError  -> infra_error, failureClass: "setup_failure"
```

推荐新增 failureClass：

```ts id="fp8wh7"
type FailureClass =
  | existing
  | "asset_missing"
  | "asset_corrupt"
  | "asset_unsafe"
  | "asset_extraction_failure";
```

如果改动面太大，第一版可以统一映射为：

```text id="65ikx1"
verdict: "infra_error"
failureClass: "setup_failure"
failureReason: error.message
```

但错误 message 必须明确包含 asset 类型、repo、baseCommit、path。

---

## 18. 测试要求

### 18.1 Asset resolver tests

新增：

```text id="6ujow7"
packages/core/src/eval/assets/__tests__/resolve-assets-root.test.ts
packages/core/src/eval/assets/__tests__/assets-lock.test.ts
```

覆盖：

```text id="4kc29j"
1. 能从 COVALO_EVAL_ASSETS_DIR 读取
2. 能从 repo root/resources/eval-assets 读取
3. 能拒绝 ../evil
4. 能拒绝 /absolute/path
5. 能拒绝 C:\evil
6. sha256 正确通过
7. sha256 错误抛 CorruptEvalAssetError
```

### 18.2 SWE snapshot materializer tests

新增：

```text id="0bvtkc"
packages/core/src/eval/materialize/__tests__/swe-bench-snapshot.test.ts
```

覆盖：

```text id="834s9q"
1. fake snapshot 可解压到 workspace
2. testPatch 可应用
3. 缺 snapshot 抛 MissingEvalAssetError
4. tar entry 包含 .. 时拒绝
5. tar entry 是绝对路径时拒绝
6. materializer 失败不会生成空 workspace 继续执行
```

### 18.3 Terminal-Bench asset tests

新增：

```text id="g4q984"
packages/core/src/eval/materialize/__tests__/terminal-bench-assets.test.ts
```

覆盖：

```text id="pygj29"
1. taskPath 从 resources/eval-assets/terminal-bench/tasks 解析
2. lock 中引用的普通 task 可以复制到 workspace
3. 如果保留 task 额外资产，缺少该资产时抛 MissingEvalAssetError
4. npm-like package root 下也能解析资源
```

### 18.4 Runner integration smoke

新增一个最小 fake suite：

```text id="v61a0r"
category: weak-model
suite: smoke
```

覆盖：

```text id="vqdlap"
runFixedEval({
  categoryId: "weak-model",
  suiteId: "smoke",
  executeWorker: fakeWorker,
  executeSupervisor: optionalFakeSupervisor
})
```

断言：

```text id="4q936c"
1. createCaseWorkspace 成功
2. runSingleCase 成功进入 verifier
3. report 写入 .covalo/evals/<runId>
4. 不访问外部 benchmark 文件
```

---

## 19. CI / 发布验收命令

发布前必须通过：

```bash id="rp50w9"
bun run typecheck
bun test packages/core/src/eval
bun run eval:assets:verify
bun run eval:assets:size
bun run build
npm pack --dry-run
```

另外增加一个 npm 包模拟测试：

```bash id="m3mpfb"
npm pack
mkdir -p /tmp/covalo-npm-test
cd /tmp/covalo-npm-test
npm install /path/to/covalo-cli-*.tgz
node node_modules/@covalo/cli/dist/index.js --help
node node_modules/@covalo/cli/dist/index.js eval doctor
```

如果本次同时新增 CLI eval list/run 子命令，再追加对应命令验收；不要把当前不存在的 CLI 参数作为资产改造的必过项。

---

## 20. `.gitignore` / 防回归

更新 `.gitignore` 或 CI size gate，防止重新提交完整历史资产：

```text id="6bofkp"
*.bundle
*.pack
*.idx
resources/eval-assets/**/*.bundle
resources/eval-assets/**/*.pack
resources/eval-assets/**/*.idx
```

注意：不要忽略 `resources/eval-assets/**/*.tar.gz`，因为 snapshot 是正式发布资产。

---

## 21. 文档更新

更新：

```text id="6kx8b8"
README.md
README.zh.md
docs/DEVELOPMENT.md
```

必须说明：

```text id="dykv7c"
1. npm 包内置 eval assets
2. 不再随包分发完整 git 历史
3. SWE-bench 使用 baseCommit snapshot
4. Terminal-Bench task 文件从 resources/eval-assets 读取
5. PyTorch recovery case 使用小型内置资产
6. 缺系统工具会被标记为 infra_error，不是 missing asset
7. 开发者如何重新生成 assets
```

---

## 22. 推荐提交拆分

按以下顺序实施：

```text id="kmdxtx"
1. eval-assets: add resources/eval-assets lock resolver and sha256 verifier
2. eval-sources: load SWE/Terminal locks from resources first
3. eval-swebench: replace git bundle materializer with snapshot materializer
4. eval-terminal: load packaged task root from resources/eval-assets
5. eval-terminal: remove PyTorch large-weight tasks from packaged lock, or shrink them before keeping
6. eval-assets: add build/verify/size scripts
7. eval-smoke: ensure weak-model/smoke contains at least one lightweight packaged case
8. docs: document self-contained npm eval assets
```

不要把所有改动合并成一个巨大提交。

---

## 23. 验收标准

### 23.1 功能验收

在不 clone 源码仓库的干净目录中：

```bash id="90wchy"
npm install -g @covalo/cli
covalo --help
covalo eval doctor
```

必须成功。内置 eval case 的列出与运行通过现有 TUI 入口或 core integration test 验收；只有实现了 CLI list/run 子命令时，才增加 `covalo eval --list` / `covalo eval --category weak-model --suite smoke` 验收。

### 23.2 资产验收

必须满足：

```text id="pbgo3x"
1. npm 包中存在 resources/eval-assets/assets.lock.json
2. npm 包中存在 resources/eval-assets/swe-bench/snapshots/**
3. npm 包中存在 resources/eval-assets/terminal-bench/tasks/**
4. npm 包中不存在已移除 PyTorch 大权重 task 的 .pt / .pth 文件
5. npm 包中不存在 .bundle / .pack / .idx / .git
6. assets.lock.json 中所有 sha256 校验通过
7. Terminal-Bench lock 不引用已移除的 PyTorch 大权重 task
```

### 23.3 SWE-bench 验收

选择至少一个 SWE-bench case：

```text id="vytww1"
1. 能从 snapshot 物化 workspace
2. workspace 中有对应 repo 文件树
3. testPatch 已应用
4. createCaseWorkspace 后存在 baseline commit
5. worker 执行后 verifier 能运行
```

### 23.4 Terminal-Bench 验收

选择至少一个普通 Terminal-Bench case。若保留了小型 PyTorch case，再额外选择该 case：

```text id="f22k99"
1. task 文件从 resources/eval-assets/terminal-bench/tasks 复制
2. tests 存在
3. 已移除的大权重 task 不出现在 manifest/suite 中
4. 不访问包外 task 文件
5. 若保留小型 PyTorch case，其额外资产存在于 workspace 的预期位置
```

### 23.5 体积验收

目标：

```text id="4ku78d"
resources/eval-assets 总大小 <= 35M
临时上限 <= 45M
单个可选 PyTorch case 额外资产 <= 2M，最高不得超过 5M
npm packed size <= 30M
npm unpacked size <= 60M
```

### 23.6 失败行为验收

手动删除一个 snapshot 后运行对应 case，必须得到明确 infra error：

```text id="8lwjgn"
MissingEvalAssetError: missing SWE-bench snapshot for pytest-dev/pytest#<baseCommit>
```

不能出现：

```text id="s6ll1p"
1. 空 workspace 被继续执行
2. pytest 报一堆无关文件不存在
3. case 被错误归类为 worker failure
4. silent console.error + return
```

---

## 24. 最终状态

完成后，Covalo eval 资产模型应变成：

```text id="au5so8"
@covalo/cli npm package
  ├─ dist/
  ├─ resources/
  │   └─ eval-assets/
  │       ├─ assets.lock.json
  │       ├─ swe-bench/
  │       │   ├─ lock.json
  │       │   └─ snapshots/
  │       └─ terminal-bench/
  │           ├─ lock.json
  │           ├─ tasks/
  │           └─ assets/
  ├─ README.md
  └─ LICENSE
```

运行时：

```text id="bqmw2z"
runFixedEval()
  -> getSuite()
  -> getManifest()
  -> createCaseWorkspace()
      -> materializer 从 resources/eval-assets 读取内置资产
      -> setup
      -> git init baseline
  -> runSingleCase()
      -> worker
      -> verifier
      -> policy gates
      -> supervisor
      -> score/report
```

被移除：

```text id="03y6r3"
curated/swebench-repos/*.bundle
完整 git 历史
包外 benchmark 文件依赖
手动下载 .pt / .pth
```

核心验收口径：

```text id="2lwdc0"
npm 安装后的 Covalo eval 模式，必须依靠包内 resources/eval-assets 完成内置 case 的 manifest 加载、workspace 物化和必要数据文件准备。
```

# Deepicode CI 与平台兼容性修复执行指南

本文档用于指导后续 agent 处理 Deepicode 的 GitHub Actions CI、Windows/macOS/Linux 兼容性和测试稳定性问题。执行目标不是“让 CI 临时变绿”，而是把跨平台失败点修成可长期维护的代码或测试。

## 目标

1. `bun run typecheck` 必须零错误。
2. `bun test` 必须在本地 Linux 环境通过。
3. GitHub Actions matrix 必须在 `ubuntu-latest`、`macos-latest`、`windows-latest` 全部通过。
4. 不允许用跳过测试、降低断言、吞掉真实错误的方式掩盖生产代码问题。
5. 对平台差异要落到明确边界：路径、shell、文件 URL、进程树、权限位、scheduler、notification、测试超时。

## 当前已知稳定基线

截至 2026-06-04，master 最新 CI 已确认三平台通过。

最新已通过提交：

- `cbe7d40 docs: add ci compatibility fix guide`

最新已通过 GitHub Actions run：

- `26928492923`
- URL: `https://github.com/bzcsk2/deepicode/actions/runs/26928492923`
- 结论: `success`
- 平台:
  - `ubuntu-latest`: success
  - `macos-latest`: success
  - `windows-latest`: success

最近一次已确认通过的真实代码 checkpoint：

- `c61cb0e chore: checkpoint full project state`

最近一次已确认通过的真实 CI 修复提交：

- `f06bc0f fix(ci): stabilize windows platform tests`

其后历史 checkpoint：

- `e9ccb4f chore: checkpoint full code after ci green`

本地验证命令：

```bash
bun run typecheck
bun test
```

历史稳定结果：

- `bun run typecheck`: pass
- `bun test`: `1050 pass / 18 skip / 0 fail`
- GitHub Actions: Ubuntu、macOS、Windows matrix 全绿

## 必须先做的诊断

查看最新 CI：

```bash
gh run list --repo bzcsk2/deepicode --branch master --limit 5 \
  --json databaseId,headSha,status,conclusion,createdAt,displayTitle,url
```

查看单个 run：

```bash
gh run view <run_id> --repo bzcsk2/deepicode --json status,conclusion,url,jobs
```

下载失败 job 日志：

```bash
gh api /repos/bzcsk2/deepicode/actions/jobs/<job_id>/logs > /tmp/deepicode-ci-job.log
rg -n "\(fail\)|tests failed|TypeError|Received:|Expected:|error:|FAIL|timed out|Timeout" /tmp/deepicode-ci-job.log
```

不要只看 GitHub 页面摘要。必须定位到失败测试、堆栈和平台。

## 已修过的 CI 问题与根因

### 1. frozen lockfile 失败

现象：

```text
bun install --frozen-lockfile
lockfile had changes, but lockfile is frozen
```

根因：

- workspace package 已加入 `package.json`，但 `bun.lock` 未同步。
- 典型案例：`packages/plugin` 已作为 workspace 存在，但 lockfile 缺少 `@deepicode/plugin`。

修复：

```bash
bun install
bun install --frozen-lockfile
```

提交 `bun.lock`，不要手写 lockfile。

### 2. Bun latest 导致测试漂移

现象：

- CI 用 `bun-version: latest`，本地用固定版本。
- 本地绿，CI 因 Bun 行为差异失败。

修复原则：

- `.github/workflows/ci.yml` 固定 Bun 版本。
- 当前基线为 `1.3.6`。

示例：

```yaml
with:
  bun-version: 1.3.6
```

只有在本地和三平台 CI 都验证后，才允许升级 Bun。

### 3. 测试 mock 泄漏

现象：

- 单测单独跑通过，全量或 CI matrix 中失败。
- 失败位置与实际错误无关。
- 例如 TokenizerPool、client、policy-store mock 泄漏到 benchmark、SSE 或 context 测试。

修复原则：

- 避免在共享测试文件中 mock 高层模块。
- 需要 mock 时，确保 mock 的行为保留真实语义，不要过度简化。
- 用真实 `MockSseServer` 替代全局 client mock。
- 测试中的临时 `.deepicode` 状态必须用临时 cwd 隔离。

建议结构：

```ts
const originalCwd = process.cwd()
const testCwd = mkdtempSync(join(tmpdir(), "deepicode-test-"))
process.chdir(testCwd)

try {
  // test
} finally {
  process.chdir(originalCwd)
  await rm(testCwd, { recursive: true, force: true })
}
```

### 4. Windows 路径断言不可靠

现象：

- Linux/macOS 用 `/nonexistent/...` 可以稳定失败。
- Windows/MSYS 下同一路径可能被转换或可创建，导致断言反转。

错误写法：

```ts
new ContextPolicyStore("/nonexistent/path/that/does/not/exist")
```

正确写法：

```ts
const fileAsWorkspace = join(tmpDir, "not-a-directory")
await writeFile(fileAsWorkspace, "blocks nested .deepicode creation")

const invalidStore = new ContextPolicyStore(fileAsWorkspace)
const saved = await invalidStore.save(DEFAULT_CONTEXT_POLICY)
expect(saved).toBe(false)
```

核心原则：用 `ENOTDIR` 这类跨平台稳定错误，不依赖根目录权限或路径语义。

### 5. file:// URL 在 Windows 上必须合法生成

现象：

```text
TypeError: File URL path must be an absolute path
```

错误写法：

```ts
"file:///path/to/plugin.ts"
```

正确写法：

```ts
pathToFileURL(join(tmpDir, "plugin.ts")).href
```

核心原则：不要手写 file URL。统一使用 `pathToFileURL()` 和 `fileURLToPath()`。

### 6. MCP 初始化挂起导致后续测试串扰

现象：

- LSP 测试报 MCP initialize timeout。
- 实际失败来自较早的 MCP 测试中启动了永不响应 initialize 的子进程。
- 30 秒后 pending promise 抛错，污染后续测试。

根因：

- `McpHost.connect()` 在 `client.connect()` 完成前没有把 client 登记到 host。
- `disconnectAll()` 无法清理正在初始化的挂起 client。
- 测试中的 `host.connect()` promise 没有显式消费 rejection。

生产代码修复原则：

- `McpHost.connect()` 创建 client 后立即登记。
- connect 失败时删除登记并调用 `client.disconnect()`。
- `disconnectAll()` 必须能清理初始化中、已连接、半失败三种状态。

测试修复原则：

```ts
const connectPromise = host
  .connect("silent", { command: process.execPath, args: [script] })
  .catch((error) => error)

await new Promise(r => setTimeout(r, 100))
await host.disconnectAll().catch(() => {})

const result = await connectPromise
expect(result).toBeInstanceOf(Error)
```

不要留下未处理 promise。

## 平台兼容性检查清单

### 路径与 URL

- 使用 `join()`、`resolve()`、`dirname()`，不要手写 `/`。
- file URL 使用 `pathToFileURL()`。
- file URL 反解使用 `fileURLToPath()`。
- 测试断言不要假设 Windows 路径以 `/` 开头。
- 错误消息不要精确匹配平台相关路径，优先匹配错误类型或稳定片段。

### Shell 与进程

- Windows 使用 PowerShell 后端。
- POSIX 使用 `bash` 或 `sh` 后端。
- 长运行子进程必须支持超时和 AbortSignal。
- 进程树终止必须走平台能力层，不要直接 `process.kill(-pid)` 套到 Windows。
- CI 中对 POSIX-only 或 Windows-only probe 使用 workflow 条件分支，而不是测试内硬跳。

### Scheduler

- Linux/macOS: crontab。
- Windows: schtasks。
- 测试要验证命令构造和安全边界，不要依赖 runner 上一定存在真实计划任务权限。

### Notification

- Linux: `notify-send` 或 terminal fallback。
- macOS: `osascript`。
- Windows: PowerShell backend。
- CI 只能做轻量 probe，不能要求真实桌面弹窗。

### 文件权限

- 不要用 POSIX mode 位作为跨平台唯一断言。
- Windows 下权限位语义不同，测试应断言行为结果，而不是硬编码 mode。

## GitHub Actions 期望结构

workflow 必须至少包含：

1. checkout
2. setup Bun 固定版本
3. `bun install --frozen-lockfile`
4. `bun run typecheck`
5. `bun test`
6. 平台专项 probe

matrix:

```yaml
strategy:
  fail-fast: false
  matrix:
    os: [ubuntu-latest, macos-latest, windows-latest]
```

原则：

- `fail-fast: false` 保留所有平台结果，便于一次性修复。
- POSIX probe 只在非 Windows 跑。
- Windows probe 只在 Windows 跑。
- 不要因为一个平台无关失败取消其他平台 job。

## 修复流程

1. 拉取最新 master。

```bash
git pull --ff-only
```

2. 看本地状态，确认没有用户未提交改动被误纳入。

```bash
git status --short
```

3. 下载失败 job 日志，定位失败用例和堆栈。

4. 判断类别：

- lockfile
- Bun 版本
- mock 泄漏
- 路径/file URL
- shell/进程树
- scheduler/notification
- 测试自身 race 或未处理 promise
- 真实生产代码 bug

5. 优先做最小修复。

6. 本地验证：

```bash
bun run typecheck
bun test <affected-test-files>
bun test
```

7. 提交并推送：

```bash
git add <changed-files>
git commit -m "fix(ci): <具体问题>"
git push
```

8. 监控 CI：

```bash
gh run list --repo bzcsk2/deepicode --branch master --limit 3 \
  --json databaseId,headSha,status,conclusion,displayTitle,url

gh run watch <run_id> --repo bzcsk2/deepicode --exit-status
```

9. 如果 CI 失败，回到第 3 步。不要连续盲改。

## 提交规范

推荐提交名：

- `fix(ci): update bun lockfile`
- `fix(ci): pin bun version`
- `test(core): isolate leaking mocks`
- `fix(mcp): cleanup initializing clients`
- `test(plugin): use platform safe file urls`
- `test(core): use platform stable save failure`

一次提交只解决一个明确问题。不要把 UI 重构、文档整理和 CI 修复混在同一个提交里。

## 禁止事项

- 禁止为让 CI 变绿而删除核心测试。
- 禁止把失败测试改成无意义断言。
- 禁止使用 `test.skip` 绕过真实跨平台 bug。
- 禁止手写 `bun.lock`。
- 禁止用 Linux-only 路径或命令验证 Windows 行为。
- 禁止留下未处理 promise、未关闭 server、未清理子进程。
- 禁止在全局测试文件中 mock 共享模块后不恢复。

## 完成标准

任务完成必须同时满足：

- 本地 `bun run typecheck` 通过。
- 本地 `bun test` 通过。
- GitHub Actions 最新 master run 三平台 success。
- 文档或 TODO 中不再保留已完成的 CI bug 项。
- `git status --short` 中没有意外未提交代码。

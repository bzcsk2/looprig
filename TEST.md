# Deepicode 增量系统验收测试计划

> 更新日期：2026-06-02
>
> 目标：指导后续 Agent 和项目负责人验证 Deepicode 的真实系统行为。本文只列出尚未被现有自动化测试充分覆盖的验收项，不重复编写或逐条重跑已经覆盖的模块级测试。
>
> 适用版本：当前主线，以及 `TODO.md` 中剩余修复和平台验收完成后的候选版本。

## 1. 使用方式

本文件不是新的单元测试清单，而是发布前的增量系统验收手册。测试分成两条互不混写的轨道：

| 轨道 | 执行者 | 用途 |
| --- | --- | --- |
| `G0` - `G5` | 测试 Agent | 自动化或半自动化系统验收，必须保存机器可复核证据。 |
| `H1` - `H8` | 项目负责人 | 人工体验验收，验证真实终端中的观感、手感和系统交互。 |

测试 Agent 必须：

1. 先读取 `TODO.md`、`DONE.md` 和本文件。`ADVICE.md` 仅为归档入口，不再提供任务。
2. 执行 `git status --short`，记录已有未提交修改，不覆盖其他 Agent 的工作。
3. 在隔离临时目录中运行验收，不使用真实项目目录、不读取真实凭证、不修改用户现有 crontab 或计划任务。
4. 每个用例记录 `PASS`、`FAIL`、`BLOCKED`、`NOT_IMPLEMENTED` 或 `NOT_RUN`。
5. 发现问题时保存复现命令、终端输出、诊断日志、平台信息和最小复现步骤。
6. 测试 Agent 只提交测试脚本、测试报告和必要 fixture。除非用户明确要求，不在验收阶段顺手修改生产代码。
7. 报告中引用的每个证据文件必须真实存在于 `artifacts/`。只在终端中观察过、未保存证据的结果不得标记为 `PASS`。
8. 不得把失败直接降级成“已知问题”或“与本次无关”。若怀疑为抖动，必须保存失败输出、独立复现目标测试，并记录至少一次完整重跑结果。

项目负责人执行人工验收时只需填写 `H` 轨结果，不需要重复执行 Agent 已完成的故障注入、性能压测和隔离 Scheduler 测试。

状态定义：

| 状态 | 含义 |
| --- | --- |
| `PASS` | 已执行，满足通过标准。 |
| `FAIL` | 已执行，行为不符合通过标准。必须建立 Bug 记录。 |
| `BLOCKED` | 环境缺少依赖、权限或运行条件。记录阻断原因。 |
| `NOT_IMPLEMENTED` | `TODO.md` 中规划的功能尚未实现。不是测试环境问题，但属于发布阻断项。 |
| `NOT_RUN` | 尚未执行，或证据不足以判定结果。不得计入通过数。 |

## 2. 已验证基线：不要重复展开

截至 2026-06-02，仓库已有自动化测试：

```text
bun run typecheck: PASS
bun test: 787 pass / 0 fail
测试文件: 56
```

以下模块已有较完整回归覆盖。系统验收时只需运行一次总门禁，不要重新设计同类单元测试：

| 已覆盖领域 | 现有测试位置 |
| --- | --- |
| SSE 分片、半个 UTF-8 字符、工具参数跨 chunk、重试、并发流 | `packages/core/__tests__/sse-client.test.ts` |
| 工具 shared/exclusive、权限拒绝、exactly-once 写回、中断、progress | `packages/core/__tests__/streaming-executor.test.ts` |
| Session 切换、旧格式兼容、损坏尾行恢复、writer 可观测性 | `packages/core/__tests__/session.test.ts` |
| Context 三区域布局、硬预算、tool-call 原子性 | `packages/core/__tests__/context.test.ts` |
| Result persistence 配额、磁盘初始化、清理回收 | `packages/core/__tests__/result-persistence.test.ts` |
| MCP 断连、初始化超时、stdin 不可写、malformed JSON 恢复 | `packages/mcp/__tests__/mcp-host.test.ts` |
| Bash 有界输出、timeout、AbortSignal | `packages/tools/__tests__/bash.test.ts` |
| Engine 内部工具链、权限确认、中断 | `packages/core/__tests__/e2e.test.ts` |
| TUI bridge 队列、权限取消、中途追加输入 | `packages/tui/__tests__/bridge.test.ts` |

这些测试仍应作为回归门禁执行，但不等于完整系统验收。它们没有覆盖真实 TTY、跨平台 shell、真实子进程树、桌面通知、计划任务和完整 CLI 启动链路。

## 3. 测试环境与证据

### 3.1 平台矩阵

最终发布候选必须在以下原生环境执行：

| 平台 ID | 环境 | 必须覆盖 |
| --- | --- | --- |
| `LNX` | Linux，常见终端 | 当前行为不回归、Bash、PTY、Monitor、通知 fallback、MCP |
| `MAC` | macOS，Terminal 或 iTerm2 | `/bin/bash`、BSD `ps`、`df`、`osascript`、crontab、PTY |
| `WIN` | Windows Terminal + PowerShell | 无 WSL/Git Bash 条件下启动、PowerShell backend、ConPTY、路径、进程树、Monitor、Scheduler |

Windows 建议额外抽查：

| 平台 ID | 环境 | 用途 |
| --- | --- | --- |
| `WIN-PS7` | PowerShell 7，存在 `pwsh.exe` | 验证首选 backend。 |
| `WIN-PS5` | 仅系统 `powershell.exe` | 验证 fallback。 |

### 3.2 隔离要求

每次验收创建独立目录：

```text
<tmp>/deepicode-system-acceptance-<timestamp>/
  workspace/
  home/
  fixtures/
  artifacts/
```

启动进程时：

- `cwd` 指向临时 `workspace/`。
- `HOME` 指向临时 `home/`。
- Windows 同时设置 `USERPROFILE` 指向临时 `home/`。
- API key 使用测试值或专用测试密钥。
- MCP 配置写入临时 workspace 的 `.deepicode/mcp.json`。
- 所有 Scheduler 创建项使用唯一前缀：`deepicode-acceptance-<timestamp>-`。
- CLI 的 `cwd` 必须指向临时 `workspace/`。Runtime logger 默认写入 `<cwd>/.deepicode/logs/`，不是 `<HOME>/.deepicode/logs/`。
- 日志专项测试建议显式设置 `DEEPICODE_LOG_FILE=<artifacts>/logs/runtime.jsonl`，避免路径判断错误。

从临时 workspace 启动 CLI 时，使用仓库入口的绝对路径：

```bash
cd <tmp>/deepicode-system-acceptance-<timestamp>/workspace
bun run <repo>/packages/cli/src/index.ts
```

不得为了使用相对路径而把 CLI 的 `cwd` 改回仓库根目录。

### 3.3 每次运行必须保存

在 `artifacts/` 保存：

```text
environment.txt
git-status.txt
typecheck.txt
bun-test.txt
system-acceptance-report.md
tui/
logs/
process/
platform/
```

`environment.txt` 至少包含：

```text
git rev-parse HEAD
git status --short
bun --version
node --version
process.platform
shell backend
terminal name
```

任何标记为 `PASS` 的自动化用例还必须保存：

```text
<case-id>-command.txt
<case-id>-stdout.txt
<case-id>-stderr.txt
<case-id>-result.json
```

`<case-id>-result.json` 至少记录退出码、是否超时、用例断言和残留进程检查结果。

### 3.4 测试辅助设施

允许测试 Agent 新增测试专用文件：

```text
e2e/system/
  helpers/
    scripted-sse-server.ts
    pty-runner.ts
    process-inspector.ts
    temp-workspace.ts
  fixtures/
    mcp-echo-server.mjs
    child-tree.*
  *.acceptance.test.ts
```

要求：

- TUI 验收必须使用 PTY/ConPTY，不得用普通 stdin pipe 冒充 TTY。
- 模型行为使用脚本化 SSE fixture，固定返回文本或 tool call，禁止依赖自然语言模型临场决定。
- fixture 只放测试目录，不修改生产实现。
- 若 Windows ConPTY 自动化暂时不可用，保留手工步骤并标记 `BLOCKED`，不能伪造通过。

## 4. 执行阶段

| 阶段 | 内容 | 当前代码可执行 | 发布阻断 |
| --- | --- | --- | --- |
| `G0` | 总门禁 | 是 | 是 |
| `G1` | Linux CLI/TUI 系统链路 | 是 | 是 |
| `G2` | 故障注入与资源回收 | 部分可执行 | 是 |
| `G3` | Windows/macOS 平台适配验收 | 平台代码落地后执行 | 是 |
| `G4` | 性能与长时间稳定性 | 是 | 是 |
| `G5` | 可选真实外部服务 smoke | 有专用凭证时执行 | 否，但上线前建议执行 |
| `H1` - `H8` | 人工体验验收 | 对应平台功能落地后执行 | 是，需要项目负责人确认 |

### 4.1 当前接力状态与复测顺序

截至 2026-06-02，已独立确认以下问题：

| ID | 状态 | 说明 |
| --- | --- | --- |
| `BUG-01` | 已复现，待修复 | Pipe mode 已输出完整响应但不会正常退出。根因是生命周期清理缺失：`ContextManager.shutdown()` 未在 CLI 正常退出路径调用，tokenizer worker 保持事件循环存活。不要用 `process.exit(0)` 掩盖资源未释放。 |
| `LOG-READABILITY-01` | 已复现，待评估 | Runtime log 脱敏规则会把 `promptTokens`、`completionTokens` 等非敏感统计字段误写成 `[REDACTED]`，降低诊断价值。 |
| `TEST-STABILITY-01` | 待持续观察 | 曾出现 WebSearch、SSE 和 benchmark 超时，但独立重跑总门禁得到 `787 pass / 0 fail`，目标文件单独运行也全部通过。暂不能认定为稳定产品 Bug。 |

后续测试 Agent 必须按以下顺序工作：

1. 先确认生产代码已经修复 `BUG-01`，然后执行 `G0-01`。
2. 连续执行 `bun test` 至少 3 次并分别保存输出；任意一次失败都记录为 `TEST-STABILITY-01`，不得删除失败证据。
3. 复测 `G1-01`。Pipe mode 必须自然退出，不能由测试脚本主动 kill 后伪装成通过。
4. 依次执行 `G1-09`、`G2-05`、`G4-01`。这些用例此前受 `BUG-01` 阻断。
5. 在 Linux 环境继续执行不依赖 PTY 的 `G2-02`、`G2-04`。不要因为缺少 PTY 而跳过。
6. 有 PTY 后执行剩余 Linux TUI 用例。有 macOS、Windows runner 后执行 `G3`。

如果 `BUG-01` 尚未修复：

- `G1-01` 标记 `FAIL`。
- 依赖 CLI 正常退出和日志 flush 的 `G1-09`、`G2-05`、`G4-01` 标记 `BLOCKED`，备注 `BLOCKED_BY_BUG-01`。
- 其他不依赖 CLI 退出的测试继续执行，不能整体停止。

## 5. G0：总门禁

### G0-01 编译与已有回归

执行：

```bash
bun run typecheck
bun test
```

通过标准：

- `bun run typecheck` 退出码为 `0`。
- `bun test` 无失败、无崩溃、无未处理 Promise rejection。
- 测试数量可以增加，不要求永远等于 774；不得无说明减少测试数量。

证据：

- 保存完整输出到 `typecheck.txt` 和 `bun-test.txt`。

### G0-02 CLI help 启动

执行：

```bash
bun run packages/cli/src/index.ts --help
```

通过标准：

- 退出码为 `0`。
- 输出包含用法和 slash command 提示。
- 不创建运行时日志文件，不请求网络。

## 6. G1：Linux CLI/TUI 系统链路

本阶段必须在 Linux 原生 PTY 中执行。除 `G1-01` 外，优先自动化；无法自动化时保存终端录屏或逐步截图。

### G1-01 Pipe mode 基础链路

前置：

- 启动脚本化 SSE server，返回固定文本流：`hello`、` world`、`done`。
- 设置 `DEEPSEEK_BASE_URL` 指向该 server，`DEEPSEEK_API_KEY=test-key`。

执行：

```bash
cd <tmp>/deepicode-system-acceptance-<timestamp>/workspace
printf 'hi\n' | bun run <repo>/packages/cli/src/index.ts
```

通过标准：

- stdout 最终包含 `hello world`。
- 进程在响应完成后 3 秒内自然退出，退出码为 `0`。
- 不允许测试脚本调用 `kill`、`process.exit()` 或超时终止后仍将结果记为通过。
- SSE server 收到一次请求，body 中包含用户消息。
- stderr 无未处理异常。
- 退出后不存在 tokenizer worker、MCP 子进程或其他 Deepicode 残留子进程。

证据：

- 保存 `g1-01-command.txt`、`g1-01-stdout.txt`、`g1-01-stderr.txt` 和 `g1-01-result.json`。
- `g1-01-result.json` 必须包含 `code`、`timedOut`、`durationMs` 和残留进程检查。

### G1-02 TUI 启动、退出和终端恢复

步骤：

1. 在 PTY 中启动 `bun run packages/cli/src/index.ts`。
2. 等待主界面渲染。
3. 输入 `/exit` 和 Enter。
4. 进程退出后，在同一个 PTY 输入普通文本。

通过标准：

- TUI 可见且无启动异常。
- `/exit` 后进程在 2 秒内退出。
- 光标恢复可见，终端不残留 alternate screen。
- 后续普通文本正常显示。

### G1-03 Slash 菜单上下键回归

步骤：

1. 启动 TUI。
2. 输入 `/`，确认补全菜单出现。
3. 连续按 Down、Down、Up。
4. 每次按键后抓取 PTY 屏幕。
5. 按 Enter 选择命令，再按 Esc 退出 modal 或返回主输入。

通过标准：

- 上下键不会让菜单消失。
- 选中项随按键变化。
- Enter 执行当前选中项，而不是原始未补全字符串。
- Esc 后输入区仍可用。

### G1-04 Slash command modal 链路

逐项验证：

| 命令 | 操作 | 通过标准 |
| --- | --- | --- |
| `/help` | 输入并回车 | 显示命令列表，随后仍可输入。 |
| `/model` | 打开后按 Esc | ModelPicker 可见，Esc 返回主界面。 |
| `/sessions` | 打开后按 Esc | SessionPicker 可见，Esc 返回主界面。 |
| `/agent` | 输入并回车 | 显示或切换 agent，不崩溃。 |
| `/lang` | 切换语言后重新启动 | 语言偏好持久化，TUI 可正常重启。 |
| `/thinking` | 输入合法模式 | 状态栏或反馈显示新模式。 |

### G1-05 TUI 文本流实时显示

前置：

- SSE server 分 3 次返回文本，每次间隔 500ms。

步骤：

1. TUI 输入任意问题。
2. 在 0.6 秒、1.1 秒、1.6 秒分别抓取屏幕。

通过标准：

- 最终响应结束前已经显示部分文本。
- 文本按顺序增长，不重复、不丢片段。
- 完成后 spinner 停止，输入区恢复。

### G1-06 工具 progress 实时显示

前置：

- SSE server 固定返回一个 `bash` tool call。
- 命令每 300ms 输出一行，共运行至少 2 秒。

步骤：

1. 允许 Bash 权限。
2. 在工具运行期间每 400ms 抓取屏幕。
3. 工具结束后继续输入下一条消息。

通过标准：

- 工具结束前已经可观察到运行状态或 progress 更新。
- 高频输出不会刷爆界面。
- 工具完成后状态变为 done。
- 下一条消息可以正常提交。

### G1-07 权限确认 allow、deny、cancel

前置：

- SSE server 固定请求 `bash` exec tool。

分别执行：

| 分支 | 操作 | 通过标准 |
| --- | --- | --- |
| allow once | 选择允许一次 | 工具执行一次，结果写回一次。 |
| always allow | 选择始终允许 | 当前会话后续相同工具不再次询问。 |
| deny | 选择拒绝 | 工具不执行，界面显示拒绝结果。 |
| cancel | 权限框出现时按 Esc 或 Ctrl+C | Promise 被释放，TUI 恢复输入，不挂死。 |

证据：

- 保存工具执行计数和 session JSONL。
- 每个 `tool_call_id` 最多出现一个 tool result。

### G1-08 Session 创建、恢复和切换

步骤：

1. 使用脚本化 SSE server 完成一轮对话。
2. 记录 `.deepicode/sessions/*.jsonl` 中生成的 session ID。
3. 退出 TUI。
4. 使用 `--session <id>` 再次启动。
5. 打开 `/sessions` 并选择已有 session。

通过标准：

- 历史消息可恢复。
- 新消息写入当前 session，而不是旧 session。
- Session 列表 token 统计非错误归零。
- 损坏 JSONL 最后一行后仍可恢复最近有效 messages 快照。

### G1-09 运行时日志开关

在临时 workspace 中分别启动。显式指定日志文件，避免误查 `<HOME>/.deepicode/logs`：

```bash
DEEPICODE_LOG_LEVEL=off \
DEEPICODE_LOG_FILE=<artifacts>/logs/runtime-off.jsonl \
bun run <repo>/packages/cli/src/index.ts

DEEPICODE_LOG_LEVEL=debug \
DEEPICODE_LOG_FILE=<artifacts>/logs/runtime-debug.jsonl \
bun run <repo>/packages/cli/src/index.ts
```

通过标准：

- `off` 时不创建 runtime log。
- `debug` 时生成 JSONL。
- 可按 `submitId → requestId → toolCallId` 关联一次请求。
- 日志不包含 API key、完整敏感文件内容或完整超长 payload。
- `promptTokens`、`completionTokens`、`cacheHitTokens`、`cacheMissTokens` 等非敏感统计字段保留数值，不得被误脱敏。
- CLI 正常退出后日志已经 flush，不依赖测试脚本等待后台定时器碰巧写盘。

步骤：

1. 先运行纯文本请求，检查 `sessionId → submitId → requestId`。
2. 再让脚本化 SSE server 返回一个安全工具调用，检查 `toolCallId` 可关联到对应工具执行事件。
3. API key 使用固定测试值 `test-key-must-not-appear`，结束后对日志执行全文搜索。

证据：

- 保存 `g1-09-off-result.json`、`g1-09-debug-result.json` 和脱敏检查结果。
- 将生成的 JSONL 复制到 `artifacts/logs/`。

### G1-10 MCP 完整 CLI 链路

前置：

- 在临时 workspace 创建 MCP echo fixture 和 `.deepicode/mcp.json`。
- SSE server 固定返回 `ListMcpTools` 或 `CallMcpTool` 调用。

通过标准：

- CLI 后台发现 MCP server。
- 工具调用能穿过 `CLI → Engine → MCP host → MCP child process → tool result`。
- MCP 子进程异常退出时 TUI 显示错误并可继续下一轮输入。
- CLI 退出后 MCP 子进程不残留。

### G1-11 Browser runner smoke

前置：

- 安装 Playwright 和 Chromium。
- 启动本地 HTTP fixture 页面。

步骤：

1. 执行 navigate。
2. 执行 extract。
3. 执行 screenshot。

通过标准：

- runner 脚本可以被真实启动。
- 页面提取结果正确。
- screenshot 文件存在。
- 浏览器子进程退出后不残留。

## 7. G2：故障注入与资源回收

### G2-01 API 流中断后继续输入

前置：

- SSE server 返回部分文本后主动断开连接。

步骤：

1. TUI 发起请求。
2. 等待错误显示。
3. 提交第二条请求，server 对第二条返回正常结果。

通过标准：

- 首次失败不会让 spinner 永久运行。
- 第二条请求正常显示结果。
- runtime log 包含请求失败和下一次成功请求。

### G2-02 Bash timeout 回收完整进程树

前置：

- 使用 fixture 启动父进程，父进程再启动持续运行的子进程，并把 PID 写入文件。

步骤：

1. 通过 `bash` 工具运行 fixture，设置短 timeout。
2. 等待工具返回 timeout。
3. 使用平台对应的进程检查方式验证父 PID 和子 PID。

通过标准：

- 工具返回 timeout，而不是永久挂起。
- 父进程和子进程都不存在。
- TUI 可继续提交消息。

执行要求：

- Linux 自动化阶段至少直接导入并调用项目真实 `createBashTool()` 或 `terminateProcessTree()`。
- 只演示“杀死父进程后子进程仍存活”不能算通过。
- 保存父 PID、子 PID、调用前后存活状态和实际调用的项目函数。
- “TUI 可继续提交消息”留到有 PTY 后补验；进程树回收本身不得因缺少 PTY 而跳过。

### G2-03 Bash interrupt 回收完整进程树

与 `G2-02` 相同，但在 TUI 中主动 Ctrl+C。

通过标准：

- 进程树被回收。
- 权限 Promise 和工具 Promise 都完成 settle。
- Session 中该 tool call 最多写入一个结果。

### G2-04 MCP 子进程退出与重启边界

步骤：

1. MCP fixture 接收请求后退出。
2. 确认当前请求快速失败，不等待完整超时。
3. 退出并重新启动 CLI。
4. 再次执行 MCP 调用。

通过标准：

- 无残留 MCP 子进程。
- 第二次 CLI 启动可重新发现 MCP server。

执行要求：

- 使用测试目录中的最小 MCP fixture，不依赖真实外部 MCP endpoint。
- Linux 自动化阶段必须先完成非 TUI 路径：创建 fixture、连接、让子进程退出、确认 pending request 失败、调用清理、检查残留 PID。
- TUI 错误展示可在有 PTY 后补验；不能因为缺少 PTY 而跳过整个用例。

### G2-05 Session 和 runtime log 磁盘不可写

前置：

- 在隔离目录中将 `.deepicode/sessions` 或 `.deepicode/logs` 设为不可写。
- Windows 使用 ACL 等价方式。
- Runtime log 测试可显式设置 `DEEPICODE_LOG_FILE` 指向不可写目录。

步骤：

1. 发起文本请求。
2. 发起工具请求。
3. 再次提交普通消息。

通过标准：

- 主流程继续运行。
- 不出现未处理异常。
- 开启 debug 时，在仍可写的诊断目标中可观察到 append failure；若整个目录不可写，至少 stderr 不应持续刷屏。

执行要求：

- 必须执行至少一次真实文本请求和一次安全工具请求。
- `--help` 不会写 session 或 runtime log，不能用它代替本用例。
- 以高权限账户运行时，`chmod 444` 可能无法制造失败；必须验证写入确实失败，否则标记 `BLOCKED` 并记录原因。

### G2-06 Ctrl+C 时机矩阵

分别在以下阶段按 Ctrl+C：

| 阶段 | 通过标准 |
| --- | --- |
| 空闲输入 | 不破坏终端；按产品语义退出或清空输入。 |
| SSE 文本流 | 请求中断，输入区恢复。 |
| 权限确认框 | 默认拒绝，Promise 释放。 |
| Bash 执行中 | 工具和子进程树退出。 |
| MCP 调用中 | pending request 释放。 |

## 8. G3：Windows 与 macOS 平台适配验收

本阶段与 `DONE.md` 的 OS-00 至 OS-17 代码实现和 `TODO.md` 的原生平台验收项对应。某项生产代码尚未实现时标记 `NOT_IMPLEMENTED`。

执行边界：

- GitHub Actions Matrix 可执行三平台 `bun run typecheck`、`bun test` 和无交互 smoke，结果必须保存 Actions run URL 或 artifact。
- Matrix 不能替代真实终端中的 PTY/ConPTY、桌面通知观感和剪贴板体验；这些由 `G3-08` 与 `H8` 补验。
- 当前平台代码已经存在。仅因缺少 macOS 或 Windows runner 时应标记 `BLOCKED`，不能标记 `NOT_IMPLEMENTED`。

### G3-01 Shell backend 探测

| 平台 | 预期 |
| --- | --- |
| Linux | 选择 Bash。 |
| macOS | 选择 `/bin/bash` 或显式配置的 POSIX shell。 |
| Windows PS7 | 选择 `pwsh.exe`。 |
| Windows PS5 | 未安装 PS7 时 fallback 到 `powershell.exe`。 |

验证：

- 诊断日志记录平台和 backend。
- Windows 不要求存在 `bash.exe`。
- `DEEPICODE_SHELL` 指向不存在文件时返回结构化错误，不静默切换语义不同的 shell。

### G3-02 Shell 命令、Unicode 和空格路径

在三平台临时 workspace 中执行：

1. 输出 ASCII。
2. 输出中文。
3. 在包含空格和中文的目录中创建文件。
4. 读取环境变量。
5. 执行非零退出命令。

通过标准：

- stdout/stderr 编码正确。
- cwd 正确。
- 非零退出被保留。
- Windows 使用 PowerShell 语法，Linux/macOS 使用 POSIX 语法。

### G3-03 平台危险命令拒绝

只验证拦截，不执行危险操作。

| 平台 | 至少覆盖 |
| --- | --- |
| Linux/macOS | `rm -rf /`、`sudo`、`mkfs`、危险 `dd`。 |
| Windows | 递归删除系统盘、格式化卷、危险磁盘操作、提权启动。 |

通过标准：

- 工具在 spawn 前拒绝。
- 返回可读错误。
- 安全日志不泄漏完整敏感参数。

### G3-04 路径边界

覆盖：

| 平台 | 用例 |
| --- | --- |
| 全平台 | 项目内相对路径、项目内绝对路径、`..` 越界、空格路径、中文路径。 |
| Windows | `C:\...`、反斜杠、不同盘符、UNC path `\\server\share`。 |
| macOS/Linux | symlink 指向项目外部。 |

工具范围：

- `glob`
- `read_file`
- `write_file`
- `edit`
- `NotebookEdit`
- Browser runner 本地脚本路径

通过标准：

- 项目内路径正常工作。
- 越界路径按工具安全策略拒绝。
- Browser runner 使用真实本地路径启动，不受 URL pathname 影响。

### G3-05 Monitor backend

三平台分别执行：

```text
Monitor(memory)
Monitor(file)
Monitor(process)
Monitor(disk)
```

通过标准：

- 返回结构化字段，不是不可解析的原始平台文本。
- macOS 不依赖 GNU `ps --sort` 或 Linux `free -h`。
- Windows 不依赖 Unix 命令。
- 单次采样失败返回 `error` 和 backend，不让工具整体崩溃。

### G3-06 Scheduler backend

安全限制：

- 仅在 disposable runner、容器或专用测试账户执行 create/delete。
- 创建后无论测试结果如何都必须进入 finally cleanup。

平台预期：

| 平台 | backend | 验收 |
| --- | --- | --- |
| Linux | `crontab` | list/create/delete 唯一前缀任务。 |
| macOS | `crontab` 第一阶段 | list/create/delete；launchd 不在第一批强制范围。 |
| Windows | `schtasks.exe` | list/create/delete 可映射 schedule；不可映射表达式明确拒绝。 |

通过标准：

- 不删除非 Deepicode 测试任务。
- 返回值包含 backend。
- 测试退出后没有残留任务。

### G3-07 Notification backend

三平台执行一条专用测试通知。

通过标准：

| 平台 | 预期 |
| --- | --- |
| Linux | `notify-send` 可用时发送，否则 terminal bell fallback。 |
| macOS | `osascript` 发送，否则 fallback。 |
| Windows | PowerShell 通知路径或 terminal bell fallback。 |

返回结果必须包含：

```text
sent
method
fallbackReason（发生降级时）
```

### G3-08 TUI 原生终端自动化 smoke

分别在 Linux terminal、macOS Terminal/iTerm2、Windows Terminal 中执行：

1. 启动。
2. Slash 菜单上下键。
3. `/model` 打开和退出。
4. 剪贴板读取尝试。
5. Ctrl+C。
6. `/exit`。

通过标准：

- 无乱码。
- 箭头键、Enter、Esc、Ctrl+C 正常。
- 退出后终端恢复。
- Windows 剪贴板支持或明确降级，不崩溃。

## 9. G4：性能与稳定性

### G4-01 Bash 大输出内存边界

前置：

- 运行持续产生至少 50 MiB 输出的命令。
- `max_chars` 设置为较小值，例如 200000。
- 采集 CLI 进程 RSS 峰值。

通过标准：

- 返回输出被截断并带 dropped/truncated 提示。
- RSS 不随总输出量线性增长。
- TUI 仍能响应 Ctrl+C。

执行要求：

- 自动化阶段必须通过项目真实 `bash` 工具执行大输出命令，不能只运行裸 `/bin/bash`。
- 记录工具返回长度、截断标记、累计输出量和 CLI 或测试进程 RSS 峰值。
- Ctrl+C 响应可在有 PTY 后补验；有界输出与 RSS 检查不得因缺少 PTY 而跳过。

### G4-02 长会话 TUI 响应

前置：

- 使用脚本化 SSE server 连续生成至少 500 个 timeline item。

步骤：

1. 渲染长会话。
2. 打开 slash 菜单。
3. 上下移动选择项。
4. 打开 `/sessions`。

通过标准：

- 无明显输入丢失。
- 菜单交互仍可用。
- 记录渲染和按键响应时间。
- 若响应超过 200ms，标记性能问题并保存 profile。

### G4-03 30 分钟 soak

自动循环：

```text
文本流请求
工具调用
中断长工具
恢复 session
MCP echo 调用
```

通过标准：

- 无未处理异常。
- 无持续增长的子进程数量。
- RSS 不持续单调增长。
- `.deepicode/logs` 和 `.deepicode/results` 符合配额和清理策略。

## 10. G5：可选真实服务 Smoke

本阶段默认关闭。仅在专用测试账户和专用密钥存在时执行，不使用个人密钥。

### G5-01 真实 Provider 文本流

执行：

- 对每个正式支持 Provider 发送一个低成本简单请求。

通过标准：

- 收到流式文本。
- usage 可解析。
- 日志不包含密钥。

### G5-02 真实 Provider 工具调用

执行：

- 使用明确要求读取临时 workspace 文件的提示。

通过标准：

- 模型生成工具调用。
- 工具结果回传。
- 模型完成最终回复。
- 临时 workspace 外部文件不被读取。

### G5-03 真实 MCP server

选择一个受控 MCP server，验证：

- 发现工具；
- 调用工具；
- MCP stderr 有界记录；
- CLI 退出后进程回收。

## 11. H 轨：项目负责人人工体验验收

本轨由项目负责人执行，不交给 Agent 代签。Agent 可以准备测试环境、脚本化 SSE server 和操作说明，但最终结果必须由人在真实终端中确认。

执行原则：

- 每个目标发布平台至少完成一次：Linux、macOS、Windows 分别记录，不互相替代。
- 使用隔离临时 workspace 和测试凭证。
- 人工验收不执行危险命令，不在日常账户中创建 Scheduler 任务。
- 结果记录为 `PASS`、`FAIL` 或 `BLOCKED`，并保存截图、录屏或简短文字说明。
- 发现问题时记录平台、终端、按键顺序、屏幕表现和是否可稳定复现。

### H1 启动、首屏和退出

操作：

1. 在原生终端启动 `deepicode chat`。
2. 观察首屏布局、提示文本和输入框。
3. 输入 `/exit` 正常退出。
4. 再次启动，使用 Ctrl+C 退出。

人工确认：

- 首屏没有乱码、重叠、闪烁或明显布局跳动。
- 输入框焦点正确，不需要额外按键才能输入。
- 退出后 shell 提示符、光标和回显恢复正常。

### H2 文本流显示体验

前置：使用脚本化 SSE server 返回持续 5 - 10 秒的分片文本，再用专用真实服务密钥抽查一次。

人工确认：

- 文本逐步出现，不是长时间沉默后整段刷出。
- 输出过程中输入区仍可辨认，没有严重闪屏。
- Markdown、中文、英文、代码块和长行显示可读。
- 请求结束后的状态清晰，不会一直显示忙碌。

### H3 Slash 菜单和弹窗手感

操作：

1. 输入 `/`。
2. 连续按上下键移动选项。
3. 按 Enter 选择命令。
4. 分别打开 `/help`、`/model`、`/sessions`。
5. 使用 Esc 关闭弹窗，再次输入普通消息。

人工确认：

- 上下键不会导致菜单消失。
- 高亮项和实际执行项一致。
- Enter、Esc、返回输入框的焦点行为符合预期。
- 弹窗没有遮挡、溢出或无法关闭的问题。

### H4 工具进度和权限确认

前置：触发一个持续数秒的只读工具，再触发需要权限确认的写入工具。

人工确认：

- 工具执行期间持续有可理解的状态反馈，不出现无解释的卡住感。
- 工具名、阶段和完成结果可辨认。
- `allow once`、`always allow`、`deny`、取消确认的按键和反馈明确。
- 拒绝后不会偷偷执行工具，也不会让对话卡死。

### H5 Session 恢复和切换体验

操作：

1. 创建包含多轮对话和工具调用的 session。
2. 退出并重新启动。
3. 使用 `/sessions` 切换到旧 session。
4. 继续输入一条消息。

人工确认：

- 历史消息顺序正确，工具结果没有错位。
- 当前 session 有明确标识。
- 切换和恢复耗时可接受。
- 恢复后可以继续对话，不需要重启。

### H6 中断行为

分别在以下时机按 Ctrl+C：

| 时机 | 人工确认 |
| --- | --- |
| 空闲输入 | 行为明确：清空输入或退出，与界面提示一致。 |
| 文本流输出中 | 请求停止，界面恢复可输入。 |
| 工具执行中 | 工具停止或显示正在停止，最终恢复可输入。 |
| 权限弹窗中 | 弹窗关闭或请求取消，不残留不可操作状态。 |

退出后再检查终端没有残留输出持续刷屏。

### H7 日志诊断可读性

分别在日志关闭和开启状态运行一次文本请求、一次工具调用和一次中断。

人工确认：

- 日志关闭时不会污染终端，也没有明显性能影响。
- 日志开启后能按时间顺序理解一次请求的主要过程。
- 能找到请求、工具执行、session 和错误之间的关联标识。
- 日志不会写出 API key、authorization header 或敏感文件全文。

### H8 平台原生体验

在目标平台补充确认：

| 平台 | 人工确认 |
| --- | --- |
| Linux | 常用终端中布局正常；通知可用或 fallback 明确。 |
| macOS | Terminal 或 iTerm2 中布局正常；`osascript` 通知行为可接受。 |
| Windows | Windows Terminal 中布局正常；PowerShell 路径、中文目录、剪贴板和通知可用或明确降级。 |

人工验收完成后创建：

```text
MANUAL-ACCEPTANCE-REPORT-<platform>-<date>.md
```

最小模板：

```markdown
# Deepicode Manual Acceptance Report

- Commit:
- Platform:
- OS version:
- Terminal:
- Tester:
- Date:

| ID | Status | Evidence | Notes |
| --- | --- | --- | --- |
| H1 | | | |

## Blocking Issues
- None

## Sign-off
- Release accepted: yes / no
```

## 12. 发布判定

### 12.1 必须满足

- `G0` 全部 `PASS`。
- `G1` 全部 `PASS`。
- `G2` 全部 `PASS`。
- 目标发布平台对应的 `G3` 全部 `PASS`。
- `G4-01`、`G4-02`、`G4-03` 全部 `PASS`。
- 目标发布平台对应的 `H1` - `H8` 由项目负责人确认并签字。
- 不存在未说明的残留进程、残留 Scheduler 任务或敏感日志泄漏。

### 12.2 可以接受的阻断

- 没有 Playwright 时，`G1-11` 可标记 `BLOCKED`，但发布说明必须明确 WebBrowser 不可用。
- 没有桌面通知服务时，`G3-07` 可以通过 terminal bell fallback 判定为 `PASS`。
- 没有专用真实服务密钥时，`G5` 可以标记 `BLOCKED`，不阻止本地发布。

### 12.3 不允许伪装通过

- Windows 没有实现 PowerShell backend 时，必须标记 `NOT_IMPLEMENTED`。
- 无法运行 PTY/ConPTY 时，TUI 用例必须标记 `BLOCKED`。
- Scheduler 没有隔离测试账户时，不得在用户机器上创建任务。
- 只跑 mock 单元测试不能替代系统验收。
- 只运行裸系统命令不能替代对 Deepicode 工具实现的验收。
- 测试脚本主动 kill 挂起进程后，不得把对应 CLI 退出行为标记为 `PASS`。
- 报告引用但 `artifacts/` 中不存在的证据，视为没有执行。
- GitHub Actions Matrix 通过不能替代 `H` 轨人工原生终端验收。

## 13. Agent 测试报告模板

测试 Agent 完成后创建：

```text
SYSTEM-ACCEPTANCE-REPORT-<platform>-<date>.md
```

模板：

```markdown
# Deepicode System Acceptance Report

## Environment
- Commit:
- Dirty worktree:
- Platform:
- OS version:
- Bun:
- Node:
- Terminal:
- Shell backend:
- Test workspace:

## Summary
| Status | Count |
| --- | --- |
| PASS | |
| FAIL | |
| BLOCKED | |
| NOT_IMPLEMENTED | |
| NOT_RUN | |

## Cases
| ID | Status | Duration | Evidence | Blocker | Notes |
| --- | --- | --- | --- | --- | --- |
| G0-01 | | | | | |

## Bugs
| Severity | Case | Symptom | Reproduction | Artifact |
| --- | --- | --- | --- | --- |

## Test Stability Observations
| Test | Full-suite Runs | Isolated Run | Classification | Artifact |
| --- | --- | --- | --- | --- |

## Residual Processes And Tasks
- Child processes:
- Scheduler entries:
- Temp files:
- Runtime logs:

## Evidence Audit
- Referenced evidence files checked:
- Missing evidence files:
- Runtime log path:
- GitHub Actions run URL:

## Conclusion
- Release decision:
- Blocking items:
```

## 14. Bug 严重级别

| 级别 | 定义 | 示例 |
| --- | --- | --- |
| `P0` | 数据损坏、安全越界、系统无法退出、残留危险任务 | 越界读取凭证；Ctrl+C 后危险子进程继续运行。 |
| `P1` | 核心流程不可用或跨平台主路径失败 | Windows 无法启动 shell；TUI slash 菜单无法操作。 |
| `P2` | 有 fallback，但体验或诊断明显受损 | 桌面通知只能 fallback；日志缺少关联字段。 |
| `P3` | 低风险维护问题 | 错误文案不清晰；次要性能波动。 |

## 15. 下一位测试 Agent 的执行指令

将以下指令原样交给负责补验收的 Agent：

```text
读取 TEST.md、TODO.md、DONE.md。ADVICE.md 仅为归档入口，不再提供任务。
你只负责测试、fixture、证据和报告，不修改生产代码。

先检查 BUG-01 是否已经由开发 Agent 修复。若未修复：
- 重现并记录 G1-01 FAIL；
- 将 G1-09、G2-05、G4-01 标记 BLOCKED_BY_BUG-01；
- 继续执行不依赖 CLI 正常退出的测试，不要整体停止。

若 BUG-01 已修复：
1. 执行 G0-01：typecheck 一次，bun test 连续三次，分别保存完整输出。
2. 复测 G1-01，确认 pipe mode 自然退出且无残留 worker 或子进程。
3. 执行 G1-09：显式设置 DEEPICODE_LOG_FILE，验证 off/debug、JSONL、脱敏、统计字段和 submitId → requestId → toolCallId。
4. 执行 G2-02、G2-04、G2-05。必须调用项目真实实现并保存证据，不能用裸系统命令或 --help 代替。
5. 执行 G4-01：通过 Deepicode bash 工具生成至少 50 MiB 输出，验证截断与 RSS。
6. 有 PTY 后执行剩余 Linux TUI 用例；有 macOS/Windows runner 后执行 G3。

所有 PASS 项必须在 artifacts/ 中保存 command、stdout、stderr 和 result.json。
报告引用但不存在的证据视为 NOT_RUN。
不要把失败直接降级成“已知问题”；疑似抖动必须保留失败输出并单独复现。
```

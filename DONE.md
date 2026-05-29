# Deepicode 完成记录

本文按 `Deepicode实施计划.md` 的 Phase / Step 记录已完成内容。状态含义：

- `完成`：代码已落地并通过基础验证。
- `最小完成`：具备可用闭环，但未达到实施计划中的完整版要求。
- `部分完成`：只完成子集能力，仍需后续补齐。

最后更新：2026-05-28

## Phase 0：脚手架搭建

### Step 0.1 项目初始化

状态：完成

- 初始化 `/vol4/Agent/deepicode` Git 仓库。
- 创建根 `package.json`、`tsconfig.json`、`vitest.config.ts`。
- 使用 Bun 作为运行时。

### Step 0.2 Monorepo 结构

状态：完成

- 创建 `packages/{core,cli,shell,tui,tools,security}`。
- 根脚本：
  - `bun run dev`
  - `bun run typecheck`
  - `bun test`
- 根 `package.json` 已声明 `workspaces: ["packages/*"]`。

### Step 0.3 核心代码迁移

状态：完成

- 核心上下文模块位于 `packages/core/src/context/`：
  - `immutable.ts`
  - `append-log.ts`
  - `scratch.ts`
  - `manager.ts`
  - `message.ts`
- 共享类型位于 `packages/core/src/types.ts`。
- 配置读取位于 `packages/core/src/config.ts`。

### Step 0.4 最小可运行集成

状态：完成

- CLI 入口位于 `packages/cli/src/index.ts`，加载 `packages/cli/src/tui.ts`。
- 当前 CLI 为 readline 交互，不再直连 oh-my-pi TUI 源码。
- 支持：
  - 交互模式：`bun run dev`
  - 单轮输入：`printf '你好\n' | bun run dev`
  - 帮助信息：`bun run dev --help`

### Phase 0 验收状态

| 检查项 | 状态 | 说明 |
| --- | --- | --- |
| 项目可正常启动 | 完成 | `bun run dev --help` 可退出 |
| 一轮简单对话可完成 | 完成 | 已用 CLI 单轮验证 |
| 一次工具调用可完成 | 完成 | `read_file` / `bash` / `edit` 已接入 CLI |
| CoreEngine 接口定义完整 | 部分完成 | 基础接口完成，策略/权限决策仍为空实现 |
| LoopEvent 覆盖计划 role | 部分完成 | 当前未实现 `token_estimate` / `assistant_final` |
| TypeScript 编译零错误 | 完成 | `bun run typecheck` 通过 |

## Phase 1：核心引擎改造

### Step 1.1 DeepSeekClient 实现

状态：最小完成

- 新增 `packages/core/src/client.ts`。
- 直连 DeepSeek 官方 OpenAI-compatible `POST /chat/completions`。
- 支持 SSE streaming。
- 已解析：
  - `content`
  - `reasoning_content`
  - `tool_calls`
  - `usage`
  - `[DONE]`
  - HTTP / API 错误
- 默认 API 配置：
  - `DEEPSEEK_BASE_URL=https://api.deepseek.com`
  - `DEEPSEEK_MODEL=deepseek-v4-flash`
- `packages/core/src/config.ts` 支持从环境变量或项目根 `api-key` 文件读取 `DEEPSEEK_API_KEY`。

未达到计划完整版的部分：

- 尚未实现 429/5xx 指数退避重试。
- `reasoning_content` 目前主要作为流式事件输出，尚未作为正式历史字段 round-trip。

### Step 1.2 SegmentedLog 与 Session 持久化

状态：最小完成

- 新增 `packages/core/src/session.ts`。
- 实现：
  - `SegmentedLog` 最小结构：`archive + active`
  - `AsyncSessionWriter`
- session JSONL 写入路径：
  - `.deepicode/sessions/<sessionId>.jsonl`
- 引擎会 best-effort 写入：
  - event
  - messages
  - stats

未达到计划完整版的部分：

- `SegmentedLog` 尚未接入主上下文替代 `AppendOnlyLog`。
- 尚未实现 JSONL 恢复加载。
- 尚未实现原子写入、rewrite、archive、compact 恢复。

### Step 1.3 ContextManager

状态：部分完成

- 已实现三区域组装：
  - `ImmutablePrefix`
  - `AppendOnlyLog`
  - `VolatileScratch`
- `ImmutablePrefix.cacheKey` 使用 SHA-256 稳定 hash。
- `AppendOnlyLog` / `VolatileScratch` / `ImmutablePrefix` 对外返回防御性拷贝，避免外部引用污染内部状态。

未完成：

- 增量 token 统计旁路。
- 65% / 75% / 80% fold 决策。
- turn-start 估算。
- cache miss 阵痛管理事件。

### Step 1.4 Tokenizer Worker Pool

状态：未开始

- 尚未实现 `tokenizer-pool.ts`。
- 尚未实现 worker 线程入口。
- 尚未实现 Map-based O(1) 任务回收。

### Step 1.5 StreamingToolExecutor

状态：最小完成

- 新增 `packages/core/src/streaming-executor.ts`。
- 支持：
  - `shared` 工具并行执行。
  - `exclusive` 工具串行执行。
  - `tool_start` 事件。
  - `tool` / `error` 结果事件。
  - 工具结果写回上下文。
  - 工具返回内容保持为字符串。

当前实现策略：

- 稳定优先：在模型 tool call 完整结束后执行工具。
- 尚未做真正 eager dispatch。

未达到计划完整版的部分：

- 尚未实现 AST parser 防 JSON 假闭合。
- 尚未实现边流式参数边提前执行。
- shared 工具结果当前按完成顺序回传，后续如需协议确定性，应改为并发执行、按模型声明顺序提交。

### Step 1.6 Tool-call Repair 流水线

状态：未开始

- 尚未实现 `repair.ts`。
- 尚未实现 Scavenge / Truncation / Storm。
- 尚未实现 repeat-loop guard。

### Step 1.7 CacheFirstLoop 完整实现

状态：部分完成

- `packages/core/src/engine.ts` 已作为当前主 loop。
- 已从 oh-my-pi `streamSimple` 切换为自研 `DeepSeekClient` 驱动。
- 支持：
  - 多轮 tool call 循环。
  - `AbortController` 中断请求和工具。
  - token/cache usage 累加。
  - session best-effort 写入。

未完成：

- 尚未拆出计划中的 `loop.ts`。
- 尚未实现 `assistant_final` 协议边界事件。
- 尚未实现 reasoning_content 正式历史 round-trip。
- 尚未实现预算、fold、repair、force summary。

### Phase 1 当前验证状态

| 检查项 | 状态 | 说明 |
| --- | --- | --- |
| DeepSeekClient SSE 解析 | 最小完成 | content/reasoning/tool/usage 可解析 |
| reasoning 分离 | 部分完成 | 流式事件已分离，历史 round-trip 未完成 |
| SegmentedLog / JSONL | 最小完成 | 仅 best-effort 追加写 |
| 阈值旁路 | 未完成 | 无 token 估算模块 |
| Tokenizer Map 回收 | 未完成 | 未实现 tokenizer pool |
| AST 防假闭合 | 未完成 | 当前非 eager dispatch |
| Cache miss 阵痛事件 | 未完成 | 无 fold 决策 |
| 核心测试 | 部分完成 | 现有 16 pass / 3 skip |

## Phase 2：智能推理强度调节系统

状态：未开始

- 尚未实现 strategy 目录。
- 尚未实现 tier config、task classifier、chain estimator、strategy selector。
- `LoopEvent` 中已预留 `strategy_notify` / `strategy_estimate_refined`，但未实际产出。

## Phase 3：壳层增强

状态：未开始

- `packages/shell/src/index.ts` 仍是 placeholder。
- 尚未实现状态管理、EventStream/EventBus、多 Agent 系统。

## Phase 4：工具层实现

### Step 4.1 ToolRegistry

状态：最小完成

- 新增 `packages/tools/src/registry.ts`。
- 支持：
  - register
  - get
  - list
  - toToolSpecs

未完成：

- Agent 过滤。
- Deny rules 过滤。
- 与 security 层联动。

### Step 4.2 Hash-Anchored Edit

状态：最小完成

- 新增 `packages/tools/src/hash-edit.ts`。
- 使用 `createReadStream` / `createWriteStream` 实现流式替换。
- 当前功能是 exact old_string replace once，hash 仅用于辅助校验。

未达到计划完整版的部分：

- 尚未实现 oldHash 入参校验。
- 尚未实现多编辑操作。
- 尚未实现完整 hash-anchor 协议。

### Step 4.3 9-Pass Fuzzy Edit

状态：部分完成

- 新增 `packages/tools/src/fuzzy-edit.ts`。
- 当前支持：
  - exact
  - trimRightLines
  - normalizeWhitespace
  - normalizeIndent

未完成：

- 尚未实现完整 9-pass。
- fuzzy 匹配回写映射仍是简化版。

### Step 4.4 Stale-read Validation

状态：未开始

- 尚未实现 `stale-read.ts`。

### Step 4.5 基础工具集

状态：部分完成

- 新增：
  - `packages/tools/src/file-ops.ts`
  - `packages/tools/src/shell-exec.ts`
  - `packages/tools/src/edit.ts`
- 已实现并在 CLI 注册：
  - `read_file`
  - `bash`
  - `edit`
- CLI 已修复工具结果展示：tool call 后会显示 bash stdout/stderr、read_file 内容、edit 结果。

未完成：

- `write_file`
- `ls`
- `search.ts` grep/glob
- `web-fetch.ts`

## Phase 5：安全层实现

状态：未开始

- `packages/security/src/index.ts` 仍是 placeholder。
- 尚未实现 deny-first permission、hooks、git snapshot。

## Phase 6：高级功能生态接入

状态：未开始

- 尚未实现 TTSR、LSP、MCP、Python Kernel、Universal Config Discovery。

## Phase 7：集成测试与调优

状态：未开始

- 尚未实现 E2E 测试矩阵。
- 尚未实现性能基准、计费校准、长会话压测、发版文档。

## 当前测试结果

最近一次验证：

```bash
bun run typecheck
bun test
```

结果：

- `bun run typecheck`：通过。
- `bun test`：16 pass / 3 skip / 0 fail。

测试文件：

- `packages/core/__tests__/context.test.ts`
- `packages/core/__tests__/engine-tools.test.ts`
- `packages/core/__tests__/integration.test.ts`（默认 skip）

## 关键设计决策

| 决策 | 当前选择 | 说明 |
| --- | --- | --- |
| 运行时 | Bun | Deepicode 当前以 Bun 脚本运行 |
| API 提供商 | DeepSeek 官方 | 默认 `https://api.deepseek.com` |
| 模型 | `deepseek-v4-flash` | 可用 `DEEPSEEK_MODEL` 覆盖 |
| API key | env 优先，其次 `api-key` 文件 | `api-key` 已加入 `.gitignore` |
| 核心事件 | `AsyncGenerator<LoopEvent>` | CLI 逐事件消费 |
| 工具执行 | shared 并行 / exclusive 串行 | 当前为稳定优先最小版本 |
| 会话持久化 | JSONL best-effort append | 写入 `.deepicode/sessions/`，不阻塞主流程 |
| 当前 CLI | readline | 暂未接入真正 TUI 组件 |

## 已知限制

- `assistant_final` 尚未实现，后续事件/reducer/TUI 接入前应补齐。
- `reasoning_content` 尚未作为历史字段 round-trip。
- prefix fingerprint 尚未覆盖 toolSpecs / fewShots。
- 无权限层，`bash` / `edit` 当前没有用户确认与风险拦截。
- `read_file` 目前没有路径沙箱、文件大小 outline mode、stale-read tracking。
- `edit` 工具仍是最小版本，不具备完整 9-pass 和 stale-read validation。
- `session.ts` 尚不能恢复历史。

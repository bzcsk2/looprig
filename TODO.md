# Deepicode TODO

  主要问题

  1. 工具参数缺少运行时校验，可能执行错误命令
      - deepicode/packages/tools/src/shell-exec.ts:21 直接 String(args.command)，如果
        模型漏传 command，会执行字符串 "undefined"。
      - deepicode/packages/tools/src/file-ops.ts:118 和 deepicode/packages/tools/src/
        edit.ts:293 也有同类问题。
      - 建议：每个工具入口先校验必填字段类型，不合格直接返回 { isError: true }。
  2. 安全边界还没有落地
      - deepicode/packages/tools/src/shell-exec.ts:41 直接 bash -lc，没有 denylist、确
        认、沙箱、cwd 限制。
      - deepicode/packages/tools/src/file-ops.ts:120 可读任意路径。
      - deepicode/packages/tools/src/edit.ts:297 可写任意路径。
  4. shared 工具结果顺序不稳定
      - deepicode/packages/core/src/streaming-executor.ts:31 用 Promise.race 按完成顺
        序 yield 并写入 log。
      - 如果模型发出 [toolA, toolB]，但 B 先完成，历史里的 tool result 可能先写 B。
      - 协议上更稳的是：并发执行，但按模型声明顺序提交到上下文。
  5. toolCallIndex 映射可能丢失
      - deepicode/packages/core/src/engine.ts:133 收到 tool_call_end 后只 push(tc)，没
        有保留 event.toolCallIndex。
      - 后面 executor 用数组下标重新编号：deepicode/packages/core/src/streaming-
        executor.ts:41。
      - 如果上游 index 不连续或到达顺序变化，事件 index 会错。
  6. Session writer 是 best-effort，但错误会变成隐性风险
      - deepicode/packages/core/src/engine.ts:37 writer.init() 没 await，随后可能立刻
        enqueue。
      - deepicode/packages/core/src/session.ts:39 void this.flushSoon() 没 catch，
        appendFile 失败可能产生未处理 rejection。
      - 建议：enqueue 内部吞掉写入错误或暴露诊断事件。
        packages/tools/src/hash-edit.ts:184 比较的是 sha256(oldString) ===
        needleHash，恒真。
      - 当前实际是“流式 exact replace once”，不是 hash-anchored edit。
      - 文档里标“最小完成”是对的，代码命名后续要么补真 hash anchor，要么改名避免误导。

  我建议优先修：参数校验、abort catch、工具结果按声明顺序提交、最小安全 denylist。然后
  再做 assistant_final / reasoning_content。


本文记录下一阶段任务。优先级从高到低排列，建议每个任务完成后同步更新 `DONE.md`。

## P0：修正核心协议边界

### 1. 增加 `assistant_final` 事件

目标：

- 在每次模型响应完成后，先产出完整 assistant 消息边界，再进入工具执行或 `done`。
- 让 UI、session writer、未来 reducer 能区分“流式增量”和“完整 assistant turn”。

验收：

- `LoopEventRole` 增加 `assistant_final`。
- `ReasonixEngine.submit()` 在模型 stop/tool_calls 前均产出 `assistant_final`。
- 单测覆盖：
  - 普通回复：`assistant_delta* -> assistant_final -> done`
  - 工具回复：`assistant_delta/tool_call_delta* -> assistant_final -> tool_start -> tool -> ...`

### 2. 引入 `reasoning_content` 历史字段

目标：

- 分离 assistant content 与 reasoning。
- 为 DeepSeek thinking mode 后续 round-trip 做准备。

验收：

- `ChatMessage` 增加 `reasoning_content?: string | null`。
- assistant 历史消息写入时保留 `reasoning_content`，不再把 `fullReasoning` 回退塞进 `content`。
- `DeepSeekClient` 发送 assistant message 时包含 `reasoning_content`。
- 单测覆盖 thinking delta 后的历史消息。

### 3. 工具结果提交顺序确定化

目标：

- shared 工具仍可并行执行。
- tool result 写入上下文和核心 `tool` 事件按模型声明的 `tool_calls` 顺序提交。
- 如需更丝滑 UI，另增 `status` 或未来 `tool_progress` 表示某工具已先完成。

验收：

- 多 shared 工具并发执行时，即使后一个先完成，`ctx.log` 中 tool messages 仍按 index 顺序。
- `engine-tools.test.ts` 增加“慢前快后”的顺序测试。

## P1：补齐工具安全底线

### 4. 为 `bash` 增加最小权限确认接口

目标：

- 在 security 层未完成前，避免危险命令静默执行。

建议：

- 先实现保守 denylist：
  - `rm -rf /`
  - `sudo`
  - `mkfs`
  - `dd if=`
  - `chmod -R 777 /`
- 对 mutating / network / install 类命令返回 `isError: true` 或进入待确认状态。

验收：

- 危险命令不会执行。
- read-only 命令如 `pwd`、`ls`、`cat package.json` 可执行。

### 5. 为 `read_file` 增加路径与大文件保护

目标：

- 防止意外读取敏感文件或巨大文件拖慢上下文。

建议：

- 默认相对路径基于 `ctx.cwd` resolve。
- 拒绝读取 `api-key`、`.env`、私钥文件。
- 超过阈值文件返回 outline / 截断提示。

验收：

- 读取 `api-key` 返回错误。
- 读取不存在文件返回结构化错误。
- 大文件不会完整塞进上下文。

### 6. 完成 Stale-read Validation 最小版

目标：

- 写入前确保文件内容没有被外部修改。

验收：

- `read_file` 记录 path + mtime + hash。
- `edit` 前校验记录。
- stale 时返回错误并提示先重新 read。

## P1：补齐编辑工具

### 7. 完整化 Hash-Anchored Edit

目标：

- 让 edit 从“exact replace once”升级为可验证锚点编辑。

验收：

- 支持 oldHash 或上下文 hash。
- hash 不匹配时不写文件。
- 写入使用临时文件 + rename。
- 单测覆盖 hash match / mismatch / 多行替换。

### 8. 完整化 9-Pass Fuzzy Edit

目标：

- 实现实施计划中的 9-pass fallback。

验收：

- 至少覆盖：
  - exact
  - lineTrimmed
  - blockAnchor
  - whitespaceNormalized
  - indentationFlexible
  - escapeNormalized
  - trimmedBoundary
  - contextAware
  - multiOccurrence
- 所有 pass 有独立单测。

## P2：Context 与 Session

### 9. prefix fingerprint 覆盖真实请求前缀

目标：

- cacheKey 反映真实影响 prefix-cache 的内容。

验收：

- `ImmutablePrefix` 覆盖：
  - system
  - toolSpecs
  - fewShots
- 工具 schema 变化会改变 fingerprint。
- 单测覆盖 system/tool/fewShot 三类变化。

### 10. 接入 token 估算与 fold 决策

目标：

- 为长会话做上下文预算保护。

验收：

- `ContextManager` 提供估算接口。
- 实现 75% fold 建议、80% force summary 的最小决策。
- 暂时可用近似 token 估算，后续再替换 tokenizer worker。

### 11. 完成 session 恢复

目标：

- JSONL 不只写入，也能恢复。

验收：

- 支持从 `.deepicode/sessions/<sessionId>.jsonl` 加载 messages。
- 启动参数或 API 支持指定 sessionId。
- 恢复后可继续对话。

## P2：DeepSeekClient 稳定性

### 12. 增加 API 重试与错误分类

目标：

- 提高网络和服务端波动下的稳定性。

验收：

- 429 / 500 / 502 / 503 使用指数退避重试。
- 400 / 401 不重试，直接返回结构化错误。
- 单测 mock fetch 覆盖 retry / no-retry。

### 13. 补齐 SSE 边界测试

目标：

- 保证 streaming parser 在真实网络 chunk 边界下可靠。

验收：

- chunk 被任意切分仍可解析。
- 最后一个 chunk 不完整时不崩溃。
- `[DONE]` 后正确结束。

## P3：Shell / TUI / Agent 外壳

### 14. 建立 shell 状态层

目标：

- 从 CLI 直接消费 core events，升级为 shell state projection。

验收：

- `packages/shell/src/state.ts` 实现不可变状态更新。
- 支持 messages、tool status、stats、errors。

### 15. 重新评估 TUI 接入

目标：

- 当前 CLI 是 readline；后续需要真正 TUI 时再引入 UI 框架。

建议：

- 不再跨仓库源码直引 oh-my-pi。
- 若使用 oh-my-pi，先做 workspace/package 级依赖或复制必要组件。

验收：

- `bun run typecheck` 不依赖 `/vol4/Agent/oh-my-pi` 源码。
- UI 能显示 assistant stream、tool progress、tool result、stats。

## P4：测试与文档

### 16. README 重建

目标：

- 当前仓库没有 README，需恢复面向开发者的入口文档。

验收：

- 包含安装、配置、运行、测试、工具说明、限制。

### 17. 增加 E2E 场景

目标：

- 覆盖最关键 agent 工作流。

建议场景：

- bash 执行 `pwd` 并返回结果。
- read_file 读取 `package.json`。
- edit 修改临时文件并验证内容。
- 工具错误后模型继续回复。
- 中断正在执行的 bash。

验收：

- 每个场景可自动化运行。
- CI 或本地 `bun test` 可执行，不依赖真实 DeepSeek API。

## 暂缓任务

以下任务价值高，但当前不建议立即做：

- 完整 Repair Pipeline。
- Tokenizer Worker Pool。
- StrategySelector 和 CNY 成本卡片。
- MCP / LSP / Python Kernel。
- Git Snapshot 回滚。
- 多 Agent Plan / Build 模式。

原因：这些任务会显著扩大实现面。建议先把核心协议、工具安全、session 恢复和测试闭环稳定后再推进。

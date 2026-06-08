# AgentMemory 完整并入 Deepreef 实施方案

## 1. 目标与结论

目标是把 `/vol4/Agent/agentmemory` 的完整记忆能力作为 Deepreef 原生功能并入 `/vol4/Agent/deepreef`，最终用户只需启动 `deepreef`，不需要另外安装、启动或连接 `agentmemory` 与 `iii-engine`。

推荐方案：

- 新建工作区包 `packages/memory`，承载从 AgentMemory 复制过来的源码。
- 保留 AgentMemory 已验证的业务实现，不重写 64 个 `src/functions/*` 功能模块。
- 在 `packages/memory/src/runtime` 实现一个进程内 `iii-sdk` 兼容层，替代外部 iii-engine。
- 将 Deepreef 的会话、提示词、工具调用、压缩、子 Agent 和退出生命周期直接接入记忆运行时。
- 将 AgentMemory 的 MCP、REST、Viewer、技能和显式记忆工具作为 Deepreef 的可选原生界面保留。

不推荐把 AgentMemory 继续当作独立 MCP/REST 服务接入。该方式适合快速试用，但会保留双进程、四端口、独立配置、独立生命周期和 iii-engine 原生二进制依赖，不能称为“整个加入 Deepreef”。

## 2. 已确认的源码事实

AgentMemory 当前包含：

- 176 个 `src` 源文件、64 个记忆功能模块、133 个测试文件。
- 会话观察、长期记忆、混合搜索、向量检索、图谱、时间线、工作记忆、压缩、反思、结晶、经验、隐私、治理、审计、快照、导入导出、团队和多 Agent 能力。
- 53 个左右的 MCP 工具，以及 REST API、实时 Viewer、CLI、Hooks、技能和多种外部 Agent 连接器。
- Apache-2.0 许可证，允许复制和修改，但必须保留许可证、版权和归属，并在修改文件中标明变更。

关键技术约束：

- AgentMemory 业务模块广泛依赖 `ISdk.registerFunction()`、`ISdk.trigger()`、`ISdk.registerTrigger()` 和 `StateKV`。
- 当前运行依赖 `iii-sdk@0.11.2` 和独立 iii-engine，iii-engine 提供 KV、HTTP、事件、流、队列、定时任务和可观测性。
- Deepreef 已有 `HookManager`、`ReasonixEngine`、`ContextManager`、`AgentTool`、MCP Host、插件系统和会话 JSONL，可直接作为原生接入点。

## 3. 目标目录结构

```text
packages/memory/
  package.json
  LICENSE.agentmemory
  NOTICE.md
  src/
    functions/          # 从 agentmemory/src/functions 直接复制
    state/              # 搜索索引、向量索引、schema 等直接复制
    providers/          # 压缩、总结、embedding provider
    prompts/
    replay/
    eval/
    health/
    viewer/
    mcp/
    api/
    runtime/            # Deepreef 新增的 iii 兼容运行时
    bridge/             # Deepreef 生命周期与工具适配
    config.ts
    types.ts
    index.ts
  test/                 # 从 agentmemory/test 复制并逐步适配
```

Deepreef 其他包的职责：

- `packages/core`：持有 `MemoryService`，发出会话和执行生命周期事件，向上下文注入召回结果。
- `packages/tools`：注册核心记忆工具。
- `packages/mcp`：可选暴露完整 AgentMemory MCP 工具面。
- `packages/plugin`：加载迁入的 AgentMemory 技能内容包。
- `packages/cli` / `packages/tui`：记忆开关、状态、诊断、搜索与 Viewer 命令。

## 4. 复制策略

### 4.1 原样复制后仅修正 import 与命名

优先复制以下目录，不重写算法：

- `agentmemory/src/functions/`
- `agentmemory/src/state/`
- `agentmemory/src/providers/`
- `agentmemory/src/prompts/`
- `agentmemory/src/replay/`
- `agentmemory/src/eval/`
- `agentmemory/src/health/`
- `agentmemory/src/utils/`
- `agentmemory/src/types.ts`
- `agentmemory/src/auth.ts`
- `agentmemory/src/logger.ts`
- `agentmemory/src/viewer/`
- `agentmemory/test/`

保留原始文件头或增加：

```ts
// Derived from agentmemory, modified for Deepreef's native runtime.
```

并在 `packages/memory/NOTICE.md` 记录上游仓库、复制基准 commit：

```text
749c2806e0ec21ce6d553f376f6cf976ee251b1d
```

### 4.2 复制后改造成 Deepreef 原生入口

- `src/index.ts`：不要保留 `registerWorker()` 启动方式，拆成可由 Deepreef 创建和关闭的 `MemoryService`。
- `src/mcp/server.ts`：保留工具定义与处理逻辑，改为生成 Deepreef `AgentTool[]` 和 MCP handler。
- `src/triggers/api.ts`：保留 API handler，改由可选的 Deepreef Memory HTTP Server 注册。
- `src/hooks/*`：不再通过独立脚本和 localhost REST 回传，逻辑转入 `bridge/deepreef-hooks.ts`。
- `src/config.ts`：配置根目录从 `~/.agentmemory` 改为 `~/.deepreef/memory`，并支持 Deepreef 配置文件。

### 4.3 不进入 Deepreef 核心运行时的内容

这些内容保存在迁移归档或文档中，不应复制到运行时代码：

- `src/cli/connect/*`：面向 Claude Code、Codex、Cursor 等外部 Agent 的连接器。
- AgentMemory 独立 CLI 中下载、启动、停止 iii-engine 的逻辑。
- `iii-config.yaml`、`docker-compose.yml` 和 iii Console 管理逻辑。
- `website/`、营销素材、多语言 README、历史 benchmark 结果。

这不会减少记忆功能，只会删除 Deepreef 内部不再需要的外部部署与连接方式。

## 5. 核心实现：进程内 iii 兼容层

新增 `packages/memory/src/runtime/memory-runtime-sdk.ts`，实现 AgentMemory 实际使用的 `ISdk` 子集，使复制的功能模块可以继续使用原有注册方式。

必须支持：

```ts
interface MemoryRuntimeSdk {
  registerFunction(id: string, handler: FunctionHandler): void
  trigger(request: TriggerRequest): Promise<unknown>
  registerTrigger(trigger: TriggerDefinition): void
}
```

`trigger()` 路由规则：

- `mem::*`、`event::*`、`api::*`、`mcp::*`：调用进程内函数注册表。
- `state::get/set/update/delete/list`：调用 `MemoryStore`。
- `stream::send`：调用进程内 EventEmitter，供 Viewer 和 TUI 订阅。
- `TriggerAction.Void()`：排入受控后台任务队列，不阻塞主循环。

`registerTrigger()` 适配规则：

- `durable:subscriber`：映射为进程内事件订阅。
- `state`：在 `MemoryStore` 写入后触发。
- `http`：保存路由描述，由可选 HTTP Server 使用。
- 定时清理、衰减、快照和合并任务：映射为 Deepreef 调度器；退出时必须清理 timer。

兼容层的意义是让绝大多数 `registerXFunction(sdk, kv, ...)` 保持原样。禁止在第一阶段逐个重写所有记忆函数。

## 6. 持久化设计

定义存储接口：

```ts
interface MemoryStore {
  get<T>(scope: string, key: string): Promise<T | null>
  set<T>(scope: string, key: string, value: T): Promise<T>
  update<T>(scope: string, key: string, ops: MemoryUpdateOp[]): Promise<T>
  delete(scope: string, key: string): Promise<void>
  list<T>(scope: string): Promise<T[]>
  close(): Promise<void>
}
```

第一版使用文件型 KV，数据目录：

```text
~/.deepreef/memory/
  state/
  indexes/
  images/
  snapshots/
  exports/
```

要求：

- 写入必须串行化并使用原子替换，避免进程退出或崩溃损坏状态。
- 保留 AgentMemory 的 scope/key schema，避免重写函数模块。
- 保留 `IndexPersistence`、BM25 和向量索引现有格式。
- 提供从 `~/.agentmemory` 导入数据的显式迁移命令。
- 不要直接混用 Deepreef 当前 `.deepreef/sessions/*.jsonl` 与记忆 KV；会话日志是事实记录，记忆库是派生数据。

## 7. Deepreef 原生生命周期接线

新增 `DeepreefMemoryBridge`，并由 `ReasonixEngine` 持有。

事件映射：

| Deepreef 时机 | AgentMemory 事件/操作 |
|---|---|
| Engine 创建或加载会话 | `event::session::started` |
| 用户提交 prompt | `prompt_submit` observation |
| 工具调用前 | `pre_tool_use` observation |
| 工具调用后 | `post_tool_use` / `post_tool_failure` observation |
| 每个 loop event | 按需转换为 observation，过滤 delta 噪音 |
| 上下文压缩前 | `pre_compact` |
| 子 Agent 启动/结束 | `subagent_start` / `subagent_stop` |
| Engine shutdown | `event::session::stopped` 后 `event::session::ended` |

接线位置：

- `ReasonixEngine` 构造后启动 `MemoryService` 或接收共享实例。
- `submit()` 在构建 system prompt 前调用 `mem::context`，将结果作为独立、可替换的 memory prefix 注入。
- `StreamingToolExecutor` 的前后工具钩子调用 bridge；不要依赖 localhost HTTP。
- `shutdown()` 等待关键记忆写入 drain，但给总结、图谱提取和合并任务设置超时。

上下文注入必须满足：

- 默认有独立 token budget。
- 记忆内容使用明确的 `<deepreef-memory-context>` 边界。
- 记忆不能覆盖 system prompt、安全规则或用户本轮指令。
- 支持关闭自动注入，但显式搜索工具仍可用。

## 8. 工具、MCP、REST 与 Viewer

### 8.1 Deepreef 原生工具

首批默认注册：

- `memory_recall`
- `memory_save`
- `memory_smart_search`
- `memory_file_history`
- `memory_timeline`
- `memory_forget`
- `memory_sessions`
- `memory_status`

其余高级工具通过配置开启，避免一次把 50 多个工具全部暴露给模型造成工具选择退化。

AgentMemory 的 MCP tool schema 和 handler 应直接复用，通过 adapter 转换为 `AgentTool`，不要手写第二套业务实现。

### 8.2 完整 MCP 表面

保留完整 MCP tools/resources/prompts，供外部客户端使用。复用 `packages/mcp` 的协议能力，把请求转发给进程内 `MemoryService`，不再创建独立 AgentMemory MCP 进程。

### 8.3 REST API

REST 默认关闭，仅在配置开启时监听 localhost。保留现有 `/agentmemory/*` 路径兼容性，同时可增加 `/deepreef/memory/*` 别名。启用 REST 时必须支持 bearer secret、超时、请求体大小限制和 Viewer CSP。

### 8.4 Viewer

复制现有 Viewer，并让它读取进程内 API/EventEmitter。增加 CLI 命令：

```bash
deepreef memory viewer
deepreef memory status
deepreef memory search "<query>"
deepreef memory export
deepreef memory import <file>
deepreef memory migrate-agentmemory
```

## 9. Provider 与 Free Auto 复用

AgentMemory 当前有独立 OpenAI、Anthropic、Gemini、OpenRouter、MiniMax 和 Agent SDK provider。

实施顺序：

1. 第一阶段直接复制这些 provider，保证上游测试和行为不变。
2. 增加 `DeepreefMemoryProvider`，通过 Deepreef `ChatClient` 执行总结、压缩、图谱提取和反思。
3. 默认使用 Deepreef 当前 provider；配置为 `free-auto` 时允许记忆后台任务使用 Free Auto。
4. 后台记忆任务必须配置单独预算、并发限制、超时和禁用开关，不能消耗主会话无限额度。
5. 上游 provider 在 Deepreef provider 覆盖完整后再标记 deprecated，不要在初次迁移中删除。

## 10. 配置设计

在 Deepreef 配置 schema 中新增：

```ts
memory: {
  enabled: boolean
  autoObserve: boolean
  injectContext: boolean
  contextTokenBudget: number
  advancedTools: boolean
  graphExtraction: boolean
  consolidation: boolean
  autoCompress: boolean
  slots: boolean
  reflect: boolean
  provider: "deepreef" | "agentmemory" | "noop"
  embeddingProvider?: string
  rest?: { enabled: boolean; host: string; port: number; secret?: string }
  viewer?: { enabled: boolean; port: number }
}
```

默认值应保守：

- `enabled: true`
- `autoObserve: true`
- `injectContext: true`
- `advancedTools: false`
- 会调用额外 LLM 的 graph、consolidation、autoCompress、reflect 默认关闭
- REST 和 Viewer 默认关闭

## 11. 实施阶段

### 阶段 A：上游源码落位与许可证

- 创建 `packages/memory`。
- 复制功能源码、核心状态模块、provider、测试、Viewer 和必要资源。
- 添加 Apache-2.0 许可证、NOTICE、上游 commit 和修改说明。
- 建立独立 package build/typecheck/test，不接 Deepreef 主循环。

验收：

- `@deepreef/memory` 可单独 typecheck。
- 复制文件与上游基准可追踪。
- 没有修改 Deepreef 现有行为。

### 阶段 B：iii 兼容运行时与持久化

- 实现 `MemoryRuntimeSdk`、函数注册表、事件总线、后台任务队列和文件型 `MemoryStore`。
- 用兼容层启动所有 `register*Function`。
- 适配原有测试 helper，使大部分 AgentMemory 单元测试直接运行。

验收：

- 不启动 iii-engine 即可调用 `mem::remember`、`mem::search`、`mem::context`、图谱和治理函数。
- KV 重启后数据可恢复。
- 并发写、原子写、状态 trigger 和 Void 后台任务通过测试。

### 阶段 C：Deepreef 生命周期原生接线

- 实现 `MemoryService` 与 `DeepreefMemoryBridge`。
- 接入 session、prompt、tool、loop、subagent、compact、shutdown。
- 实现上下文自动召回与注入。

验收：

- 会话一产生的决策，会话二可自动召回。
- 工具成功与失败都能形成 observation。
- 关闭记忆功能后 Deepreef 行为与性能保持原状。
- 记忆故障不会阻断主 Agent 执行。

### 阶段 D：工具、MCP、REST、Viewer 与 CLI

- 从 AgentMemory tool registry 生成 Deepreef `AgentTool`。
- 接入完整 MCP tools/resources/prompts。
- 接入可选 REST 和 Viewer。
- 增加 `deepreef memory *` 命令与 TUI 状态。

验收：

- 默认工具集不超过首批核心工具。
- 高级工具配置开启后完整可用。
- MCP、REST、CLI 和原生工具调用同一份业务函数。
- Viewer 不可读取允许目录之外的文件，也不可执行任意代码。

### 阶段 E：高级能力与数据迁移

- 启用向量检索、图谱、结晶、反思、团队、mesh、slots、vision search 等高级能力。
- 接入 Deepreef provider 和 Free Auto。
- 实现 `~/.agentmemory` 数据迁移、导入、回滚和校验。

验收：

- AgentMemory 现有功能矩阵全部有对应的 Deepreef 测试。
- 导入后 memory/session/observation/index 数量一致。
- 无 API key 时 BM25-only 与 noop provider 正常工作。

### 阶段 F：稳定性与发布

- 跑 AgentMemory 迁入测试、Deepreef 全量测试和跨平台 CI。
- 增加 10k/100k observation 性能与内存测试。
- 检查安全、隐私、删除、导出、审计和崩溃恢复。
- 更新 Deepreef 文档和 npm 包发布配置。

验收：

- Linux、macOS、Windows CI 通过。
- 无 iii-engine 运行依赖。
- 所有后台任务可取消，退出无残留 timer/process。
- 默认关闭的昂贵功能不会偷偷调用 LLM。

## 12. 必须新增的测试

- `memory-runtime-sdk.test.ts`：函数路由、Void 调度、异常隔离。
- `memory-store.test.ts`：CRUD、update ops、并发、原子落盘、恢复。
- `deepreef-memory-bridge.test.ts`：生命周期事件映射。
- `memory-context-injection.test.ts`：预算、优先级、安全边界、关闭开关。
- `memory-tools.test.ts`：MCP schema 到 AgentTool 的转换。
- `memory-shutdown.test.ts`：drain、超时、重复 shutdown。
- `memory-migration.test.ts`：从 `~/.agentmemory` 导入和校验。
- `memory-e2e.test.ts`：跨会话记忆召回。
- `memory-failure-isolation.test.ts`：存储、provider、embedding 故障不阻断主循环。
- `memory-viewer-security.test.ts`：路径穿越、任意文件读取、CSP、鉴权。

## 13. 风险与禁止事项

- 禁止在首轮迁移中逐个重写 AgentMemory 功能模块；先用兼容层保留已验证实现。
- 禁止让记忆写入、embedding 或 LLM 压缩阻塞 Deepreef 流式输出。
- 禁止把 50 多个记忆工具默认全部暴露给模型。
- 禁止直接复用 AgentMemory 独立 CLI 的 iii-engine 下载和启动逻辑。
- 禁止无迁移流程地改写现有 `~/.agentmemory` 数据。
- 禁止把记忆召回文本当作高于 system prompt 或用户当前指令的可信指令。
- 禁止遗漏 Apache-2.0 的许可证、归属和修改声明。
- 禁止将 Viewer 作为无鉴权公网服务启动。

## 14. 完成定义

只有同时满足以下条件，才能认为 AgentMemory 已“整个加入 Deepreef”：

- Deepreef 单进程即可使用全部记忆业务能力，不依赖 iii-engine。
- AgentMemory 核心功能源码与测试已迁入并可追踪上游来源。
- Deepreef 会话生命周期自动产生、总结、召回和注入记忆。
- 核心工具默认可用，高级工具、MCP、REST、Viewer 可配置启用。
- 可从现有 AgentMemory 数据目录迁移且可验证。
- 记忆功能故障、关闭或无 API key 时，Deepreef 主流程仍正常工作。
- 跨平台 CI、安全测试和性能基线通过。

# Codex 验证说明

请在 `/vol4/Agent/deepicode` 执行以下验证。当前修改目标是核心加固，不包含 read_file、bash、edit、StreamingToolExecutor、增量 token 统计或会话持久化。

## 1. 静态检查

```bash
bun run typecheck
```

期望：TypeScript 零错误。重点确认：
- 不再出现跨仓库导入 `/vol4/Agent/oh-my-pi/.../*.ts` 导致的 `rootDir` 错误。
- `ToolResult` 不再被当作 `string` 写入 `ChatMessage.content`。

## 2. 单元测试

```bash
bun test
```

期望：现有 context 测试继续通过。重点确认：
- `ImmutablePrefix.cacheKey` 对相同 prompt 稳定，对不同 prompt 不同。
- `ContextManager` 仍按 `prefix + log + scratch` 顺序组装消息。

## 3. CLI 基础行为

```bash
bun run dev --help
```

期望：打印 help 后退出，不进入长驻交互。

```bash
printf '你好\n' | bun run dev
```

期望：能完成单轮请求并输出模型回复。若网络或 Zen API 不可用，记录错误即可。

## 4. 工具调用回归建议

建议补一个 core 层测试，用 fake stream 驱动 `ReasonixEngine`：
- 注册一个 `shared` 工具返回 `{ content: "ok", isError: false }`。
- 注册一个 `exclusive` 工具返回 `{ content: "done", isError: false }`。
- 验证 `tool_start.toolCallIndex` 分别对应真实下标。
- 验证写入上下文的 tool 消息 `content` 是字符串，不是对象。
- 验证工具返回 `isError: true` 时，`LoopEvent.role` 为 `error`，且上下文 tool 消息带 `is_error: true`。

## 5. 流畅性检查

手工观察多工具调用时的事件序列：
- 中间工具轮只应出现 `status: tools_completed`，不应提前出现终态 `done`。
- 最终模型回复完成时才出现 `done`。
- 调用 `engine.interrupt()` 后，当前请求和正在执行的工具应收到 abort signal。

## 6. 后续架构建议

当前代码可以先不继续改。下一阶段如果要继续对齐 agent 设计理念，建议采用“Reasonix 语义，轻量实现”，不必完全照搬 `/vol4/Agent/DeepSeek-Reasonix`。

核心原则：
- 模型看到的历史必须稳定、可重放、协议正确。
- UI/CLI 可以更实时、更丝滑，但展示顺序不应破坏模型历史顺序。
- 工具并发是执行优化，不应改变 assistant.tool_calls 与 tool result 的协议配对。

建议优先级：

1. **工具结果提交顺序**
   - 可以并发执行 `shared` 工具。
   - 但写入 `AppendOnlyLog` 的 tool 消息，以及核心 `tool` 结果事件，建议按模型声明的 `tool_calls` 顺序提交。
   - 如果想更丝滑，可以另发 `status` 或未来的 `tool_progress` 展示“某工具已先完成”，但不要让它改变历史提交顺序。

2. **补 `assistant_final` 事件**
   - Reasonix 在模型响应结束后有清晰的 `assistant_final` 边界，再进入工具执行。
   - deepicode 后续也建议增加这个事件，用于 UI、日志、reducer、会话持久化。
   - `assistant_delta` 负责流式显示，`assistant_final` 负责协议边界和完整响应。

3. **保留 `reasoning_content`**
   - 后续在 `ChatMessage` 中加入 `reasoning_content?: string | null`。
   - assistant 历史消息应分离 `content` 和 `reasoning_content`，不要把 reasoning 回退塞进 content。
   - DeepSeek thinking 模式下，多轮 round-trip 可能依赖这个字段。

4. **prefix fingerprint 覆盖真实前缀**
   - 当前 `cacheKey` 只覆盖 system prompt。
   - 后续建议覆盖 `system + toolSpecs + fewShots`，因为工具 schema 变化也会影响真实请求前缀和 prefix-cache。
   - 可以参考 Reasonix 的 `ImmutablePrefix.fingerprint`，但 deepicode 可以先做轻量版本。

5. **展示事件与协议事件分层**
   - 协议事件：`assistant_final`、`tool`、`done`。
   - 展示事件：`status`、未来的 `tool_progress`、warning。
   - 这样既能保持核心 deterministic，又能让 UI 不卡顿。

暂不建议在本阶段引入完整 Reasonix 的 context fold、storm breaker、repair pipeline、session persistence。那些模块价值很高，但会显著扩大实现面；等基础工具和核心 loop 稳定后再接入更合适。

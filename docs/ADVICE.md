请修改 Deepreef 项目的 TUI 显示逻辑，解决两个问题：

1. loop/workflow 模式下，工具调用显示有时像固定在最下方一样，被后续工具调用持续覆盖。
2. 不再在 TUI 中显示以下重复工具调用警告：

   * Tool call loop detected: ...
   * Tool call loop stopped: ...
   * Stopped repeated tool-call loop: ...

约束：

* 不要删除 core 层的重复工具调用检测逻辑。
* 不要删除 duplicate detector。
* 不要改模型循环的安全保护语义。
* 不要改 Reasonix Card / StreamingCard，这个问题不是 Card 导致的。
* 优先只改 `packages/tui/src/bridge.tsx`。
* 保持普通 submit 路径和 workflow/loop 路径行为一致。

一、修复 workflow/loop 工具调用 key 复用问题

文件：`packages/tui/src/bridge.tsx`

位置：`driveWorkflow(...)` 内部，现有变量附近：

```ts
let activeRole: AgentRole = 'supervisor';
let wfRoundId = '';
let wfRoundTs = 0;
let toolItemIds = new Map<string, string>();
let toolCallArgs = new Map<number, string>();
let toolOutputs = new Map<string, string>();
let assistantText = '';
let reasoningText = '';
```

新增 workflow 工具调用状态：

```ts
let wfToolSequence = 0;
let activeWorkflowToolKeys = new Map<number, string>();
let activeWorkflowToolKeysByBase = new Map<string, string>();
```

新增两个 helper，放在 `upsertWorkflowTool` 前面：

```ts
const beginWorkflowToolKey = (index: number | undefined, name: string | undefined): string => {
  const base = fallbackToolKey(index, name);
  const key = `${base}_${++wfToolSequence}`;

  if (index !== undefined) {
    activeWorkflowToolKeys.set(index, key);
  } else {
    activeWorkflowToolKeysByBase.set(base, key);
  }

  return key;
};

const resolveWorkflowToolKey = (index: number | undefined, name: string | undefined): string => {
  const base = fallbackToolKey(index, name);

  if (index !== undefined) {
    const existing = activeWorkflowToolKeys.get(index);
    if (existing) return existing;
    return beginWorkflowToolKey(index, name);
  }

  const existing = activeWorkflowToolKeysByBase.get(base);
  if (existing) return existing;
  return beginWorkflowToolKey(index, name);
};

const clearWorkflowToolKey = (index: number | undefined, name: string | undefined): void => {
  const base = fallbackToolKey(index, name);

  if (index !== undefined) {
    activeWorkflowToolKeys.delete(index);
  } else {
    activeWorkflowToolKeysByBase.delete(base);
  }
};
```

在 workflow phase 切换时，原代码会重置这些变量：

```ts
toolItemIds = new Map<string, string>();
toolCallArgs = new Map<number, string>();
toolOutputs = new Map<string, string>();
```

同步补充重置：

```ts
wfToolSequence = 0;
activeWorkflowToolKeys = new Map<number, string>();
activeWorkflowToolKeysByBase = new Map<string, string>();
```

然后修改 workflow 路径下的三个 case。

原来的 `tool_start` 大概是：

```ts
case 'tool_start': {
  const key = fallbackToolKey(loopEvent.toolCallIndex, loopEvent.toolName);
  upsertWorkflowTool(key, {
    name: loopEvent.toolName ?? 'unknown',
    status: 'running',
    args: parseArgs(loopEvent.toolCallIndex === undefined ? undefined : toolCallArgs.get(loopEvent.toolCallIndex)),
    output: '',
    startedAt: Date.now(),
  });
  break;
}
```

改为：

```ts
case 'tool_start': {
  const key = beginWorkflowToolKey(loopEvent.toolCallIndex, loopEvent.toolName);
  upsertWorkflowTool(key, {
    name: loopEvent.toolName ?? 'unknown',
    status: 'running',
    args: parseArgs(loopEvent.toolCallIndex === undefined ? undefined : toolCallArgs.get(loopEvent.toolCallIndex)),
    output: '',
    startedAt: Date.now(),
  });
  break;
}
```

原来的 `tool_progress` 大概是：

```ts
case 'tool_progress': {
  const key = fallbackToolKey(loopEvent.toolCallIndex, loopEvent.toolName);
  if (loopEvent.content === 'done') {
    upsertWorkflowTool(key, { status: 'done' });
  } else if (loopEvent.content && loopEvent.content !== 'running') {
    const previous = toolOutputs.get(key) ?? '';
    const output = previous + (previous ? '\n' : '') + loopEvent.content;
    toolOutputs.set(key, output);
    upsertWorkflowTool(key, { output });
  }
  break;
}
```

改为：

```ts
case 'tool_progress': {
  const key = resolveWorkflowToolKey(loopEvent.toolCallIndex, loopEvent.toolName);

  if (loopEvent.content === 'done') {
    upsertWorkflowTool(key, { status: 'done' });
    clearWorkflowToolKey(loopEvent.toolCallIndex, loopEvent.toolName);
    break;
  }

  if (loopEvent.content && loopEvent.content !== 'running') {
    const previous = toolOutputs.get(key) ?? '';
    const output = previous + (previous ? '\n' : '') + loopEvent.content;
    toolOutputs.set(key, output);
    upsertWorkflowTool(key, { output });
  }

  break;
}
```

原来的 `tool` 大概是：

```ts
case 'tool': {
  const key = fallbackToolKey(loopEvent.toolCallIndex, loopEvent.toolName);
  upsertWorkflowTool(key, {
    name: loopEvent.toolName ?? 'tool',
    status: loopEvent.severity === 'error' ? 'error' : 'done',
    output: loopEvent.content ?? '',
  });
  break;
}
```

改为：

```ts
case 'tool': {
  const key = resolveWorkflowToolKey(loopEvent.toolCallIndex, loopEvent.toolName);
  upsertWorkflowTool(key, {
    name: loopEvent.toolName ?? 'tool',
    status: loopEvent.severity === 'error' ? 'error' : 'done',
    output: loopEvent.content ?? '',
  });
  toolOutputs.set(key, loopEvent.content ?? '');
  break;
}
```

注意：不要在 `tool` case 里立即 `clearWorkflowToolKey`，因为某些执行路径可能在 `tool` 之后还发 `tool_progress: done`。清理放在 `tool_progress === 'done'` 时更安全。

二、隐藏重复工具调用 warning，但保留 core 安全保护

文件：`packages/tui/src/bridge.tsx`

找到当前函数：

```ts
function isTransientToolLoopWarning(message: string): boolean {
  return message.startsWith('Tool call loop detected:');
}
```

替换为：

```ts
function isToolLoopNotice(message: string): boolean {
  return message.startsWith('Tool call loop detected:')
    || message.startsWith('Tool call loop stopped:')
    || message.startsWith('Stopped repeated tool-call loop:');
}
```

然后修改 `clearTransientWarnings`，或者重命名为 `clearToolLoopNotices`：

```ts
const clearToolLoopNotices = () => {
  commitBridge(prev => {
    const warnings = prev.warnings.filter(warning => !isToolLoopNotice(warning));
    const error = prev.error && isToolLoopNotice(prev.error) ? null : prev.error;

    if (warnings.length === prev.warnings.length && error === prev.error) {
      return {};
    }

    return { warnings, error };
  });
};
```

如果不想大范围重命名，也可以保留函数名 `clearTransientWarnings`，但内部使用 `isToolLoopNotice`。

普通 submit 路径里，找到 `case 'warning'`：

```ts
case 'warning': {
  const warning = event.content ?? t().unknownWarning;
  commitBridge(prev => ({
    warnings: isTransientToolLoopWarning(warning)
      ? [...prev.warnings.filter(item => !isTransientToolLoopWarning(item)), warning]
      : [...prev.warnings, warning],
  }));
  break;
}
```

改为直接过滤：

```ts
case 'warning': {
  const warning = event.content ?? t().unknownWarning;
  if (isToolLoopNotice(warning)) break;

  commitBridge(prev => ({
    warnings: [...prev.warnings, warning],
  }));
  break;
}
```

普通 submit 路径里，找到 `case 'error'`。保留工具级 error 的显示，但隐藏 tool-call-loop 顶层错误提示。逻辑如下：

```ts
case 'error':
  if (event.toolCallIndex !== undefined) {
    const key = activeToolKeys.get(event.toolCallIndex) ?? `${fallbackToolKey(event.toolCallIndex, event.toolName)}_${++toolSequence}`;
    upsertTool(key, {
      name: event.toolName ?? t().unknown,
      status: 'error',
      output: event.content ?? t().unknownError,
    });
    toolOutputs.set(key, event.content ?? t().unknownError);
  } else {
    const errorText = event.content ?? t().unknownError;
    if (!isToolLoopNotice(errorText) && event.metadata?.reason !== 'toolCallLoop') {
      commitBridge(() => ({ error: errorText }));
    }
  }
  break;
```

workflow 路径里，找到 `case 'warning'`：

```ts
case 'warning': {
  commitBridge(prev => ({
    ...prev,
    warnings: [...prev.warnings, loopEvent.content ?? 'Warning'],
  }));
  break;
}
```

改为：

```ts
case 'warning': {
  const warning = loopEvent.content ?? 'Warning';
  if (isToolLoopNotice(warning)) break;

  commitBridge(prev => ({
    warnings: [...prev.warnings, warning],
  }));
  break;
}
```

workflow 路径里的 `case 'error'` 目前只 `console.warn`。建议也过滤 tool loop notice，避免终端 stderr 出现这类噪声：

```ts
case 'error': {
  const message = loopEvent.content ?? 'Unknown error';
  if (!isToolLoopNotice(message) && loopEvent.metadata?.reason !== 'toolCallLoop') {
    console.warn(`[tool:error] ${message}`);
  }
  break;
}
```

三、保持普通 warning 正常显示

不要隐藏所有 warning。以下 warning 仍应正常显示：

* 权限相关 warning
* workflow error
* context fold / budget warning
* verification warning
* 其他非 tool-loop warning

只过滤以下三类文本前缀：

* `Tool call loop detected:`
* `Tool call loop stopped:`
* `Stopped repeated tool-call loop:`

以及 metadata：

* `metadata.reason === 'toolCallLoop'`

四、验收标准

完成后运行：

```bash
bun run typecheck
```

如果项目没有统一 typecheck 命令，则至少运行 tui/core 对应包的 TypeScript 检查或构建命令。

手工验证：

1. 普通 alone 模式下，连续工具调用仍然正常追加历史，不应被错误覆盖。
2. loop 模式下，同一 phase 内多次调用同一种工具，例如多次 `grep` / `list_dir`，应该显示为多条历史工具调用，不能只在最底下一条原地变化。
3. loop 模式下，工具调用完成后，旧工具调用应该随着滚动历史向上移动，而不是像 live status 一样固定在底部。
4. 重复工具调用达到 3、4、5 次时，TUI 不再显示：

   * `⚠ Tool call loop detected: ...`
   * `⚠ Tool call loop stopped: ...`
5. core 层仍然要阻止 5 次重复工具调用，不能移除保护。也就是说，模型不能无限重复调用同一个工具。
6. 非 tool-loop 的 warning 仍然显示。
7. 不修改 `StreamingCard`、`Card`、`DeepiMessages` 的工具显示组件，除非类型检查要求微调 import 或命名。

五、建议提交信息

```text
fix(tui): make workflow tool timeline entries unique and suppress tool-loop notices
```

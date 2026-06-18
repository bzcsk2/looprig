请修改 Deepreef 项目的 TUI workflow/loop 显示逻辑，解决 worker/supervisor 的旧思考内容被新思考内容覆盖的问题。

目标：

1. worker 和 supervisor 的每一段 thinking/reasoning 都必须作为历史记录保留。
2. 同一个 workflow phase 内，如果模型经历“思考 → 工具调用 → 继续思考 → 再工具调用 → 再思考”，这些 reasoning 必须显示成多条独立历史项，不能共用同一个 timeline id。
3. 不要改 `DeepiMessages.tsx` 的渲染逻辑。这个问题不是渲染组件导致的，而是 `bridge.tsx` 的 workflow timeline item id 生命周期错误。
4. 不要删除 reasoning 显示，不要合并所有 reasoning，不要只保留最后一条。
5. 普通 submit 路径已有 `finalizeRound/startRound` 机制，尽量让 workflow 路径向普通 submit 路径对齐。

需要重点修改文件：

```text id="gcv3q9"
packages/tui/src/bridge.tsx
```

一、问题根因

当前 `driveWorkflow()` 内部把一个 workflow phase 当成一个 timeline round：

```ts id="oycyjs"
let wfRoundId = '';
let wfRoundTs = 0;
let assistantText = '';
let reasoningText = '';
```

然后 reasoning 固定写入：

```ts id="m3w8xo"
id: wfRoundId + '-reasoning'
```

这会导致同一个 phase 内多次 LLM turn 的 reasoning 都写到同一个 id。后来的 reasoning 会通过 upsert 覆盖前面的 reasoning。

普通 submit 路径在收到：

```ts id="rjp5ue"
status === 'tools_completed'
```

时会：

```ts id="xx71zg"
finalizeRound();
startRound();
```

但 workflow 路径现在 `case 'status'` 只是 `break`，没有在工具完成后创建新的 turn/round。

所以整改方向是：

```text id="ry7nzi"
workflow phase ≠ timeline round
workflow phase 下面应该有多个 LLM turn round
```

结构应变成：

```text id="6ev581"
workflow phase: supervisor_analyse / worker_do / worker_report / supervisor_check
  ├─ turn 1: reasoning + assistant + tools
  ├─ turn 2: reasoning + assistant + tools
  └─ turn 3: reasoning + assistant
```

二、实现方案：在 driveWorkflow 内新增 workflow turn writer

在 `driveWorkflow()` 内，替换当前单一 `wfRoundId` 状态。

保留 phase 概念，但新增 turn 概念：

```ts id="bvx7j3"
let wfPhaseId = '';
let wfPhaseTs = 0;
let wfTurnSeq = 0;

let wfTurnId = '';
let wfTurnTs = 0;

let wfAssistantId: string | null = null;
let wfReasoningId: string | null = null;

let assistantText = '';
let reasoningText = '';
```

解释：

* `wfPhaseId`：当前 workflow phase 的 id，例如 supervisor_analyse、worker_do 对应的阶段容器。
* `wfTurnId`：真正用于 timeline item 的 roundId。每次工具完成后开启新 turn。
* `wfAssistantId`：当前 turn 的 assistant text item id。
* `wfReasoningId`：当前 turn 的 reasoning item id。
* `assistantText` / `reasoningText`：只表示当前 turn 的文本，不再表示整个 phase 的累计文本。

三、增加 helper：startWorkflowPhase

在 `driveWorkflow()` 内增加：

```ts id="ij3e8z"
const startWorkflowPhase = () => {
  wfPhaseId = `wf-phase-${crypto.randomUUID()}`;
  wfPhaseTs = Date.now();
  wfTurnSeq = 0;
  startWorkflowTurn();
};
```

四、增加 helper：startWorkflowTurn

新增：

```ts id="9p40n3"
const startWorkflowTurn = () => {
  wfTurnSeq += 1;
  wfTurnId = `${wfPhaseId}-turn-${wfTurnSeq}-${crypto.randomUUID()}`;
  wfTurnTs = Date.now();

  wfAssistantId = null;
  wfReasoningId = null;

  assistantText = '';
  reasoningText = '';

  toolItemIds = new Map<string, string>();
  toolCallArgs = new Map<number, string>();
  toolOutputs = new Map<string, string>();

  // 如果你前面已经为 workflow tool key 修过 activeWorkflowToolKeys / wfToolSequence，
  // 也要在这里重置当前 turn 的工具状态。
  if (typeof activeWorkflowToolKeys !== 'undefined') {
    activeWorkflowToolKeys = new Map<number, string>();
  }
  if (typeof activeWorkflowToolKeysByBase !== 'undefined') {
    activeWorkflowToolKeysByBase = new Map<string, string>();
  }
  if (typeof wfToolSequence !== 'undefined') {
    wfToolSequence = 0;
  }
};
```

如果 TypeScript 不允许 `typeof` 检查 block-scoped 变量，就不要写这三个 `typeof`，而是直接把你项目中已有的 workflow tool key 状态变量放进 `startWorkflowTurn()` 里重置。

五、增加 helper：ensureWorkflowTurn

新增：

```ts id="j2st3l"
const ensureWorkflowTurn = () => {
  if (!wfPhaseId) {
    wfPhaseId = `wf-phase-${crypto.randomUUID()}`;
    wfPhaseTs = Date.now();
    wfTurnSeq = 0;
  }

  if (!wfTurnId) {
    startWorkflowTurn();
  }
};
```

所有 `assistant_delta`、`assistant_final`、`reasoning_delta`、`tool_call_delta`、`tool_start`、`tool_progress`、`tool` 事件处理前，都应该先调用 `ensureWorkflowTurn()`，避免事件早于 phase_change 时丢失。

六、增加 helper：ensureWorkflowAssistantId / ensureWorkflowReasoningId

新增：

```ts id="54wdk4"
const ensureWorkflowAssistantId = () => {
  ensureWorkflowTurn();
  if (!wfAssistantId) {
    wfAssistantId = `${wfTurnId}-assistant`;
  }
  return wfAssistantId;
};

const ensureWorkflowReasoningId = () => {
  ensureWorkflowTurn();
  if (!wfReasoningId) {
    wfReasoningId = `${wfTurnId}-reasoning`;
  }
  return wfReasoningId;
};
```

注意：reasoning id 必须基于 `wfTurnId`，不能再基于 `wfRoundId` 或 phase id。

七、增加 store-aware 的 text upsert helper

当前 workflow 的 `upsertWorkflowItem()` 只更新 `bridgeState.timeline`，在 transcriptStore 开启时不够稳。新增一个专门写 assistant_text / reasoning 的 helper：

```ts id="wdcy2j"
const upsertWorkflowTextItem = (
  item: Extract<TimelineItem, { kind: 'assistant_text' | 'reasoning' }>,
) => {
  if (transcriptStore) {
    if (item.kind === 'assistant_text') {
      transcriptStore.upsertAssistantText(item);
    } else {
      transcriptStore.upsertReasoning(item);
    }
    publishTimeline();
    return;
  }

  upsertWorkflowItem(item);
};
```

如果 TypeScript 对 `Extract<TimelineItem, { kind: 'assistant_text' | 'reasoning' }>` 推断不理想，可以拆成两个函数：

```ts id="flfyfm"
const upsertWorkflowAssistantText = (item: Extract<TimelineItem, { kind: 'assistant_text' }>) => { ... };
const upsertWorkflowReasoning = (item: Extract<TimelineItem, { kind: 'reasoning' }>) => { ... };
```

八、替换 finalizeWorkflowRound 为 finalizeWorkflowTurn

把当前 `finalizeWorkflowRound()` 替换成 turn 级 finalize：

```ts id="63b354"
const finalizeWorkflowTurn = () => {
  if (!wfTurnId) return;

  if (wfAssistantId) {
    if (assistantText) {
      upsertWorkflowTextItem({
        id: wfAssistantId,
        kind: 'assistant_text',
        roundId: wfTurnId,
        text: assistantText,
        isStreaming: false,
        startTs: wfTurnTs,
        role: activeRole,
      });
    } else if (transcriptStore) {
      transcriptStore.finalizePart(wfAssistantId);
      publishTimeline();
    }
  }

  if (wfReasoningId) {
    if (reasoningText) {
      upsertWorkflowTextItem({
        id: wfReasoningId,
        kind: 'reasoning',
        roundId: wfTurnId,
        text: reasoningText,
        isStreaming: false,
        startTs: wfTurnTs,
        role: activeRole,
      });
    } else if (transcriptStore) {
      transcriptStore.finalizePart(wfReasoningId);
      publishTimeline();
    }
  }
};
```

如果你不想在同一 turn 被重复 finalize 后反复 upsert，可以增加：

```ts id="jbg3r7"
let wfTurnFinalized = false;
```

然后：

```ts id="2lm8pu"
const finalizeWorkflowTurn = () => {
  if (!wfTurnId || wfTurnFinalized) return;
  wfTurnFinalized = true;
  ...
};
```

并在 `startWorkflowTurn()` 里设置：

```ts id="78suhl"
wfTurnFinalized = false;
```

九、修改 phase_change 处理

找到 workflow 的：

```ts id="xkjkc3"
if (wfEvent.type === 'phase_change' && wfEvent.phase && wfEvent.iteration != null) {
  finalizeWorkflowRound();
  activeRole = ...
  ...
  wfRoundId = `wf-round-${crypto.randomUUID()}`;
  wfRoundTs = Date.now();
  assistantText = '';
  reasoningText = '';
  toolItemIds = new Map<string, string>();
  toolCallArgs = new Map<number, string>();
  toolOutputs = new Map<string, string>();
}
```

改成：

```ts id="lcqmmk"
if (wfEvent.type === 'phase_change' && wfEvent.phase && wfEvent.iteration != null) {
  finalizeWorkflowTurn();

  activeRole = wfEvent.phase === 'worker_do' || wfEvent.phase === 'worker_report'
    ? 'worker'
    : 'supervisor';

  onPhaseChange?.(wfEvent.phase, wfEvent.iteration);

  if (orchestrationStore) {
    orchestrationStore.apply({
      kind: 'loop_transition',
      transition: {
        from: (orchestrationStore.getSnapshot().loop.phase as any) ?? 'observe',
        to: wfEvent.phase as any,
        attempt: wfEvent.iteration,
        timestamp: Date.now(),
      },
    });
  }

  startWorkflowPhase();
}
```

重点：

* phase 切换时 finalize 上一个 turn。
* 新 phase 开始时调用 `startWorkflowPhase()`。
* 不要再用 `wfRoundId = ...`。
* 不要再用 phase id 当 reasoning/assistant 的 item id 基础。

十、修改 assistant_delta

当前逻辑大概是：

```ts id="5ab1vy"
assistantText += loopEvent.content ?? '';
transcriptStore.ensureTextPart(wfRoundId + '-text', ...)
```

改为：

```ts id="1u9w9f"
case 'assistant_delta': {
  ensureWorkflowTurn();

  const chunk = loopEvent.content ?? '';
  assistantText += chunk;

  const id = ensureWorkflowAssistantId();

  if (transcriptStore) {
    transcriptStore.ensureTextPart(id, 'assistant_text', wfTurnId, wfTurnTs, activeRole);
    transcriptStore.appendPartDelta(id, chunk);
    publishTimeline();
  } else {
    upsertWorkflowItem({
      id,
      kind: 'assistant_text',
      roundId: wfTurnId,
      text: assistantText,
      isStreaming: true,
      startTs: wfTurnTs,
      role: activeRole,
    });
  }

  break;
}
```

十一、修改 reasoning_delta

当前逻辑大概是：

```ts id="rhjv9s"
reasoningText += loopEvent.content ?? '';
transcriptStore.ensureTextPart(wfRoundId + '-reasoning', ...)
```

改为：

```ts id="s0lj8x"
case 'reasoning_delta': {
  ensureWorkflowTurn();

  const chunk = loopEvent.content ?? '';
  reasoningText += chunk;

  const id = ensureWorkflowReasoningId();

  if (transcriptStore) {
    transcriptStore.ensureTextPart(id, 'reasoning', wfTurnId, wfTurnTs, activeRole);
    transcriptStore.appendPartDelta(id, chunk);
    publishTimeline();
  } else {
    upsertWorkflowItem({
      id,
      kind: 'reasoning',
      roundId: wfTurnId,
      text: reasoningText,
      isStreaming: true,
      startTs: wfTurnTs,
      role: activeRole,
    });
  }

  break;
}
```

十二、修改 assistant_final

当前 assistant_final 会把 metadata.reasoning 写回同一个 `wfRoundId + '-reasoning'`。必须改成当前 turn 的 reasoning id。

建议写法：

```ts id="zk9krx"
case 'assistant_final': {
  ensureWorkflowTurn();

  if (loopEvent.content) {
    assistantText = loopEvent.content;
  }

  const metadataReasoning = loopEvent.metadata?.reasoning;
  if (typeof metadataReasoning === 'string' && metadataReasoning.length > 0) {
    reasoningText = metadataReasoning;
  }

  if (assistantText) {
    const id = ensureWorkflowAssistantId();

    upsertWorkflowTextItem({
      id,
      kind: 'assistant_text',
      roundId: wfTurnId,
      text: assistantText,
      isStreaming: false,
      startTs: wfTurnTs,
      role: activeRole,
    });
  }

  if (reasoningText) {
    const id = ensureWorkflowReasoningId();

    upsertWorkflowTextItem({
      id,
      kind: 'reasoning',
      roundId: wfTurnId,
      text: reasoningText,
      isStreaming: false,
      startTs: wfTurnTs,
      role: activeRole,
    });
  }

  break;
}
```

注意：

* `metadataReasoning` 可以覆盖当前 turn 的 reasoning，因为它通常是当前 turn 的 full reasoning。
* 但它不能覆盖旧 turn 的 reasoning，因为当前 turn id 已经唯一。
* 不要再使用 `wfRoundId + '-reasoning'`。

十三、修改 tool 相关事件的 roundId

所有 workflow tool item 的 `roundId` 应该使用 `wfTurnId`，而不是旧 `wfRoundId`。

修改 `upsertWorkflowTool()` 内部：

```ts id="bd39kq"
transcriptStore.upsertTool(itemId, wfTurnId, tool, current => ({ ...current, ...patch }), activeRole);
```

以及非 store 路径：

```ts id="924l8t"
const item: TimelineItem = {
  id: itemId,
  kind: 'tool',
  roundId: wfTurnId,
  tool: merged,
  role: activeRole,
};
```

同时，在 `tool_call_delta`、`tool_start`、`tool_progress`、`tool` 分支开头调用：

```ts id="v16bqw"
ensureWorkflowTurn();
```

例如：

```ts id="sseh3u"
case 'tool_start': {
  ensureWorkflowTurn();
  ...
}
```

十四、修改 status === tools_completed

workflow 路径现在的 status 分支是空的。改为：

```ts id="xmy513"
case 'status': {
  if (loopEvent.content === 'tools_completed') {
    finalizeWorkflowTurn();
    startWorkflowTurn();
  }
  break;
}
```

这是最关键的修复点之一。

原因：

* core 的 runLoop 在工具调用完成后会继续下一轮 LLM turn。
* 下一轮 LLM turn 的 reasoning 必须进入新的 timeline item。
* 如果不在 `tools_completed` 后开新 turn，就会继续写入同一个 reasoning id。

十五、修改 finally

当前 finally 应该调用旧的：

```ts id="fasv9j"
finalizeWorkflowRound();
```

改成：

```ts id="y5zueq"
finalizeWorkflowTurn();
```

十六、清理旧变量和旧引用

完成后，检查并删除或替换所有旧引用：

```text id="3k7y32"
wfRoundId
wfRoundTs
finalizeWorkflowRound
wfRoundId + '-text'
wfRoundId + '-reasoning'
```

它们不应该再出现在 `driveWorkflow()` 的事件处理里。

可以用：

```bash id="gqjshv"
grep -n "wfRoundId\\|wfRoundTs\\|finalizeWorkflowRound" packages/tui/src/bridge.tsx
```

理想结果：这些旧名字在 workflow 逻辑中不再存在。如果为了兼容保留了变量名，也必须确认它已经表示 turn，而不是 phase。

十七、验收标准

运行类型检查：

```bash id="vb5zmc"
bun run typecheck
```

如果项目没有统一 typecheck 命令，则运行对应 package 的 build/typecheck。

手工验证：

1. 进入 loop 模式。
2. 让 supervisor 先思考并生成计划。
3. 让 worker 执行一个需要多次工具调用的任务，例如：

   * 搜索文件
   * 读取文件
   * 再搜索
   * 再总结
4. 观察 TUI：

   * 工具调用前的 worker thinking 不应被工具调用后的 worker thinking 覆盖。
   * supervisor_analyse 的 thinking 不应被 supervisor_check 的 thinking 覆盖。
   * worker_do 的 thinking 不应被 worker_report 的 thinking 覆盖。
   * 同一个 worker_do phase 内，工具前后的多段 thinking 应该显示为多条历史记录。
5. 检查 timeline item id：

   * 每段 reasoning 的 id 应类似：

     * `wf-phase-xxx-turn-1-xxx-reasoning`
     * `wf-phase-xxx-turn-2-xxx-reasoning`
     * `wf-phase-xxx-turn-3-xxx-reasoning`
   * 不应该再看到多个 reasoning 共用同一个 `wfRoundId + '-reasoning'`。
6. 普通 alone/subagent submit 路径不能回归：

   * assistant streaming 正常。
   * reasoning streaming 正常。
   * tools_completed 后仍然开启新 round。

十八、不要做的事

不要这样修：

```ts id="fggs1q"
id: `${wfRoundId}-reasoning-${crypto.randomUUID()}`
```

这种做法虽然能避免覆盖，但会导致同一段 streaming reasoning 的每个 update 都变成新 item，界面会疯狂追加重复内容。

正确做法是：

```text id="024m6l"
同一个 LLM turn 内：固定一个 reasoning id，用于 streaming update。
工具完成后进入下一个 LLM turn：创建新的 reasoning id。
phase 切换后进入新 phase：创建新的 phase id 和 turn id。
```

十九、建议提交信息

```text id="rv6t5c"
fix(tui): preserve workflow reasoning across tool turns
```

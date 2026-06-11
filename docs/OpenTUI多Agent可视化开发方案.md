# Deepreef OpenTUI 多 Agent 可视化开发方案

状态：`Approved / 待实施`  
最后更新：2026-06-11  
目标读者：负责重做 Deepreef TUI、多 Agent 编排可视化和迁移验收的开发 Agent  
参考项目：

- Ralph TUI：`/vol4/Agent/ralph-tui/src/tui/`
- OpenCode TUI：`/vol4/Agent/opencode/packages/opencode/src/cli/cmd/tui/`
- Deepreef 当前 TUI：`/vol4/Agent/deepreef/packages/tui/`

关联文档：

- [Deepreef后续开发计划.md](Deepreef后续开发计划.md)
- [Deepreef项目设计文档.md](Deepreef项目设计文档.md)
- [TODO.md](TODO.md)
- [TUI优化计划.md](TUI优化计划.md)

---

## 一、方案结论

Deepreef 将重做 TUI 前端，并把多 Agent 编排状态作为一级可视化能力。

新 TUI 使用 **OpenTUI React**。Ralph TUI 作为视觉、布局和纯 UI 组件的主要来源；OpenCode 作为状态同步、键盘路由和稳定渲染的主要参考；Deepreef 现有 Core、LoopEvent、权限、Question、Session、Plugin、Memory 和工具执行链保持为唯一业务来源。

执行原则：

1. **复制 Ralph 的视觉布局和纯组件，适配 Deepreef 数据，不复制 Ralph 的业务运行时。**
2. **多 Agent 编排属于 Core，TUI 只观察、选择、暂停、恢复和请求操作。**
3. **所有运行态通过事件进入 TUI Store，不允许 Core 直接调用 React 组件。**
4. **不复制 Ralph 的 `RunApp.tsx`、`output-parser.ts` 或可变变量加 `setTick` 状态桥。**
5. **新旧 TUI 在迁移期并存，达到功能与稳定性验收后再删除 Ink。**

本方案优先级高于 `TUI优化计划.md` 中“保留 Ink、不迁移 OpenTUI”的旧结论。

---

## 二、产品目标

Deepreef 主打省钱和省心。TUI 必须让用户随时看清：

- 哪些本地小模型 Worker 正在工作、空闲、等待权限或失败。
- 当前 Supervisor 使用哪个用户配置的免费/中等模型，正在审查什么。
- 主循环处于 observe、plan、act、verify、reflect、retry、paused 或 done 哪一阶段。
- 每个 Worker 当前任务、最近动作、验证结果、失败原因和下一步。
- Supervisor 给过什么建议，Worker 是否采用，采用后是否产生净进展。
- 权限、Question、模型不可用、配额冷却和 checkpoint 是否阻塞任务。
- 多个 Agent 可以持续执行，但不得静默切换主模型、权限模式或 thinking 强度。

首屏必须提供类似以下的稳定运行总览：

```text
┌ Local Workers ─────┬ Supervisor ───────┬ Loop State ──────────┐
│ qwen-1.5b: running │ deepseek: review  │ observe → act        │
│ mimo-small: idle   │ kimi: idle        │ reflect → retry      │
└────────────────────┴───────────────────┴──────────────────────┘
```

这不是装饰性 Dashboard。每一行必须来自结构化状态，可进入详情页，并能准确反映 Core 当前状态。

---

## 三、明确吸收与不吸收

### 3.1 从 Ralph TUI 复制并适配

复制前必须保留 Ralph MIT 来源说明。优先复制纯 UI 和布局代码，删除 Ralph 业务类型依赖后再接入 Deepreef Store。

| Ralph 来源 | Deepreef 目标 | 处理方式 |
|---|---|---|
| `components/ProgressDashboard.tsx` | `components/dashboard/OrchestrationDashboard.tsx` | 复制三栏/多栏 Dashboard 视觉和截断方式，改成 Worker/Supervisor/LoopState |
| `components/ParallelProgressView.tsx` | `components/workers/WorkerListPanel.tsx` | 复制 Worker 行、状态图标、耗时和选中态 |
| `components/WorkerDetailView.tsx` | `components/workers/WorkerDetailView.tsx` | 复制详情页视觉，数据改为 TaskLedger、工具和验证记录 |
| `components/SubagentTreePanel.tsx` | `components/agents/AgentTreePanel.tsx` | 复制树形层级、焦点和状态样式 |
| `components/IterationHistoryView.tsx` | `components/loop/LoopHistoryView.tsx` | 复制历史列表视觉，迭代改成 Loop phase/attempt |
| `components/IterationDetailView.tsx` | `components/loop/LoopDetailView.tsx` | 复制详情布局，展示 phase、evidence、advice、verification |
| `components/ConfirmationDialog.tsx` | 通用确认弹窗 | 复制并适配现有 Permission/危险操作二次确认 |
| `components/HelpOverlay.tsx` | 帮助覆盖层 | 复制布局，快捷键由统一 KeymapRegistry 提供 |
| `components/Footer.tsx` | 动态快捷键 Footer | 复制视觉，不硬编码快捷键 |
| `components/Toast.tsx` | Toast 通知 | 复制纯 UI 与生命周期 |
| `components/FileBrowser.tsx` | 文件选择器 | 第二阶段复制，接 Deepreef 文件与权限边界 |
| `theme.ts` 的颜色和 layout token | `theme/` | 复制视觉 token 作为初始主题，不复制可变全局主题状态 |

复制后的组件不得继续 import Ralph 的：

- `engine/types`
- `parallel/types`
- `plugins/trackers`
- `remote`
- `config`
- `output-parser`

### 3.2 从 OpenCode 借鉴

| 能力 | 处理方式 |
|---|---|
| 细粒度、规范化 Store | 借鉴状态切片和 selector 思路 |
| Overlay/焦点/键盘路由 | 建立统一 `KeymapRegistry` 和 Overlay stack |
| 稳定 TUI 渲染 | 借鉴增量更新和局部订阅，不复制 Solid 组件 |
| Permission/Question 生命周期 | 复用 Deepreef 已有 Core 协议，参考其交互设计 |

### 3.3 保留 Deepreef

- `CoreEngine.submit() -> AsyncGenerator<LoopEvent>` 核壳边界。
- ModelTarget、ModelProfile、HarnessProfile、TaskLedger、SupervisorAdvice 设计。
- Permission、Question、Session、Context、MCP、Plugin、AgentMemory。
- 工具执行器、验证门禁、checkpoint 和安全边界。
- 用户手动选择主模型、Worker、Supervisor 和 thinking mode 的原则。

### 3.4 明确不复制

- Ralph `RunApp.tsx`：体量过大且直接耦合 Ralph Engine、Remote、Tracker 和并行执行。
- Ralph `PrdChatApp.tsx`：属于 Ralph 产品流程。
- Ralph `output-parser.ts`：Deepreef 已有统一事件，不应在 TUI 解析供应商 JSONL。
- Ralph command runner 和远程 Tab。
- Ralph 可变变量配合 `setTick` 强制刷新模式。
- Ralph `@opentui/react@0.1.72` 依赖版本。
- OpenCode 的 Solid 组件树、Effect 服务容器和 HTTP/SDK 运行时。

---

## 四、目标页面与信息架构

### 4.1 页面结构

新 TUI 采用“固定总览 + 主工作区 + 固定输入/状态栏”的结构：

```text
┌ Deepreef · session · repo · permission mode · model ──────────────┐
├ Local Workers ─────┬ Supervisor ───────┬ Loop State ──────────────┤
│ worker rows        │ supervisor rows   │ current phase / attempts │
├ Agent Tree ────────┼ Main Workspace / Detail ─────────────────────┤
│ hierarchy          │ transcript / worker / supervisor / loop      │
│ task ownership     │ details / tools / verification / evidence    │
├────────────────────┴───────────────────────────────────────────────┤
│ input / Question / Permission / confirmation                       │
├ shortcuts · provider · context · cache · plugin · memory · mcp ───┤
└────────────────────────────────────────────────────────────────────┘
```

### 4.2 一级页面

| 页面 | 快捷键建议 | 作用 |
|---|---:|---|
| `Chat` | `1` | 主会话、reasoning、工具调用和输入 |
| `Orchestration` | `2` | Worker、Supervisor、Loop State 和 Agent Tree 总览 |
| `Workers` | `3` | Worker 列表与选中 Worker 详情 |
| `Supervisor` | `4` | 候选池、冷却、请求历史、Advice 和采纳结果 |
| `Loop` | `5` | TaskLedger、phase、attempt、checkpoint 和 verification |
| `System` | `6` | Provider、Plugin、Memory、MCP、权限和诊断 |

首页默认进入 `Chat`，但顶部 Orchestration Dashboard 始终可见；用户可在设置中选择默认进入 `Orchestration`。

### 4.3 宽度响应规则

| 终端宽度 | 布局 |
|---|---|
| `>= 140` | 三栏 Dashboard + Agent Tree + 详情双栏 |
| `100-139` | 三栏 Dashboard；主工作区单栏；Agent Tree 可切换 |
| `80-99` | Dashboard 每栏只显示摘要；详情通过 Tab 切换 |
| `< 80` | 单栏页面；Dashboard 变为三行摘要；Overlay 全屏 |

不得通过简单隐藏关键状态适配窄屏。窄屏仍必须显示运行 Worker 数、Supervisor 状态、当前 phase、权限模式和阻塞状态。

### 4.4 鼠标与键盘交互

多面板 Dashboard **必须支持鼠标交互，但不得依赖鼠标才能使用**。所有鼠标操作必须有键盘等价操作，以兼容 SSH、tmux、禁用鼠标的终端和纯键盘用户。

| 操作 | 鼠标 | 键盘等价操作 |
|---|---|---|
| 聚焦面板或列表项 | 单击 | `Tab` / `Shift+Tab`、方向键 |
| 进入 Worker、Supervisor、Loop 或 Agent 详情 | 双击或单击详情按钮 | `Enter` |
| 返回上一级或关闭 Overlay | 点击返回/关闭按钮 | `Esc` |
| 滚动当前面板 | 滚轮滚动悬停面板 | `↑↓`、`PageUp/PageDown` |
| 切换一级页面 | 点击 Tab | `1-6` |
| 聚焦输入框 | 点击输入框 | 统一输入快捷键 |
| 暂停、恢复、取消和请求 Supervisor | 点击显式按钮 | 对应 Keymap command |

首版不实现右键菜单和拖拽排序。Hover 只能用于辅助高亮或提示，关键信息和操作不得只在 Hover 时出现。

焦点状态必须统一表示，不能由每个组件自行维护：

```ts
type FocusTarget =
  | { kind: 'page'; pageId: string }
  | { kind: 'panel'; panelId: string }
  | { kind: 'worker'; workerId: string }
  | { kind: 'supervisor'; supervisorId: string }
  | { kind: 'agent'; agentId: string }
  | { kind: 'input'; inputId: string }
  | { kind: 'overlay'; overlayId: string };
```

鼠标事件必须先经过统一 Interaction/Focus Router，再转换为选择、滚动或 command。业务组件不得直接通过鼠标事件修改 Core 运行态。危险操作即使由鼠标发起，也必须进入 ConfirmationDialog；单击不得直接取消 Worker、开启 yolo 或发送敏感权限确认。

---

## 五、核心可视化定义

### 5.1 Local Workers 面板

每个 Worker 行显示：

```text
◉ qwen-1.5b   running   edit parser.ts        00:42
○ mimo-small  idle      waiting               00:00
! gemma-31b   blocked   permission: exec      01:18
```

状态集合：

```ts
type WorkerStatus =
  | 'queued'
  | 'starting'
  | 'running'
  | 'waiting_permission'
  | 'waiting_question'
  | 'waiting_supervisor'
  | 'verifying'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'idle';
```

选中 Worker 后详情页必须显示：

- Worker ID、模型 target、profile、harness。
- 所属任务和父 Agent。
- 当前动作与最近工具。
- TaskLedger 摘要和剩余步骤。
- 最近失败签名、重试次数和 checkpoint。
- 验证命令及结果。
- 最近一次 SupervisorAdvice 及采纳状态。
- 权限/Question 阻塞状态。

### 5.2 Supervisor 面板

Supervisor 面板展示用户明确配置的候选，不表示自动主模型路由：

```text
◆ deepseek-v4-flash  reviewing   worker-2
○ mimo-v2.5          idle        cooldown 0s
○ stepfun-3.5        unavailable smoke test required
```

状态集合：

```ts
type SupervisorStatus =
  | 'disabled'
  | 'idle'
  | 'queued'
  | 'reviewing'
  | 'cooldown'
  | 'unavailable'
  | 'error';
```

详情页必须显示：

- 候选 model target 和 provider，不展示密钥。
- 当前审查的 Worker、失败签名和 evidence hash。
- EvidenceBundle 摘要。
- SupervisorAdvice 结构化字段。
- Worker 是否采纳、采纳哪一项、之后是否产生净进展。
- Session 使用次数、候选冷却和失败原因。

### 5.3 Loop State 面板

首版 phase 使用固定状态机：

```ts
type LoopPhase =
  | 'observe'
  | 'plan'
  | 'act'
  | 'verify'
  | 'reflect'
  | 'retry'
  | 'paused'
  | 'done'
  | 'failed';
```

面板示例：

```text
observe → act
reflect → retry
attempt 3 · checkpoint saved
```

Loop 详情页显示：

- 当前 phase 和 phase 开始时间。
- 当前 attempt、最大预算和停止原因。
- 最近的 phase 转换历史。
- no-progress、repeated-error、verification-failed 等 runtime signal。
- TaskLedger 进度与 checkpoint。
- 下一步由 Worker、Supervisor、用户还是权限系统决定。

### 5.4 Agent Tree

Agent Tree 同时表达层级和任务所有权：

```text
◉ [main/build] 修复 parser
  ◉ [worker/qwen-1.5b] 修改 tokenizer
    ✓ [subagent/plan] 定位测试
  ◆ [supervisor/deepseek] review failure
  ! [worker/mimo-small] waiting permission
```

树节点可选择并进入详情。树只展示运行关系，不负责创建、取消或重排任务；这些操作必须通过显式 Core command 完成。

---

## 六、前端状态架构

### 6.1 数据流

```text
Core / Orchestrator
  -> AsyncGenerator<LoopEvent>
  -> TuiEventAdapter
  -> normalized stores
  -> selectors
  -> OpenTUI React components
```

禁止：

```text
Core -> React setState
Component -> mutate Worker runtime
TUI -> parse provider JSONL
```

### 6.2 Store 切分

在 `packages/tui-opentui/src/store/` 建立：

| Store | 内容 |
|---|---|
| `TranscriptStore` | 复用/迁移当前规范化 transcript |
| `WorkerStore` | Worker 实体、排序、状态和选中项 |
| `SupervisorStore` | 候选、请求、Advice、冷却和预算 |
| `LoopStore` | phase、attempt、signals、TaskLedger 摘要 |
| `AgentTreeStore` | Agent 节点与父子关系 |
| `PermissionStore` | pending permission 与回答状态 |
| `QuestionStore` | pending question 与回答状态 |
| `SystemStore` | provider、plugin、memory、MCP、session 和诊断 |
| `UiStore` | 当前页面、焦点、overlay、toast 和布局尺寸 |

Store 必须满足：

- 使用稳定 ID 规范化实体。
- 单个 Worker delta 只通知对应 selector。
- 流式文本按帧批量刷新。
- hydration 不覆盖 live 更新。
- Store 可由纯事件重放重建，便于测试和 Session 恢复。

### 6.3 多 Agent 事件契约

Core 应扩展结构化 `LoopEvent`，不要依赖 `status.content` 文本解析：

```ts
type OrchestrationEvent =
  | { role: 'orchestration'; kind: 'worker_upsert'; worker: WorkerSnapshot }
  | { role: 'orchestration'; kind: 'worker_remove'; workerId: string }
  | { role: 'orchestration'; kind: 'supervisor_upsert'; supervisor: SupervisorSnapshot }
  | { role: 'orchestration'; kind: 'supervisor_advice'; advice: SupervisorAdviceSnapshot }
  | { role: 'orchestration'; kind: 'loop_transition'; transition: LoopTransition }
  | { role: 'orchestration'; kind: 'runtime_signal'; signal: RuntimeSignalSnapshot }
  | { role: 'orchestration'; kind: 'agent_tree_upsert'; node: AgentNodeSnapshot }
  | { role: 'orchestration'; kind: 'checkpoint'; checkpoint: CheckpointSnapshot };
```

如果 Core 尚未实现对应运行时，先建立 schema、fixture 和 mock event replay，不允许 TUI 自行猜测运行状态。

### 6.4 TUI 可发出的命令

TUI 只能发送显式 command：

```ts
type OrchestrationCommand =
  | { type: 'worker.pause'; workerId: string }
  | { type: 'worker.resume'; workerId: string }
  | { type: 'worker.cancel'; workerId: string }
  | { type: 'worker.open'; workerId: string }
  | { type: 'supervisor.request'; workerId: string }
  | { type: 'checkpoint.save'; runId: string };
```

所有命令必须经过 Core 校验。TUI 不得：

- 自动切换 Worker/Supervisor 模型。
- 自动开启 yolo。
- 绕过 PermissionEngine。
- 让 Supervisor 直接执行工具。
- 直接修改 TaskLedger 或 Agent Tree。

---

## 七、OpenTUI 组件结构

建议新建独立包 `packages/tui-opentui/`，避免迁移期间污染现有 `packages/tui/`。

```text
packages/tui-opentui/src/
  App.tsx
  entry.tsx
  adapters/
    tui-event-adapter.ts
    command-dispatcher.ts
  components/
    dashboard/
      OrchestrationDashboard.tsx
      LocalWorkersSummary.tsx
      SupervisorSummary.tsx
      LoopStateSummary.tsx
    agents/
      AgentTreePanel.tsx
    workers/
      WorkerListPanel.tsx
      WorkerDetailView.tsx
    supervisor/
      SupervisorListPanel.tsx
      SupervisorDetailView.tsx
      AdviceView.tsx
    loop/
      LoopHistoryView.tsx
      LoopDetailView.tsx
    chat/
      TranscriptView.tsx
      PromptInput.tsx
    overlays/
      PermissionOverlay.tsx
      QuestionOverlay.tsx
      ConfirmationDialog.tsx
      HelpOverlay.tsx
    system/
      SystemStatusView.tsx
    common/
      Footer.tsx
      Toast.tsx
      StatusBadge.tsx
      EmptyState.tsx
  keymap/
    registry.ts
    scopes.ts
  interaction/
    focus-router.ts
    mouse-router.ts
    action-registry.ts
  store/
  theme/
    colors.ts
    layout.ts
    status.ts
```

组件要求：

- 页面组件只读取 selector，不接收巨型 App props。
- 面板组件不得 import Core Engine。
- 所有列表使用稳定实体 ID。
- 所有颜色、边框、间距和状态图标集中到 theme token。
- Footer 根据当前页面和焦点动态展示快捷键。
- Overlay 打开时，下层快捷键不得穿透。
- 鼠标和键盘必须共享同一 ActionRegistry，不得实现两套行为逻辑。
- 面板滚轮只滚动当前悬停或已聚焦面板，不得带动整个页面跳动。

---

## 八、迁移实施任务

### TUI-OT-00：建立迁移基线

1. 保存当前 Ink TUI 截图、功能清单、快捷键和 PTY 行为。
2. 建立 `DEEPREEF_TUI=ink|opentui` 显式切换。
3. 新建 `packages/tui-opentui/`，不修改现有默认入口。
4. 选择与当前工作区兼容的 OpenTUI React 版本并锁定，不复制 Ralph 的 `0.1.72`。

验收：

- 两套 TUI 可独立启动。
- Pipe/非 TTY 模式行为不变。

### TUI-OT-10：复制主题与基础壳

1. 从 Ralph 复制 theme/layout token、Header、Footer、Toast、HelpOverlay、ConfirmationDialog。
2. 删除 Ralph 类型和业务 import。
3. 实现统一 KeymapRegistry、焦点和 Overlay stack。
4. 实现宽屏、中屏、窄屏响应布局。
5. 实现统一鼠标路由：单击聚焦、双击/Enter 进入详情、滚轮滚动悬停面板。
6. 鼠标与键盘操作通过同一个 ActionRegistry 分发。

验收：

- resize 不崩溃、不残留旧帧。
- Overlay 不穿透快捷键。
- 每个鼠标操作都有键盘等价操作。
- 鼠标不可用时全部核心功能仍可使用。
- 滚轮只影响当前悬停或聚焦面板。
- 危险按钮必须二次确认，不能单击直接执行。
- 主题和布局测试通过。

### TUI-OT-20：建立事件适配与 Store

1. 迁移 Deepreef 当前 TranscriptStore 和 delta batching 思路。
2. 实现 WorkerStore、SupervisorStore、LoopStore、AgentTreeStore。
3. 实现 fixture event replay。
4. 禁止组件直接持有 Engine。

验收：

- 同一事件序列可重放得到相同快照。
- 单 Worker 更新不触发所有 Worker 行重绘。
- live delta 不被 hydration 覆盖。

### TUI-OT-30：实现多 Agent 总览

1. 从 Ralph `ProgressDashboard` 适配 `OrchestrationDashboard`。
2. 实现 Local Workers、Supervisor、Loop State 三栏。
3. 从 Ralph `SubagentTreePanel` 适配 Agent Tree。
4. 实现选中状态和详情跳转。

验收：

- 首屏准确呈现用户要求的三栏布局。
- 0、1、4、20 个 Worker 均能正确显示。
- Worker/Supervisor/Loop 状态由结构化 fixture 驱动。

### TUI-OT-40：实现详情页面

1. 从 Ralph Worker/Iteration 详情组件复制视觉结构。
2. 实现 Worker、Supervisor、Loop、System 页面。
3. 展示 TaskLedger、Advice、verification、checkpoint、权限和 Question 阻塞。

验收：

- 任意 Dashboard 项可进入详情并返回。
- 不展示 API key、完整远程 evidence 或敏感配置。

### TUI-OT-50：迁移 Chat 与交互闭环

1. 适配现有 Transcript、reasoning、工具卡片和 PromptInput。
2. 迁移 PermissionPrompt、QuestionPrompt、ModelPicker、SessionPicker。
3. 保留队列、中断、粘贴和斜杠命令。

验收：

- 主 Agent 和 Subagent Question 可以冒泡并回答。
- Permission once/always/reject 与当前安全语义一致。
- 长流式输出期间输入和 Dashboard 稳定。

### TUI-OT-60：接入真实多 Agent 编排

1. Core 增加结构化 OrchestrationEvent。
2. Worker、Supervisor、Loop、Agent Tree 接入真实事件。
3. 实现显式 pause/resume/cancel/request-supervisor command。
4. 后台 Worker 无交互阻塞时显示 checkpoint/paused，不永久挂起。

验收：

- 本地 Worker 和远程 Supervisor 可同时显示且使用不同 ModelTarget。
- Supervisor 不可用时 UI 显示降级，不丢 Worker 状态。
- 权限、Question、checkpoint 状态可追踪。

### TUI-OT-70：稳定性与默认切换

1. 建立 PTY 快照、resize、长会话和并发 Worker 压测。
2. 记录帧耗时、全屏重绘、输入延迟和内存。
3. 修复阻塞问题后将 OpenTUI 设为默认。
4. 在本地终端、SSH、tmux、鼠标开启和鼠标关闭环境分别验收。
5. 保留 Ink 回退一个发布周期，之后再执行 `TUI-OT-80`。

验收：

- 流式输出期间无明显全屏闪烁。
- 500+ transcript 条目和 20 个 Worker 下仍可输入、滚动和切页。
- 鼠标点击、滚轮和键盘等价操作行为一致。
- SSH/tmux/禁用鼠标模式下全部核心功能可用。
- Ctrl+C、退出和异常退出后终端状态正确恢复。
- 默认切换后不存在功能倒退。

### TUI-OT-80：退役旧 Ink TUI

该任务只能在 OpenTUI 作为默认 TUI 稳定运行至少一个发布周期，并通过 `TUI-OT-70` 全部验收后开始。删除不是迁移前置任务，也不得为了减少维护成本提前执行。

处理原则：

1. 先删除旧入口和框架依赖，再删除确认无引用的文件。
2. 已迁移到 `packages/tui-opentui/` 的 Deepreef 业务语义继续保留；只删除旧 React/Ink 渲染实现。
3. Core、Shell、LoopEvent、Permission、Question、Session、Plugin、Memory、MCP 和 CLI pipe 模式不得随 Ink 删除。
4. 保留必要的迁移说明、Ralph/OpenTUI 许可证和历史设计文档。

删除范围：

- `packages/ink/`：删除 Deepreef 自维护 Ink fork。
- `packages/tui/`：删除已被 `packages/tui-opentui/` 完整替代的旧 Ink 组件、bridge、布局、诊断和测试。
- CLI 中 `DEEPREEF_TUI=ink` 分支、旧 Ink renderer 初始化和只服务 Ink 的终端恢复接线。
- workspace/package 配置中的 `@deepreef/ink` 依赖、构建项和只服务旧 TUI 的脚本。
- 只验证旧 Ink 渲染细节、旧 bridge 或旧组件结构的测试。

迁移后必须保留或移入共享包的内容：

- 与渲染框架无关的 transcript/store、hydration merge、delta batching 和事件适配逻辑。
- Permission、Question、Session、ModelTarget、Plugin、Memory、MCP 的业务协议。
- Pipe/非 TTY 输出、终端环境检测和通用剪贴板能力。
- 仍被 OpenTUI 使用的 Markdown、i18n、settings schema 和命令注册逻辑。

删除前门禁：

- OpenTUI 已作为默认入口稳定运行至少一个发布周期。
- 功能对照清单全部通过，不存在只能在 Ink 使用的功能。
- OpenTUI PTY、resize、鼠标、键盘、SSH、tmux、异常退出和长会话测试全部通过。
- `rg "@deepreef/ink|packages/ink|DEEPREEF_TUI=ink"` 仅剩历史文档或允许列表。
- 删除 Ink 后完整 typecheck、test、build 和 CLI smoke test 通过。

验收：

- workspace 不再构建、发布或依赖 `@deepreef/ink`。
- 默认 TUI、pipe 模式和 Core 行为无回归。
- 旧 Ink 代码不以“备用实现”形式长期残留。
- `DONE.md` 记录 Ink 退役范围、迁移结果和验证证据。

---

## 九、测试与验收矩阵

### 9.1 必须具备的 fixture

- 单 Worker 正常执行完成。
- 四个 Worker 并发，其中一个等待权限、一个失败。
- Worker 连续失败后请求 SupervisorAdvice 并继续。
- Supervisor 候选冷却、不可用和全部失败。
- Question 从 Subagent 冒泡到主 TUI。
- Session hydration 与 live delta 同时发生。
- checkpoint 保存后退出并恢复。
- Plugin、Memory、MCP 后台加载状态变化。

### 9.2 性能与稳定性指标

| 指标 | 目标 |
|---|---|
| 流式输出全屏可见闪烁 | 0 |
| 键盘输入 p95 延迟 | `< 50ms` |
| resize 后残留旧帧 | 0 |
| 20 Worker 状态更新时输入阻塞 | 不可感知 |
| 单 Worker 更新影响 | 仅相关行和摘要 |
| Overlay 快捷键穿透 | 0 |
| 鼠标/键盘行为不一致 | 0 |
| 鼠标关闭时不可达核心操作 | 0 |
| 退出后 raw mode/光标异常 | 0 |

### 9.3 行为边界验收

- 用户手动选择免费模型，TUI 不恢复 free-auto。
- TUI 不恢复自动推理强度。
- Supervisor 只指导，不执行工具。
- Worker 工具调用继续经过权限和验证。
- yolo 只能由用户显式开启并二次确认。
- Plugin、Memory 和 MCP 状态可见，但不能绕过 Core 生命周期。

---

## 十、开发 Agent 执行规则

1. 开始每个任务前读取本方案、`TODO.md`、`ADVICE.md` 和相关 Ralph 源文件。
2. 能复制的 Ralph 纯组件必须复制并适配，不从头重写同等组件。
3. 每次复制必须记录来源文件、保留许可证说明并删除 Ralph 业务依赖。
4. 不得把 `RunApp.tsx` 拆碎后伪装成复制；它不是可接受基础。
5. 不得为了演示页面伪造真实运行状态；未实现的 Core 状态使用明确 fixture。
6. 每个阶段独立提交，附测试、截图或 PTY 录制证据。
7. 未达到 `TUI-OT-70` 验收前，不删除 `packages/tui/` 或 `packages/ink/`。
8. 遇到 OpenTUI 能力或版本问题，先做最小复现，不在业务组件里堆兼容补丁。
9. 鼠标交互不得成为核心功能的唯一入口；必须同时实现并测试键盘等价操作。
10. 未满足 `TUI-OT-80` 删除门禁时，不得提前删除或停止维护旧 Ink 回退路径。

---

## 十一、完成定义

本方案完成时，Deepreef 应具备：

1. 基于 OpenTUI React 的稳定新 TUI。
2. Ralph 风格的清晰面板、状态图标、详情页和 Agent Tree。
3. 固定可见的 Local Workers、Supervisor、Loop State 三栏总览。
4. 多 Agent 编排结构化事件、细粒度 Store 和可重放状态。
5. Worker、Supervisor、Loop、Chat、System 页面。
6. Permission、Question、Session、Plugin、Memory、MCP 完整交互和状态展示。
7. 长会话、多 Worker、resize 和流式输出场景下无明显闪烁。
8. TUI 只负责可视化与显式命令，所有编排和安全决策仍由 Deepreef Core 负责。
9. 鼠标可完成常用导航和操作，键盘可以完成全部核心操作。
10. OpenTUI 稳定运行并通过退役门禁后，旧 Ink 框架和渲染实现被完整删除。

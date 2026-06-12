# Deepreef Ink 多 Agent 可视化修复与集成开发方案

状态：`Needs implementation`
最后更新：2026-06-12
目标读者：接手 Deepreef TUI 修复、集成和验收的全新开发 Agent

> 文件名仅为兼容历史链接而保留。Deepreef 不再使用 OpenTUI。
> 当前任务不是继续创建孤立 UI 组件，而是将现有 Gemini CLI 风格组件接入真实数据流、主布局和交互链路，并完成可复现验收。

参考项目与代码：

- Gemini CLI UI：`/vol4/Agent/gemini-cli/packages/cli/src/ui/`
- Deepreef Ink：`/vol4/Agent/deepreef/packages/ink/`
- Deepreef TUI：`/vol4/Agent/deepreef/packages/tui/`
- Deepreef Core 事件协议：`packages/core/src/interface.ts`
- TUI Bridge：`packages/tui/src/bridge.tsx`
- TUI 主界面：`packages/tui/src/App.tsx`

关联文档：

- [Deepreef项目设计文档.md](Deepreef项目设计文档.md)
- [TODO.md](TODO.md)
- [DONE.md](DONE.md)
- [ADVICE.md](ADVICE.md)

---

## 一、审核结论

此前 TUI-GM 工作完成了 OpenTUI 清理，并添加了一批 Gemini CLI 风格主题和组件文件，但多数能力没有进入真实运行路径。

当前不能将 TUI-GM-10～80 视为已完成。新 Agent 必须以代码和端到端行为为准，不得依据 `DONE.md` 中的历史完成标记跳过验收。

### 1.1 当前已完成且无需重复开发

- OpenTUI 失败原型、运行分支和依赖已清理。
- 默认 TUI 继续使用 `@deepreef/ink`。
- `packages/tui/src/theme/` 已存在主题模型、语义色、ThemeManager 和内置主题文件。
- 已存在以下待集成组件：
  - `OrchestrationSummary`
  - `AgentGroupDisplay`
  - `AgentProgressDisplay`
  - `WorkerActivityPanel`
  - `DialogManager`
  - `VirtualizedTranscript`
  - `GradientSpinner`
  - `RespondingSpinner`
  - `LoadingIndicator`
  - `ThemedGradient`
- Core 已定义 `LoopEvent.role === "orchestration"` 和 `OrchestrationEventPayload` 类型。

不要重新复制上述文件。应先阅读、修复并适配现有实现；只有确认现有实现不可用时，才从 Gemini CLI 原代码重新复制对应部分。

### 1.2 当前主要问题

1. `App.tsx` 中的三栏总览使用固定空数据：

   ```tsx
   <OrchestrationSummary
     workers={[]}
     supervisors={[]}
     loopPhase="observe"
   />
   ```

2. `packages/tui/src/bridge.tsx` 明确忽略 `orchestration` 事件。
3. Core 中虽然定义编排事件类型，但尚未形成完整、可验证的事件生产链。
4. `DialogManager`、`AgentGroupDisplay`、`AgentProgressDisplay`、`WorkerActivityPanel`、`VirtualizedTranscript` 没有接入主界面。
5. `WorkerActivityPanel` 声明暂停、恢复和取消回调，但没有调用这些回调的操作入口。
6. ThemeManager 没有 `/theme` 菜单，现有主要 TUI 组件也没有统一迁移到语义颜色。
7. `VirtualizedTranscript` 按条目数量而不是实际渲染高度计算窗口，且没有接入现有 `ScrollBox`。
8. 动画缺少终端失焦、不可见、低动画、测试模式和 `NO_COLOR` 降频或停止机制。
9. 没有针对新增 TUI-GM 组件、数据流、PTY、resize、并发 Worker 和闪烁的测试。

### 1.3 当前验证基线

审核时结果：

- `bun run typecheck`：通过。
- `bun test packages/tui/__tests__`：69 pass / 0 fail。
- 上述 69 个测试没有覆盖新增 TUI-GM 组件和多 Agent 数据流。

---

## 二、架构边界

### 2.1 必须保留

- 渲染引擎：`@deepreef/ink`。
- Core 与 TUI 通过 `AsyncGenerator<LoopEvent>` 解耦。
- Permission、Question、Session、Plugin、Memory、MCP 和工具执行均以 Core 为唯一业务来源。
- TUI 只展示状态和发送显式命令，不建立第二套 Agent 编排系统。
- 用户必须可用键盘完成所有核心操作；鼠标作为等价增强。

### 2.2 禁止事项

- 不恢复 OpenTUI。
- 不切换到 `@jrichman/ink`。
- 不复制 Gemini Auth、Provider、Session、Agent Registry 或 ShellExecutionService。
- 不在 TUI 中推断 Worker、Supervisor 或 Loop 的真实状态。
- 不用 Demo、固定空数组、假 Worker 或硬编码 phase 作为完成证据。
- 不建立绕过 `LoopEvent` 的 Core 到 TUI 私有回调。
- 不在组件内直接持有或订阅 Worker runtime。
- 不恢复 free-auto 或自动推理强度。

### 2.3 数据流目标

```text
Core / Orchestrator
  → LoopEvent { role: "orchestration", orchestration: payload }
  → TUI Bridge adapter
  → OrchestrationStore
  → focused subscriptions
  → OrchestrationSummary / AgentGroupDisplay / WorkerActivityPanel
```

主界面不得直接读取 Core 内部 Map，也不得把所有编排状态塞入巨型 App props。

---

## 三、目标界面

默认布局仍是聊天式编码界面，多 Agent 信息作为持续可见的紧凑状态层：

```text
┌ Deepreef · session · repo · permission · provider/model ──────────┐
├ Local Workers ─────┬ Supervisor ───────┬ Loop State ──────────────┤
│ qwen-small running │ deepseek reviewing│ act · attempt 2          │
│ mimo-small paused  │                   │ verification-failed      │
├────────────────────┴───────────────────┴───────────────────────────┤
│ Chat transcript / Agent activity / selected Worker detail         │
├────────────────────────────────────────────────────────────────────┤
│ permission / question / notifications                             │
│ composer / loading indicator / status row                         │
└────────────────────────────────────────────────────────────────────┘
```

响应式要求：

| 终端宽度 | 行为 |
|---|---|
| `>= 140` | 三栏完整总览，可显示 Worker 详情面板 |
| `100-139` | 三栏总览与单栏主内容 |
| `80-99` | 每栏一行摘要，详情按键进入 |
| `< 80` | 总览折叠为单行，不得挤坏输入区 |

窄屏仍必须显示活动 Worker 数、Supervisor 状态、Loop phase、权限模式和阻塞状态。

---

## 四、统一状态模型

### 4.1 新增 OrchestrationStore

在 `packages/tui/src/store/` 中新增独立 Store。可以复用当前 `SubscribeStore` 模式，不得复制 Gemini 巨型 Context。

建议状态：

```ts
interface OrchestrationState {
  workers: ReadonlyMap<string, WorkerSnapshot>
  supervisors: ReadonlyMap<string, SupervisorSnapshot>
  loop: {
    phase: LoopPhase
    attempt: number
    lastSignal?: RuntimeSignal
  }
  agentTree: ReadonlyMap<string, AgentTreeNode>
  activities: ReadonlyMap<string, readonly AgentActivityEvent[]>
  lastCheckpoint?: CheckpointSnapshot
}
```

要求：

- 使用稳定实体 ID。
- `worker_upsert` 和 `supervisor_upsert` 必须是幂等更新。
- `worker_remove` 必须清理对应临时活动。
- 对每个 Agent 的活动保留有界历史，避免长会话无限增长。
- 单个 Worker 更新不得导致全部 transcript 重建。
- Session 切换和 Bridge reset 必须重置对应 Store。

### 4.2 Core 事件生产

Core 必须在真实生命周期节点产出结构化事件：

- Worker 创建、状态变化、完成、失败、取消和移除。
- Worker 等待 Permission、Question 或 Supervisor。
- Supervisor 排队、审查、建议、冷却、不可用和失败。
- Loop phase 转换、attempt 变化和 runtime signal。
- checkpoint 保存。
- Agent thought、工具开始、工具结束和状态变化。

TUI 不得从普通 warning 文本解析这些状态。

### 4.3 Bridge 消费

删除 Bridge 中对 `orchestration` 的忽略逻辑，将 payload 交给 OrchestrationStore。

要求：

- 非法 payload 不能导致 TUI 崩溃，应记录诊断并忽略。
- Bridge 只负责事件适配，不实现业务状态机。
- 添加 replay 测试，证明同一事件序列可稳定恢复相同 Store 状态。

---

## 五、修复实施任务

以下任务按顺序执行。前置数据链未完成前，不要继续扩充视觉组件。

### TUI-FIX-00：建立真实完成基线

开发内容：

- 将 `DONE.md` 中 TUI-GM-10～80 的状态改为历史实现记录或部分完成，不再宣称完整验收。
- 记录当前可复用文件和未接线能力。
- 为后续每个阶段建立独立测试命令和验收记录。

验收：

- 文档与当前代码状态一致。
- 不再出现“文件存在即功能完成”的验收方式。

### TUI-FIX-10：接通 Core 编排事件

开发内容：

- 审核并补齐 `OrchestrationEventPayload`。
- 在 Worker、Subagent、Supervisor、Loop 和 checkpoint 的真实生命周期节点产出事件。
- 不重复建立新的并行事件协议。
- 为事件生产添加 Core 单元测试。

验收：

- 真实运行一次多 Agent 流程可观察到 Worker 和 Loop 状态事件。
- Supervisor 未配置时不得产生虚假 Supervisor 候选。
- 事件中的敏感数据不得泄漏到 TUI。

### TUI-FIX-20：实现 OrchestrationStore 与 Bridge adapter

开发内容：

- 新增 `orchestration-store.ts` 和必要类型适配器。
- Bridge 消费 `orchestration` 事件并更新 Store。
- 实现 reset、Session 切换、事件 replay 和有界活动历史。
- 组件通过 focused subscription 获取状态。

验收：

- Bridge 不再忽略 `orchestration`。
- Store replay 测试覆盖 Worker、Supervisor、Loop、活动和 checkpoint。
- 单个 Worker 更新只通知相关订阅者。

### TUI-FIX-30：修复并接入三栏总览

开发内容：

- 删除 `App.tsx` 中固定空数组和固定 `observe`。
- `OrchestrationSummary` 读取真实 Store。
- 实现折叠、展开和响应式布局。
- 增加键盘和鼠标等价交互。
- 没有活动 Worker 时保持紧凑，不长期占据大块聊天空间。

验收：

- 0、1、4、20 个 Worker 状态正确显示。
- Supervisor 只展示用户显式配置且真实存在的候选。
- Loop phase、attempt 和 runtime signal 来自 Core 事件。
- `< 80` 列终端下输入区仍可用。

### TUI-FIX-40：接入 Agent 活动和 Worker 面板

开发内容：

- 将 `AgentGroupDisplay` 和 `AgentProgressDisplay` 接入聊天时间线或详情区域。
- 将 `WorkerActivityPanel` 接入可进入的详情视图。
- 为暂停、恢复和取消添加真实操作入口。
- 取消和其他危险操作必须二次确认。
- 所有命令经过 Core 权限和 Worker 生命周期接口。
- 增加鼠标点击、键盘导航、焦点和返回逻辑。

验收：

- Worker 状态、最近 thought、工具活动和结果来自结构化事件。
- 暂停、恢复和取消回调被真实调用并改变 Core 状态。
- 后台 Worker 不阻塞主输入。
- 等待 Question 或 Permission 的 Worker 不会永久挂起。

### TUI-FIX-50：完成 DialogManager 集成

开发内容：

- 用 `DialogManager` 集中管理互斥 Overlay。
- 纳入 Permission、Question、危险操作确认、Model、Agent、Session、Theme、Context、Skill 和 Help。
- 删除 App 中可被 DialogManager 替代的分散 early return。
- 保持 Core Promise 生命周期和 Bridge 回复行为。

优先级：

```text
Permission
  → Question
  → 危险操作确认
  → Model / Agent / Session
  → Theme / Context / Skill / Help
```

验收：

- Dialog 打开时底层输入和快捷键不穿透。
- Permission 与 Question 同时存在时优先级正确。
- Esc、Ctrl+C、退出、Session 切换和中断能清理 pending 状态。

### TUI-FIX-60：完成主题与动画集成

开发内容：

- 新增 `/theme` 选择菜单，并持久化用户选择。
- 将主布局、聊天、工具、Dialog、状态栏和多 Agent 组件迁移到语义颜色。
- 保留 No Color 和 ANSI 降级。
- 动画在不可见、终端失焦、低动画、测试模式和 `NO_COLOR` 下暂停或降频。
- Spinner 只更新自身，不触发 App 全树高频重绘。

验收：

- 主题切换无需重启。
- 深色、浅色和 No Color 下状态均可区分。
- 无 `/theme` 时不得将主题系统标记为完整可用。
- 终端失焦或低动画模式下没有持续 33fps 刷新。

### TUI-FIX-70：修复长会话虚拟化

现有 `VirtualizedTranscript` 只能作为原型，不得直接按完成验收。

开发内容：

- 基于 Deepreef `ScrollBox` 和真实渲染高度实现虚拟窗口。
- 支持动态高度、anchor、sticky bottom 和用户离底状态。
- hydration 不得覆盖 live delta。
- 鼠标滚轮只影响当前聚焦面板。
- resize 后重新测量，不保留旧帧。

验收：

- 500+ transcript 条目下可流畅输入和滚动。
- 多行 Markdown、工具卡片和展开 Agent 活动不会破坏 anchor。
- 用户手动离底后，流式输出不自动拉回。
- resize 后没有旧帧残留。

### TUI-FIX-80：稳定性、性能与真实完成验收

开发内容：

- 为所有新增组件添加组件测试或可重复渲染测试。
- 新增 Store replay、Bridge adapter、Dialog 优先级和交互测试。
- 新增 PTY、resize、长会话和并发 Worker 测试。
- 使用现有 FrameEvent/诊断能力检测全屏闪烁和高频重绘。
- 在本地终端、SSH、tmux、鼠标开启/关闭、No Color 和浅色主题下人工验收。

验收：

- `bun run typecheck` 通过。
- TUI 聚焦测试通过并明确覆盖 TUI-FIX 功能。
- 全量测试结果如实记录。
- `git diff --check` 通过。
- 提供截图或 PTY 录制，证明真实 Worker、Supervisor 和 Loop 状态可见。
- 不允许使用固定 fixture 或空数组作为最终集成证据。

---

## 六、组件修复要求

### 6.1 OrchestrationSummary

- 不得依赖 App 传入固定值。
- 支持紧凑折叠态。
- 支持 Worker、Supervisor 和 Loop 分区聚焦。
- No Color 下使用文本和符号区分状态，不能只依赖颜色。

### 6.2 AgentGroupDisplay / AgentProgressDisplay

- 接入真实活动事件。
- 活动列表必须有界。
- 大量 Worker 时只渲染可见活动。
- 图标与 Unicode 宽度必须在中文终端正确布局。

### 6.3 WorkerActivityPanel

- 当前声明但未使用的 `onPauseWorker`、`onResumeWorker`、`onCancelWorker` 必须接入真实交互。
- Worker 列表变化时修正 `selectedIndex`，避免越界。
- 支持键盘和鼠标选择。
- 输出区域必须支持独立滚动。

### 6.4 DialogManager

- `dialog-store` 必须返回真实快照，不能返回始终为空的伪快照。
- Dialog 状态与 Bridge Permission/Question 状态必须保持一致。
- Dialog 关闭不得丢失或绕过 Core 回复。

### 6.5 VirtualizedTranscript

- 不以“消息数量约等于行数”为假设。
- 不抢占全局 `useInput`；只有聚焦时处理滚动按键。
- 不重复实现现有 `ScrollBox` 已具备的能力。

### 6.6 LoadingIndicator 与 Spinner

- Loading 状态必须订阅真实 Bridge 状态。
- elapsed time 必须来自真实开始时间，不固定为 0。
- Esc 提示必须与实际取消行为一致。
- 非活动状态不得保留定时器。

---

## 七、测试矩阵

### 7.1 数据流测试

1. Worker 创建、运行、等待权限、验证、完成。
2. Worker 失败后请求 Supervisor 建议并继续。
3. Supervisor 冷却、不可用和全部失败。
4. Loop phase 与 attempt 转换。
5. checkpoint 保存和 Session 恢复。
6. 非法编排事件被安全忽略并记录诊断。

### 7.2 交互测试

1. 三栏折叠、展开、聚焦和详情进入。
2. Worker 暂停、恢复和取消。
3. 危险取消二次确认。
4. Permission 与 Question 优先级。
5. Dialog 打开时输入不穿透。
6. 鼠标关闭时所有核心操作仍可达。
7. `/theme` 菜单切换和持久化。

### 7.3 稳定性测试

1. 500+ transcript 条目。
2. 20 个 Worker 高频状态更新。
3. 长时间流式输出。
4. resize、SSH 和 tmux。
5. Session hydration 与 live delta 同时发生。
6. No Color、浅色主题和低动画模式。
7. Ctrl+C、异常退出和终端恢复。

性能目标：

| 指标 | 目标 |
|---|---|
| 流式输出全屏可见闪烁 | 0 |
| 键盘输入 p95 延迟 | `< 50ms` |
| resize 后残留旧帧 | 0 |
| 20 Worker 更新时输入阻塞 | 不可感知 |
| Dialog 快捷键穿透 | 0 |
| 退出后 raw mode 或光标异常 | 0 |

---

## 八、开发顺序

固定顺序：

```text
TUI-FIX-00
  → TUI-FIX-10
  → TUI-FIX-20
  → TUI-FIX-30
  → TUI-FIX-40 / TUI-FIX-50
  → TUI-FIX-60
  → TUI-FIX-70
  → TUI-FIX-80
```

理由：

- 没有 Core 事件和 Store，视觉组件只能继续展示假数据。
- 没有主布局和 Dialog 接线，新增组件文件没有产品价值。
- 没有真实数据和交互，稳定性 benchmark 没有验收意义。

---

## 九、完成报告格式

每个任务进入 DONE 前，开发 Agent 必须提交：

```text
任务 ID：
修改文件：
复用或复制来源：
真实数据来源：
主界面接线位置：
新增测试：
测试命令与真实结果：
人工验收证据：
仍存在的问题：
```

禁止使用以下表述作为完成依据：

- “组件文件已创建。”
- “typecheck 通过，所以功能完成。”
- “空状态可以显示。”
- “TODO/DONE 已标记完成。”
- “测试总数很多。”

只有真实运行路径、用户可达交互和对应测试同时成立，任务才能标记完成。

---

## 十、最终完成定义

本方案完成时，Deepreef 必须具备：

1. 基于 `@deepreef/ink` 的单一稳定 TUI。
2. 真实可见的 Local Workers、Supervisor 和 Loop State。
3. 可操作的 Worker 详情、暂停、恢复和取消流程。
4. 集中的 DialogManager，且 Permission/Question 生命周期无回归。
5. 可选择并持久化的 Gemini 风格语义主题。
6. 动画具有 No Color、低动画、失焦和不可见降级。
7. 长会话和多 Worker 下稳定的虚拟化与滚动。
8. 鼠标可完成常用操作，键盘可完成全部核心操作。
9. Core、权限、Question、Session、Plugin、Memory、MCP 和安全边界未被破坏。
10. 完成状态由真实端到端行为和测试证明，而不是由组件文件数量或文档标记证明。

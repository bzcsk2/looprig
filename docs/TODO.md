# Deepreef 当前开发 TODO

最后整理：2026-06-13

本文只保留尚未完成、待人工验收或明确暂缓的工作。

- 已完成能力、历史实施记录和验证结果见 [DONE.md](DONE.md)。
- 当前架构方案见 [Deepreef项目设计文档.md](Deepreef项目设计文档.md)。
- 开发审核意见与领取限制见 [ADVICE.md](ADVICE.md)。
- 历史融合方案讨论见 [Deepreef后续开发计划.md](Deepreef后续开发计划.md)。

---

## 0. 当前状态

当前开发主线：

> 修复并接通已经创建但仍处于独立骨架状态的双角色模块，将现有 Build/Plan 单引擎主路径真正升级为永久 Worker/Supervisor 双角色运行时。

固定领取顺序：

```text
DA-R0 基线与完成状态纠正
  → DA-R1 Agent Profile 加固
  → DA-R2 CapabilityCatalog 接线与 Supervisor 强制只读
  → DA-R3 复用现有执行循环接通双 Runtime
  → DA-R4 收敛并接通唯一 WorkflowCoordinator
  → DA-R5 双角色 Session 安全与恢复接线
  → DA-R6 TUI 双角色交互接线
  → DA-R7 旧主路径迁移、端到端验收与发布门禁
```

| 顺序 | 任务 | 优先级 | 依赖 | 状态 |
|---|---|---|---|---|
| 1 | `DA-R0` 基线、失败测试与完成状态纠正 | P0 | 无 | ✅ |
| 2 | `DA-R1` Agent Profile 严格校验与安全迁移 | P0 | DA-R0 | ✅ |
| 3 | `DA-R2` CapabilityCatalog 接线与角色安全边界 | P0 | DA-R1 | ✅ |
| 4 | `DA-R3` 双 Runtime 真实执行能力与主路径接线 | P0 | DA-R2 | ✅ |
| 5 | `DA-R4` 唯一 WorkflowCoordinator 与治理闭环 | P0 | DA-R3 | ✅ |
| 6 | `DA-R5` 双角色 Session 安全持久化与恢复 | P1 | DA-R4 | ✅ |
| 7 | `DA-R6` TUI 双角色交互和状态栏真实接线 | P1 | DA-R5 | ⏳ |
| 8 | `DA-R7` 旧路径迁移、端到端测试与发布门禁 | P1 | DA-R6 | ⏳ |

审查后的原任务状态：

| 原任务 | 当前真实状态 | 不得宣称完成的原因 |
|---|---|---|
| `DA-00` | 部分完成 | Schema、迁移和保存边界仍不严格 |
| `DA-10` | 部分完成 | 未接入启动链路，Supervisor 只读未强制 |
| `DA-20` | 骨架 | 空 API 参数、无工具循环、未接入主路径 |
| `DA-30` | 骨架 | 未执行合法转换、计划、验证门和轮次约束 |
| `DA-40` | 骨架 | 独立存储未接线，写入和路径处理不安全 |
| `DA-50` | 组件骨架 | 新组件未渲染到 `App.tsx`，测试未覆盖真实组件 |
| `DA-60` | 未完成 | `ReasonixEngine.currentAgent` 仍驱动生产主路径 |

---

## 1. 开发规则

### 1.1 每次只领取一个闭环

1. 按固定顺序领取任务，不跨阶段并行修改相同运行时边界。
2. 先阅读目标文件、邻近测试、设计文档和 `ADVICE.md`。
3. 优先复制、抽取和适配 Deepreef 已有实现，不重新实现第二套 Context、Session、ToolRegistry、PluginRuntime、McpHost 或 TUI 框架。
4. 先补失败测试，再做最小实现。
5. 完成后从本文删除对应任务，在 `DONE.md` 写入实际修改、接线位置、验证命令和保留限制。

### 1.2 不可破坏的边界

| 边界 | 必须保持 |
|---|---|
| Core/TUI | Core 只通过结构化事件向 TUI 暴露状态，不 import React/Ink |
| 双角色 | Worker/Supervisor 拥有独立上下文和配置，不使用单一 `currentAgent` 切换伪装 |
| 工具执行 | Worker 继续走 StreamingToolExecutor、PermissionEngine、Harness 和 Verification Gate |
| Supervisor | 只读、只规划检查、只返回结构化 Advice，不能执行写工具 |
| Plugin/MCP | 底层只加载一次，通过角色能力视图过滤暴露 |
| 模型控制 | 用户明确选择 Provider/model/thinking；不得自动切换 |
| 免费模型 | 不恢复 `free-auto`，不自动切换到其他免费或付费模型 |
| 缓存 | Evidence、Advice、TaskLedger 和运行态进入可变上下文 |
| Workflow | 默认最多 9 轮；达到上限必须阻塞并请求用户 |
| TUI | Workflow 状态栏固定在输入框正上方，不放入滚动区或屏幕顶部 |

### 1.3 统一验证门禁

```bash
bun run typecheck
bun test
git diff --check
```

涉及远程模型时必须提供默认跳过的显式 smoke test，CI 不依赖免费接口稳定性。

---

## 2. 审查后修复与接线计划

本节是当前唯一可领取的双角色开发清单。已落地部分和历史目标规格见 `DONE.md`、设计文档与 Git 历史。

### DA-R0：建立真实基线与失败测试

- 将 `CodeReviewReport.md` 仅作为线索使用，不沿用其中"DA-00 至 DA-50 已完成"的判断。
- 为以下缺陷先增加能够失败的测试：空模型参数、真实流事件、工具调用、Supervisor 写工具、非法 Workflow 转换、9 轮上限、Session 路径穿越、真实 TUI 组件未接线。
- 测试必须 import 和执行生产实现；禁止在测试文件中重新实现 `buildPhaseChain`、状态映射或权限判断后只测试副本。
- 记录当前全仓测试中的预置失败；不得把无关失败伪装成本任务回归。

**验收：新增测试在修复前能够证明缺陷，且任务状态不再以"存在文件/导出符号"为完成依据。**

**真实缺陷发现（7 个失败测试）：**

1. **Agent Profile 缺陷**：
   - 接受未知字段（应该拒绝） - `validateAgentProfiles` 没有启用严格校验
   - 不强制角色字段匹配 - `worker.role` 可以是 "supervisor"

2. **CapabilityCatalog 缺陷**：
   - `RoleCapabilityView` 没有强制 Supervisor 只读
   - Supervisor 可以通过配置允许写工具

3. **DualAgentRuntime 缺陷**：
   - 配置参数不完整（缺少 `maxWorkflowRounds`）
   - 空模型参数被接受

4. **WorkflowCoordinator 缺陷**：
   - `transition` 方法不返回 `success` 属性
   - 9 轮上限没有被正确执行
   - 非法转换没有被拒绝

5. **DualSession 缺陷**：
   - 路径穿越没有被拒绝
   - `DualSessionStore.save` 接受恶意路径

### DA-R1：Agent Profile 严格校验与安全迁移

- 为 Agent Profile 顶层和嵌套对象启用 Zod 严格校验，拒绝未知字段。
- 强制 `worker.role === "worker"`、`supervisor.role === "supervisor"`。
- 保存前执行同一 Schema 校验；非法配置不得落盘。
- `contextWindow` 和 `maxTokens` 按对应 `ModelTarget` 能力 clamp，并产生诊断。
- 修复默认配置浅复制污染；迁移和读取返回深层独立对象。
- 从真实旧配置来源迁移 harness、thinking、skills 等字段；迁移必须幂等且不写 API Key。

验收：覆盖未知字段、角色错配、超限窗口、重复迁移、默认对象不被修改和非法保存拒绝。

### DA-R2：CapabilityCatalog 接线与 Supervisor 强制只读

- 将 CapabilityCatalog 接入 CLI/Engine 的真实 Plugin、MCP、Skill 和 builtin tool 启动链路；底层能力只初始化一次。
- 不再仅靠工具名称猜测安全级别。优先使用显式 capability metadata；没有 metadata 的工具默认按更危险等级处理。
- RoleCapabilityView 同时过滤 Tool、Plugin、MCP server 和 Skill，而不只是工具数组。
- Supervisor 在 Schema 和 Runtime 两层强制只读；即使配置 allow 写工具，也必须拒绝 write、patch、exec、危险 shell 和权限 bypass。
- 删除或改写“Supervisor 可以配置写工具”和“没有 deny 就允许全部工具”的现有错误测试。
- Hook 和能力快照携带 role/workflow metadata。

验收：同一 Plugin/MCP 不重复启动；Supervisor 无法通过配置、别名工具或名称误分类获得写能力。

### DA-R3：复用现有执行循环接通双 Runtime

- 禁止在 `AgentRuntime.submit()` 中复制实现第二套简化工具循环。
- 从现有 `ReasonixEngine.submit()`、`runLoop`、`StreamingToolExecutor`、PermissionEngine、Harness、Verification Gate 和 Session 入口抽取可复用的角色运行内核，或让 AgentRuntime 委托现有内核。
- 从角色 Profile 和 ModelTarget resolver 获取真实 client、provider、model、thinking、temperature、maxTokens 和 contextWindow；删除空 API 参数及硬编码 `"default"`。
- 正确消费现有 ChatClient 的真实流事件，包括 delta、final、usage、tool call、错误和取消。
- system prompt 必须进入角色独立 ImmutablePrefix；两个角色拥有独立 ContextManager 和历史。
- 修复 `reset()` 未清 Context、interrupt signal 未传递、cancelled 被 completed 覆盖、stats 不更新等问题。
- `DualAgentRuntime` 不再维护与 WorkflowCoordinator 重复的工作流状态，只负责两个长期角色的生命周期和路由。

验收：Worker 能真实执行工具并经过权限/Harness/Verification；Supervisor 只能产生文本与结构化 Advice；中断一方不影响另一方。

### DA-R4：唯一 WorkflowCoordinator 与治理闭环

- WorkflowCoordinator 成为唯一工作流状态机；删除 DualAgentRuntime 内重复的 phase/iteration 状态。
- 明确定义并强制合法转换；非法转换返回结构化错误，不修改状态。
- 实际执行 `requireSupervisorPlan`、`requireVerificationGate`、`maxRounds` 和 `StartWorkflowOptions.config`。
- 串联现有 TaskLedger、EvidenceBundle、Verification Gate 和 SupervisorAdvice；提供记录/更新 evidence 的明确入口。
- 每次 TaskLedger 变化递增 `ledgerVersion`；Advice 仅在版本匹配和 Worker 安全点采用。
- checkpoint 保存 evidence、advice、phase、iteration、ledgerVersion 和阻塞原因。
- 不修改调用者传入的 Advice 对象。
- 9 轮上限、无进展、预算耗尽和角色不可用必须进入 blocked/ask_user。

验收：覆盖完整成功、revise、stale advice、非法转换、验证失败、Supervisor 不可用、9 轮阻塞和恢复。

### DA-R5：双角色 Session 安全持久化与恢复

- 优先扩展并复用现有 Session JSONL/checkpoint 基础设施；不得长期保留互不相识的第二套 Session 真相源。
- 持久化 Worker/Supervisor 独立消息、角色配置引用、Workflow checkpoint、TaskLedger、Evidence 和 Advice 采用结果。
- 改为 best-effort 原子写入或复用现有异步 SessionWriter；不得在主执行路径同步整文件写入。
- 校验 sessionId，拒绝绝对路径、`..`、分隔符和目录逃逸；删除操作必须限定在 session 根目录内。
- snapshot、restore 和对外读取不得暴露可修改内部状态的浅复制。
- 恢复后不得重复执行工具或重复采用 Advice。

验收：覆盖路径穿越、损坏文件、四个 Workflow 阶段恢复、重复 Advice 防护和两个角色历史隔离。

### DA-R6：TUI 双角色交互和状态栏真实接线

- 将 `DualTabSystem` 和 `WorkflowStatusBar` 真正接入 `App.tsx`、bridge 和 Core 结构化事件。
- 两角色分别保存消息、草稿、滚动位置和滚动锁定状态；流式输出不能抢走正在查看历史的滚动位置。
- Tab 仅在没有补全、Question、Permission 和危险确认覆盖层时切换角色。
- WorkflowStatusBar 固定放在输入框正上方的 `bottomContent`，不得进入滚动区。
- 阶段链只显示批准布局中的 `analyse > do > report`；Supervisor check 可作为状态体现，不新增顶部阶段。
- 当前阶段必须在真实渲染中高亮；删除未使用 props、refs 和计算变量。
- 测试渲染真实组件并覆盖 App 集成、Tab 优先级、独立滚动和流式输出场景。

验收：用户可在 Worker 输出期间切换 Supervisor 对话，切回后消息、草稿和滚动位置均保持。

### DA-R7：旧路径迁移、端到端测试与发布门禁

- 主路径切换到双角色运行时后，再删除或降级 `currentAgent`、全局 thinkingMode、全局 activeSkills 和单一 sessionStrictness。
- `build/plan` 仅保留一个版本周期的读取迁移/命令提示适配器，不允许继续驱动生产执行。
- 删除新旧重复状态机、重复 Session 真相源和不再使用的骨架代码。
- 增加真实 Engine 端到端测试：角色配置加载 → Workflow → Worker 工具调用 → Supervisor Advice → 验证 → Session 恢复 → TUI 状态事件。
- 端到端矩阵覆盖：两角色不同配置、角色能力隔离、成功/修订/失败/恢复/9 轮阻塞、Tab 独立沟通、Supervisor 无写权限、重启恢复。
- 更新 `DONE.md` 时必须记录真实接线位置、验证命令和剩余限制；未通过端到端门禁不得标记 `DA-R7` 完成。

验收：通过本文件 1.3 门禁、上述端到端矩阵和真实双角色 smoke；旧单 Agent 主路径不再运行。

---

## 3. 待人工验收

### OS-12/13-R：macOS 与 Windows 原生体验

- 在真实 macOS/Windows 终端验证 PTY/ConPTY。
- 验证中文路径、通知、剪贴板和进程树终止。
- CI 自动化已覆盖基础行为，但不能替代真实终端验收。

### CTX-70：Context 长会话人工验收

- 验证长会话 trim/compact。
- 验证 summarizer fallback。
- 验证重启后配置持久化。

### 可选远程 Smoke

- 使用 `DEEPREEF_SUPERVISOR_SMOKE=1` 验证用户显式配置的免费 Supervisor。
- StepFun 候选通过真实 smoke 后才能启用。
- Smoke 失败不得阻塞本地 Worker 或触发自动模型切换。

---

## 4. 待项目负责人决定

进入对应修复阶段前必须确认或采用保守默认值：

1. **远程 Supervisor 隐私**：默认关闭；首次启用明确提示 Evidence 可能包含路径、错误日志和代码片段。
2. **付费 Oracle**：默认禁用；配置后仍需每次或每 Session 确认。
3. **Worker 默认模型**：不硬编码具体本地模型，通过 `worker.local` target 和 Profile 匹配。
4. **Supervisor 文件读取**：首版只接收有界 EvidenceBundle，不直接读取仓库。
5. **达到预算后的行为**：保存 checkpoint 后暂停并请求用户，不无人值守无限重试。

---

## 5. 明确暂缓

除非 Benchmark 或用户明确要求，不要顺手实现：

- 完整 iceCoder TaskGraph。
- L1/L2 Supervisor takeover/handoff 和自动权限提升。
- Supervisor 直接执行工具或修改文件。
- 自动调用付费模型。
- 免费接口并行竞速。
- 整仓复制 iceCoder 或 SmallCode。
- 替换 Deepreef Context、Session、MCP、Memory 或 TUI 架构。
- 为每个模型写大段独立 system prompt。
- 动态 Bash 并发判断、Python Kernel、Web/IDE 多前端和完整 OAuth MCP。

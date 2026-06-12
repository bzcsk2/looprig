# Deepreef 开发审核意见与下一步动作

> 更新日期：2026-06-12
> 本文用途：指导开发 Agent 完成下一阶段开发与验收。
> 本轮范围：Harness 三档严格度、融合功能运行时接线、此前 TODO 验收问题。TUI 暂不在本轮处理范围内。

---

## 一、审核结论

当前新增模块的单元测试质量尚可，但多个功能仍停留在“模块存在、测试通过”的阶段，没有真正接入 `ReasonixEngine` 的执行主链，因此不能按已完成功能验收。

本轮验证结果：

- `bun run typecheck`：通过。
- RM/QST/PERM/Core 聚焦测试：204 pass / 0 fail。
- 融合功能聚焦测试：164 pass / 0 fail。
- `git diff --check`：通过。
- 全量 `bun test`：2323 pass / 18 skip / 476 fail / 21 errors。
- 当前 benchmark 是确定性模拟器，不是真实模型与工具链验收。

开发 Agent 不得仅凭新增模块的单元测试通过就将任务标记为 DONE。必须提供运行时接线证据、端到端测试和全量测试结果。

### 当前可验收

- RM-20 核心部分。
- QST-10。
- PERM-10。
- DRF-10。
- DRF-31。

### 当前部分完成

- RM-10：缺少旧 `free-auto` 配置迁移处理。
- RM-30：Token 估算相关代码仍未完全删除。
- DRF-11、DRF-20、DRF-40、DRF-50、DRF-60：已有模块或测试，但运行时接线、策略落地或真实验收不完整。

### 当前不能验收

- DRF-30：Harness Profile 多数字段没有进入实际执行路径。
- DRF-32：默认 Bash 工具没有启用双轨 Shell。
- DRF-51：未显式配置 Supervisor 时仍会装载默认候选。
- DRF-70：融合组件没有在主链形成闭环。
- DRF-80：benchmark 使用硬编码结果模拟成功。

---

## 二、Harness 三档严格度设计

### 2.1 设计目标

新增用户可选择的 Harness 严格度：

```ts
export type HarnessStrictness = "strict" | "normal" | "loose"
```

三档严格度用于控制 Deepreef 对执行 Agent 的约束、纠错、检查和监督程度，使新增融合功能按档位分段开启或关闭。

严格度不等于模型能力，也不等于权限模式：

- 不得用严格度自动更换模型、Provider、温度或推理强度。
- 不得用 `loose` 绕过 PermissionEngine、危险命令拦截和敏感路径保护。
- Supervisor 只能使用用户显式配置的免费或便宜模型；严格度只决定何时寻求监督，不能决定偷偷使用哪个模型。
- `HarnessMode` 当前的 `free / adaptive / forced / strict` 与新严格度语义混杂，应逐步拆分，不能继续增加重叠含义。

### 2.2 配置来源与优先级

推荐支持以下配置入口：

```json
{
  "strictness": "normal",
  "modelOverrides": {
    "local/qwen-small": "strict"
  }
}
```

配置优先级：

1. 当前会话或 CLI 显式选择，例如 `--harness strict`。
2. 项目配置 `.deepreef/harness.json`。
3. 模型 Profile 推荐档位。
4. 默认使用 `normal`。

默认推荐：

- 未知本地模型、小模型：`strict`。
- 已适配的本地中型模型、免费模型、便宜远程模型：`normal`。
- `loose` 仅由用户显式选择，不自动启用。

最终策略生成顺序：

```text
模型能力基线
  → 用户严格度预设
  → 经校验的项目覆盖项
  → 最后强制应用不可绕过的安全底线
```

### 2.3 `/harness` 手动切换菜单

`/harness` 必须是用户可随时打开的选择菜单，用于查看当前有效档位并手动切换：

```text
Harness strictness

  strict   强约束，适合本地小模型和不稳定工具调用
› normal   默认，在可靠性与自主执行之间平衡
  loose    少干预，保留权限、安全和真实性底线

Current: normal
Source: project (.deepreef/harness.json)
Applies from: next submission
```

实现要求：

- 优先复制并适配项目中现有 `/model`、权限菜单或 Question/Select 组件，不得为 `/harness` 单独重写菜单框架。
- 打开菜单时必须显示当前有效档位、配置来源和简短差异说明。
- 支持键盘选择、确认和取消；取消不得修改任何状态。
- 选择后默认只切换当前会话，立即更新会话配置和状态栏可读状态。
- 提供明确的“设为项目默认”动作，将选择写入 `.deepreef/harness.json`；不得在普通切换时偷偷修改项目文件。
- 正在执行的提交不得热切换策略。用户切换后，新档位从下一次 `submit()` 开始生效。
- 切换必须生成审计事件，至少记录旧档位、新档位、来源、作用域和生效时间。
- 菜单只能修改 Harness 严格度，不得顺带修改模型、Provider、权限模式、温度或推理强度。
- 允许保留 `/harness strict|normal|loose` 作为脚本和熟练用户的快捷命令，但无参数 `/harness` 必须打开菜单。
- 如果项目默认值无效，菜单应展示回退后的有效档位和错误来源，不得静默显示错误值。

推荐命令行为：

| 命令 | 行为 |
|---|---|
| `/harness` | 打开三档选择菜单 |
| `/harness strict` | 将当前会话切换为 `strict` |
| `/harness normal` | 将当前会话切换为 `normal` |
| `/harness loose` | 将当前会话切换为 `loose` |
| `/harness status` | 显示当前有效档位、来源及关键策略摘要 |
| `/harness project strict\|normal\|loose` | 显式修改项目默认值 |

若当前任务仍在执行，菜单允许用户选择新档位，但必须明确提示“从下一次提交生效”，不能让同一次执行中的组件获得不一致策略。

### 2.4 不可绕过的安全底线

以下能力在三个档位中始终开启：

- PermissionEngine 和用户明确设置的权限规则。
- 危险 Shell 命令拦截。
- 敏感路径保护。
- stale-read 检测，避免基于旧内容覆盖文件。
- 截断写入和明显损坏写入的拒绝机制。
- 用户中断、会话恢复和最低限度 Checkpoint。
- 硬性最大轮数，防止无限循环。
- Hooks 和审计事件。
- 未显式配置 Supervisor 时不得发起 Supervisor 请求。

`loose` 的含义是减少过程干预，不是关闭安全系统。

### 2.5 不要继续堆积布尔字段

现有 `HarnessProfile` 包含大量布尔值，继续扩展会导致组合不可控。下一步应引入结构化的最终策略：

```ts
interface EffectiveHarnessPolicy {
  strictness: HarnessStrictness
  source: "session" | "project" | "model-profile" | "default"

  toolset: ToolsetSize
  maxParallelTools: number
  maxTurns: number

  readBeforeWrite: "block" | "warn" | "off"
  textToolSalvage: "always" | "on-native-failure" | "off"
  branchBudget: "enforce" | "recover" | "observe"
  checkpoint: "frequent" | "safe-point" | "minimal"
  verification: "block" | "require-or-waive" | "warn"
  earlyStop: "aggressive" | "standard" | "critical-only"
  toolRouting: "two-stage" | "auto" | "direct"
  executionMode: "forced" | "adaptive" | "free"
  shellPolicy: "dual-track-conservative" | "dual-track"
  supervisorPolicy: "on-failure" | "critical-only" | "off"
}
```

可以暂时保留现有字段并提供兼容适配器，但运行时只能消费一份不可变的 `EffectiveHarnessPolicy`，不得让各模块自行再次解释档位。

---

## 三、三档功能开关矩阵

| 能力 | strict | normal | loose |
|---|---|---|---|
| 适用场景 | 小型、本地、工具调用不稳定模型 | 默认；已适配便宜模型和中型模型 | 用户明确选择的高自主模式 |
| Execution Mode | `forced` | `adaptive` | `free` |
| Toolset | `minimal/coding` | 按任务选择 `coding/full` | `full` |
| 最大并行工具数 | 1-2 | 3 | 5 |
| 建议最大轮数 | 30 | 50 | 80，仍受硬上限限制 |
| Read Before Write | 未读文件禁止写入 | 首次警告并要求读取 | 关闭过程约束，保留 stale-read 底线 |
| Text Tool Salvage | 始终开启 | 原生工具调用失败或模型可靠性不足时开启 | 默认关闭 |
| Branch Budget | 强制限制，超限后阻断并恢复 | 软限制，恢复失败后阻断 | 仅观测和记录 |
| Checkpoint | 写入、失败、监督建议后频繁保存 | 批量写入、失败和安全点保存 | 中断、退出和恢复所需的最小保存 |
| Verification Gate | 未验证不得声明完成 | 必须验证，或由用户明确豁免 | 给出未验证警告，不静默冒充成功 |
| Early Stop | 激进检测重复、空转和无进展 | 标准检测 | 只处理严重重复和硬上限 |
| Tool Routing | 小模型强制两阶段路由 | 超过 Schema/上下文阈值时自动两阶段 | 默认直接路由 |
| Shell | 保守双轨，长任务必须可查询和取消 | 双轨执行 | 双轨执行 |
| Supervisor | 失败时请求已配置 Supervisor | 多次失败或关键失败时请求 | 默认关闭，用户可显式请求 |
| Task Ledger | 编辑、调试、重构、测试任务始终开启 | 复杂任务开启 | 仅长任务或用户显式开启 |

### 档位行为补充

#### strict

- 面向小模型时，必须减少一次暴露的工具 Schema 和上下文噪声。
- 工具调用失败后，先通过 Salvage、工具结果反馈和 Supervisor 建议继续，而不是直接替换执行模型。
- Supervisor 给出建议后，仍由原执行 Agent 继续完成任务。
- 超出 Branch Budget、连续无进展或验证失败时，必须进入恢复流程。

#### normal

- 作为默认档位，在可靠性和自主性之间平衡。
- 允许模型先自主执行；检测到工具调用异常、上下文压力或重复失败后再升级约束。
- Supervisor 必须满足“用户已配置”和“触发条件成立”两个条件。

#### loose

- 减少强制流程，但保留审计、权限、安全和真实性约束。
- 不得因为 Verification Gate 变为警告，就允许 Agent 声称未执行的测试已经通过。
- 不得关闭 Shell 可取消能力、会话恢复和硬性循环上限。

---

## 四、必须采用的运行时架构

当前问题是 Profile 被解析后，只消费了少量字段。`ReasonixEngine.submit()` 必须成为策略接线入口：

```text
resolveHarnessStrictness()
  → resolveEffectiveHarnessPolicy()
  → 为本次 submit 固化不可变策略
  → 初始化并连接各 Harness 组件
  → 执行
  → Verification Gate
  → 保存结果和审计事件
```

以下组件必须在主链中被真实实例化并调用，而不是仅存在模块和单元测试：

- `ReadTracker`
- `EarlyStopDetector`
- `BranchBudgetTracker`
- `CheckpointEngine`
- `ModeDecisionEngine`
- `resolveToolRouting`
- Verification Gate
- 双轨 Shell 生命周期管理
- Supervisor Pool

每次提交开始时解析一次最终策略。执行中不得因模型输出而偷偷改变严格度；允许 `normal` 内部按既定策略触发恢复流程，但必须记录审计事件。

---

## 五、结合审核结果的下一步开发任务

### P0：先完成真实运行时接线

#### ADV-HAR-01：实现三档严格度解析器

开发内容：

- 新增 `HarnessStrictness`。
- 新增 `EffectiveHarnessPolicy`。
- 实现会话、项目、模型推荐和默认值的优先级。
- 实现 `/harness` 菜单、快捷命令和 `status` 查询。
- 复用现有命令菜单与 Question/Select 组件，不新增独立交互框架。
- 支持仅当前会话切换，以及用户显式选择后写入项目默认值。
- 将旧 Harness Profile 映射到新策略，保留兼容性。
- 未知本地模型默认 `strict`；其他未知模型默认 `normal`。

验收：

- 三档完整表格测试。
- 配置优先级测试。
- 非法配置回退测试。
- `/harness` 菜单确认、取消、会话切换和项目持久化测试。
- 执行中切换只影响下一次提交的测试。
- 证明严格度不会改变模型、Provider 和推理强度。

#### ADV-HAR-02：在 Engine 中集中接线

开发内容：

- 在 `ReasonixEngine.submit()` 入口生成并固化最终策略。
- 连接 ReadTracker、EarlyStop、Branch Budget、Checkpoint、Mode Decision、Tool Routing 和 Verification Gate。
- 将策略传给工具执行层和 Shell 生命周期管理。
- 删除散落在模块内的重复默认值，避免同一档位出现不同行为。

验收：

- 使用 spy 或事件断言证明每个组件在主链中实际被调用。
- 不接受只测试策略解析器或单独组件。

#### ADV-HAR-03：修复 Shell 双轨未启用

审核发现：

- 默认工具仍调用无参数 `createBashTool()`，导致 `dualTrack` 默认关闭。

开发内容：

- 由 `EffectiveHarnessPolicy.shellPolicy` 创建 Bash 工具。
- 三档都保留可查询、可取消、可清理的双轨生命周期。
- `strict` 使用更保守的前后台分类和更严格的残留进程清理。

验收：

- 长命令进入后台后可查询、可取消。
- 会话结束后没有残留进程。
- 前台短命令行为不回归。

#### ADV-HAR-04：修复 Supervisor 显式配置原则

审核发现：

- `SupervisorPool` 当前会在无配置或无效配置时装载默认 Zen/Mimo 候选。
- `model-target.ts` 存在 `supervisor.zen-free`，但缺少 Pool 引用的 `supervisor.mimo-free`。

开发内容：

- 无用户配置时，Supervisor Pool 必须为空且禁用。
- 删除自动注入默认免费模型的行为。
- 补齐并校验所有显式 Supervisor target，或删除无效引用。
- 严格度仅控制触发时机，不得自动选择未配置 Provider。

验收：

- 无配置时三个档位均不会发起 Supervisor 网络请求。
- 配置后，`strict`、`normal` 按矩阵触发，`loose` 默认不触发。
- Provider 不可用时返回可解释错误，不静默切换。

### P1：按档位落地融合功能

#### ADV-HAR-05：Read Before Write 与 stale-read 分离

- `strict`：未读取目标文件时阻断写入。
- `normal`：首次警告并引导读取；重复忽略后阻断。
- `loose`：不要求预读，但 stale-read 检测始终开启。

#### ADV-HAR-06：Branch Budget、Early Stop、Checkpoint 联动

- `strict`：超限后立即进入恢复流程，恢复失败则阻断。
- `normal`：先提示和恢复，再决定是否阻断。
- `loose`：Branch Budget 只记录；严重重复和硬上限仍停止。
- 所有恢复动作必须写入 Checkpoint 和审计事件。

#### ADV-HAR-07：Tool Routing 与 Text Tool Salvage 分档

- `strict`：小模型使用两阶段工具路由，Salvage 始终可用。
- `normal`：根据 Schema 大小、上下文压力、原生调用失败动态启用。
- `loose`：直接路由，Salvage 默认关闭。
- 优先复制并适配 iceCoder、smallcode 中已验证的实现，不重新发明同类解析逻辑。

#### ADV-HAR-08：Verification Gate 分档

- `strict`：验证失败或未运行验证时，不得提交完成状态。
- `normal`：要求验证；无法验证时必须获得用户明确豁免。
- `loose`：允许结束，但必须明确报告未验证项目。
- 三档都禁止伪造测试结果。

### P2：清理此前未完成任务

#### ADV-FIX-01：完成 RM-10

- 旧配置中的 `free-auto` 必须迁移或回退到合法的用户选择。
- 不得在加载历史配置后重新激活 `free-auto`。

#### ADV-FIX-02：完成 RM-30

删除仍残留的 Token 用量估算实现和测试，包括：

- `packages/core/src/context/token-estimator.ts`
- `CHARS_PER_TOKEN`
- `token-estimator.test.ts`
- TokenizerPool 相关 Mock
- Token 估算 benchmark

仅删除估算系统；上下文窗口硬限制和 Provider 返回的真实 usage 数据可以保留。

#### ADV-FIX-03：替换模拟 Benchmark

当前 simulator 将“指导后完成率更高、付费模型未调用、Checkpoint 未损坏、后台进程未泄漏”等结果硬编码，不能作为验收依据。

开发内容：

- 将 simulator 降级为纯单元测试辅助工具。
- 新增真实场景 Runner，至少执行一次 Engine、工具调用、失败恢复和验证流程。
- 记录真实事件，而不是预设结论。

#### ADV-FIX-04：处理全量测试基线

- 分类处理当前全量测试的 476 fail / 21 errors。
- 与本轮无关的历史失败也必须建立明确基线文件，不能继续报告“全量 0 fail”。
- DONE 中写入准确命令、日期和结果。

---

## 六、端到端验收场景

开发 Agent 完成后，至少补充以下端到端测试：

1. `strict` 对未读取文件的写入进行阻断，读取后允许继续。
2. `normal` 首次未读写入产生警告，后续流程按策略恢复。
3. `loose` 不要求预读，但 stale-read 写入仍被拒绝。
4. `strict` 超出 Branch Budget 后进入恢复或阻断。
5. `normal` 超限先恢复，`loose` 只记录事件。
6. 三档长 Shell 命令均可查询、取消，并在结束后无残留进程。
7. `strict` 未验证不能完成；`normal` 需要验证或用户豁免；`loose` 明确报告未验证。
8. 未配置 Supervisor 时，三档均无 Supervisor 网络调用。
9. 配置 Supervisor 后，只有满足对应档位触发条件时才请求建议。
10. 小模型在 `strict` 下实际使用两阶段工具路由和 Salvage。
11. 三档均不会自动改变模型、Provider、温度或推理强度。
12. Engine 主链事件证明所有启用组件被真实调用。
13. `/harness` 菜单正确显示当前档位、来源和三档说明。
14. 菜单取消不修改状态；普通选择只修改当前会话。
15. 用户显式选择“设为项目默认”后，配置可在新会话恢复。
16. 执行过程中切换档位时，当前提交策略不变，下一次提交使用新档位。

---

## 七、完成标准与报告格式

每个任务进入 DONE 前必须同时满足：

- 功能已接入真实运行时路径。
- 有对应单元测试和至少一个端到端测试。
- `bun run typecheck` 通过。
- 相关聚焦测试通过。
- `git diff --check` 通过。
- 全量测试结果被如实记录；存在失败时不得写成 0 fail。
- 文档中的行为与代码一致。

开发 Agent 的完成报告必须包含：

```text
任务 ID：
修改文件：
复制/适配来源：
运行时接线位置：
测试命令与真实结果：
仍存在的问题：
```

下一步开发顺序固定为：

```text
ADV-HAR-01
  → ADV-HAR-02
  → ADV-HAR-03 / ADV-HAR-04
  → ADV-HAR-05 至 ADV-HAR-08
  → ADV-FIX-01 至 ADV-FIX-04
  → 全量端到端验收
```

在 `ADV-HAR-02` 完成前，不应继续将新的独立 Harness 模块标记为已完成；当前首要问题不是缺少更多模块，而是现有模块没有形成可运行闭环。

# Deepicode TODO

本文按开发优先级排列。完成后同步更新 `DONE.md`。

---

## 第一优先：TUI 接入 ✅

> TUI 核心引擎 + 7 业务组件 + 事件桥接已完成。24 文件 / ~3K 行，66 tests 全绿。CLI 已从 readline 切换到差分渲染 TUI。

---

## TUI 增量（审核完成后立即做）

> TUI 骨架已就绪，补齐 `/model` 命令和多 Provider 切换是首个用户可见的功能增量。

### TM1. Provider 抽象层 + 多 Provider 配置

目标：`config.ts` 扩展预设 Provider（zen / mimo / deepseek / custom），`interface.ts` 定义 `ChatClient` 接口。

验收：

- `PROVIDERS` 预设表：zen（免费）→ `deepseek-v4-flash-free`，mimo（免费）→ `mimo-v1`，deepseek → 官方 API，custom → 用户自定义
- `DeepSeekClient` 实现 `ChatClient` 接口（加 `implements`，不改实现）
- 环境变量：`DEEPICODE_PROVIDER` 选择 provider，各 provider 独立 API key 变量
- Zen/Mimo 免费 tier 不强制要求 key

### TM2. `/model` 命令 + model-picker 组件

目标：TUI 内 `/model` → provider 选择界面 → 模型列表 → API key 输入（如需）。

验收：

- 输入 `/model` 触发 provider 选择（↑↓ 切换，Enter 确认）
- 选择 provider 后展示可用模型列表（预设 + 自定义输入）
- deepseek / custom 需要 key → 安全输入框（回显 `***`，内存不落盘）
- Zen/Mimo 跳过 key 输入
- 切换即时生效——后续 API 请求走新 provider
- 状态栏实时显示当前 provider + model

---

## 第二优先：安全层

> 产品可交互后立刻加固。Deny-first 权限引擎和 Hooks 是后续多 Agent、MCP 的安全底座。

### S1. Deny-first 权限引擎

目标：`packages/security/src/permission.ts`。三级判定——Deny 规则优先 → Allow 规则 → 默认 Ask。多级模式：`default` / `acceptEdits` / `dontAsk`。

**Bypass 硬约束**（代码级，非文档约定）：

```typescript
function checkPermission(tool: AgentTool, bypass: boolean): PermissionDecision {
  if (bypass && tool.approval !== "read") {
    throw new Error(`System-level bypass denied: ${tool.name} is ${tool.approval}, only read allowed`)
  }
  // ...
}
```

验收：

- `rm -rf /` → Deny（不弹窗）
- `read_file` → Allow（静默通过）
- `edit` 未授权 → Ask（弹窗）
- Bypass + 写操作 → 抛硬错误（非静默放行）

### S2. Hooks 系统

目标：实现三期 Hook 点：

| Hook | 触发时机 | 用途 |
|------|---------|------|
| `beforeToolCall` | 工具执行前，权限判定后 | 参数修改、审计日志、权限拦截 |
| `afterToolCall` | 工具执行后，结果写入上下文前 | 结果后处理、LSP 反馈注入 |
| `onLoopEvent` | 每个 LoopEvent yield 后 | 自定义 TUI 组件、外部通知 |

System-level bypass 标志——stale-read 触发自动重读时静默放行，不弹 Ask 窗。**与 S1 的硬约束联动**：bypass 标志只在 read 工具上生效。

验收：

- `beforeToolCall` 可阻止工具执行并返回自定义错误
- `afterToolCall` 可修改工具返回值
- `onLoopEvent` fire-and-forget，异常降级为 warning
- stale-read 自动重试路径注入 bypass → 静默放行

### S3. Git Snapshot 单文件追踪

目标：`.deepicode_patches/` 目录，仅备份被修改的单文件旧版本。毫秒级 `revert()`。不拷贝全仓库。

验收：edit 前自动备份；`revert()` 恢复；DiffPreview 展示变更

---

## 第三优先：壳层增强 + 多 Agent

### SH1. 集中式状态管理

目标：`packages/shell/src/state.ts`。`processEvents()` 接收事件队列，返回全新 state 对象（不可变更新）。

验收：messages、tool status、stats、errors 四个子状态

### SH2. 双模式事件系统

目标：推模式 `EventStream` + Pub/Sub `EventBus`，桥接核心拉模式 AsyncGenerator。多消费者同时订阅。

### SH3. 多 Agent 系统

目标：Build Agent（全工具）+ Plan Agent（只读）。Tab 切换，Plan→Build 注入分析结论到 `system-reminder`。

验收：配置加载、切换不修改历史、Plan 模式拦截写工具

---

## 第四优先：智能推理强度调节

### ST1-4: Tier 配置 → TaskClassifier → ChainEstimator → StrategySelector

CNY 原生计价四档位，纯规则打分 0-10，滑动 TPS + Agentic 链式补偿，3 秒倒计时自动执行。

---

## 第五优先：工具层生态

### TL1. LSP 集成

编辑后 3 秒内获取 `vscode-languageclient` diagnostics，类型错误本轮反推给模型。

### TL2. MCP 客户端

Model Context Protocol，`.config/deepicode/mcp.json` 外挂服务，工具自动发现与注册。

### TL3. Web Fetch

`web-fetch.ts`，GET/POST + 超时控制。

---

## 第六优先：测试与调优

### TT1. SSE 边界测试

streaming parser 任意 chunk 切分：1 字节 / 半个 UTF-8 / 半个 JSON。

### TT2. E2E 场景

bash / read_file / edit / 工具错误恢复 / 中断。不依赖真实 API。

### TT3. 性能基准 & 计费校准

CNY 预估 vs DeepSeek 账单误差 < 20%。TUI 帧率 > 30fps。

---

## 待清理

| # | 内容 |
|---|------|
| D5 | `buildPiModel` + `vendor/pi.d.ts` + `vendor/pi.js` |
| P2-4 | `computeFingerprint` 冗余 reasoning_content |

---

## 暂缓

- TTSR 规则系统
- Universal Config Discovery
- Python Kernel（完整 Jupyter 集成）
- 多前端（Web、IDE Plugin）

---

## 进度总览

| 优先级 | 内容 | 项数 | 状态 |
|--------|------|------|------|
| 0 | 脚手架 + 核心引擎 | — | ✅ |
| 1 | TUI 接入 | 3 | ✅ |
| 1b | **TUI 增量**（/model + Provider） | 2 | ⬜ |
| 2 | 安全层 | 3 | ⬜ |
| 3 | 壳层增强 + 多 Agent | 3 | ⬜ |
| 4 | 智能推理调节 | 4 | ⬜ |
| 5 | 工具层生态 | 3 | ⬜ |
| 6 | 测试与调优 | 3 | ⬜ |
| — | 待清理 | 2 | ⬜ |

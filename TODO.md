# Deepicode TODO

本文按开发优先级排列。完成后同步更新 `DONE.md`。

---

## 0️⃣ TUI 重构：复制 best-claude-code 的 Ink 框架 ✅

> **状态**：2026-05-30 已完成。Ink 框架复制（146 文件）+ 7 业务组件新写 + CLI 接入 + 旧代码清理。
> `bun run typecheck` 零错误，`bun test` 66 pass。
>
> 参考借引：[实施计划 § 代码借引逐模块明细](Deepicode实施计划.md) 中 `packages/ink/`、`packages/tui/src/` 两行。

---

## 0️⃣.1 TUI 审计修复 ✅

> **状态**：2026-05-30 已完成 22 项修复（P0×1 + P1×5 + P2×9 + P3×6 + 旧遗留×1）。详见 `ADVICE.md` § 已修复（2026-05-30 第七轮）。
> 已降级为"持续关注"：P3-4-5（fold 竞态，pool 超时自动清理）、TUI-P3-1（Help 硬编码）、TUI-P3-5（promptOverlayContext 占位）

---

## 第一优先：TUI 功能增量 ✅

> ✅ TM1 + TM2 已完成。ChatClient 接口、PROVIDERS 预设表、DEEPICODE_PROVIDER env、ModelPicker 组件（provider 选择 → 模型选择 → API key 安全输入）。`bun run typecheck` 零错误，`bun test` 66 pass。

### TM1. Provider 抽象层 + 多 Provider 配置 ✅

参考：**CC** `src/services/api/openai/`（OpenAI 兼容层架构）

目标：`config.ts` 扩展预设 Provider（zen / mimo / deepseek / custom），`interface.ts` 定义 `ChatClient` 接口。

验收：
- `PROVIDERS` 预设表：zen（免费）→ `deepseek-v4-flash-free`，mimo（免费）→ `mimo-v1`，deepseek → 官方 API，custom → 用户自定义
- `DeepSeekClient` 实现 `ChatClient` 接口（加 `implements`，不改实现）
- 环境变量：`DEEPICODE_PROVIDER` 选择 provider，各 provider 独立 API key 变量
- Zen/Mimo 免费 tier 不强制要求 key

### TM2. `/model` 命令 + model-picker 组件 ✅

参考：**CC** `src/commands/model/` + `src/components/CustomSelect/`

目标：TUI 内 `/model` → provider 选择界面 → 模型列表 → API key 输入（如需）。

验收：
- 输入 `/model` 触发 provider 选择（利用 Ink 的 Dialog/FuzzyPicker 组件）
- 选择 provider 后展示可用模型列表（预设 + 自定义输入）
- deepseek / custom 需要 key → 安全输入框（回显 `***`，内存不落盘）
- Zen/Mimo 跳过 key 输入
- 切换即时生效——后续 API 请求走新 provider
- 状态栏实时显示当前 provider + model

---

## 第二优先：安全层

### S1. Deny-first 权限引擎

参考：**CC** `src/hooks/toolPermission/PermissionContext.ts` + `src/utils/permissions/`

目标：`packages/security/src/permission.ts`。三级判定——Deny 规则优先 → Allow 规则 → 默认 Ask。多级模式：`default` / `acceptEdits` / `dontAsk`。

Bypass 硬约束（代码级）：
```typescript
function checkPermission(tool: AgentTool, bypass: boolean): PermissionDecision {
  if (bypass && tool.approval !== "read") {
    throw new Error(...)
  }
}
```

验收：
- `rm -rf /` → Deny（不弹窗）
- `read_file` → Allow（静默通过）
- `edit` 未授权 → Ask（弹窗）
- Bypass + 写操作 → 抛硬错误

### S2. Hooks 系统

参考：**CC** `src/hooks/toolPermission/handlers/`

目标：`beforeToolCall` / `afterToolCall` / `onLoopEvent` 三个 Hook 点。stale-read 自动重试注入 bypass → 静默放行。

### S3. Git Snapshot 单文件追踪

参考：**OC** `packages/opencode/src/git/`

目标：`.deepicode_patches/` 目录，仅备份被修改的单文件旧版本。毫秒级 `revert()`。

---

## 第三优先：壳层增强 + 多 Agent

### SH1. 集中式状态管理

参考：**CC** `src/state/AppState.tsx`（不可变状态更新模式）

目标：`packages/shell/src/state.ts`。`processEvents()` 返回全新 state 对象。

### SH2. 双模式事件系统

参考：**CC** `src/QueryEngine.ts`（AsyncGenerator 事件流模式）

目标：推模式 `EventStream` + Pub/Sub `EventBus`，桥接核心拉模式 AsyncGenerator。

### SH3. 多 Agent 系统

参考：**OC** `packages/opencode/src/tool/task.ts` + `plan.ts`

目标：Build Agent（全工具）+ Plan Agent（只读）。Tab 切换，Plan→Build 注入分析结论到 `system-reminder`。

---

## 第四优先：智能推理强度调节

参考：**RNX** `src/loop.ts`（strategy select 内嵌逻辑，拆解移植）

### ST1-4: Tier 配置 → TaskClassifier → ChainEstimator → StrategySelector

CNY 原生计价四档位，纯规则打分 0-10，滑动 TPS + Agentic 链式补偿，3 秒倒计时自动执行。

---

## 第五优先：工具层生态

### TL1. LSP 集成

参考：**OC** `packages/opencode/src/tool/lsp.ts`

### TL2. MCP 客户端

参考：**CC** `src/services/mcp/` + `packages/mcp-client/`

### TL3. Web Fetch

参考：**OC** `packages/opencode/src/tool/webfetch.ts`

---

## 第六优先：测试与调优

### TT1. SSE 边界测试

streaming parser 任意 chunk 切分：1 字节 / 半个 UTF-8 / 半个 JSON。

### TT2. E2E 场景

bash / read_file / edit / 工具错误恢复 / 中断。不依赖真实 API。

### TT3. 性能基准 & 计费校准

CNY 预估 vs DeepSeek 账单误差 < 20%。TUI 帧率 > 30fps。

---

## 旧引擎遗留

| # | 内容 | 优先级 |
|---|------|--------|
| P3-4-2 | `prefix.build` 每次 submit 无短路 `engine.ts:140` | 纯性能优化，暂缓 |
| P3-4-5 | fold 竞态孤儿 tokenizer 任务 `loop.ts:40-43` | pool 5s 超时自动清理，加注释即可 |
| D5 | `buildPiModel` + `vendor/pi.d.ts` + `vendor/pi.js` | 移植遗留，待清理 |

---

## 暂缓

- TTSR 规则系统
- Universal Config Discovery
- Python Kernel
- 多前端（Web、IDE Plugin）

---

## 进度总览

| 优先级 | 内容 | 项数 | 状态 |
|--------|------|------|------|
| 0 | 脚手架 + 核心引擎 | — | ✅ |
| 0 | TUI 重构（Ink 框架 + 7 组件） | 1 | ✅ |
| **0.1** | **TUI 审计修复（P0+P1+P2+P3）** | **22** | ✅ |
| 1 | TUI 功能增量（/model + Provider） | 2 | ✅ |
| 2 | 安全层 | 3 | ⬜ |
| 3 | 壳层增强 + 多 Agent | 3 | ⬜ |
| 4 | 智能推理调节 | 4 | ⬜ |
| 5 | 工具层生态 | 3 | ⬜ |
| 6 | 测试与调优 | 3 | ⬜ |
| — | 旧引擎遗留 | 2 | ⬜ |

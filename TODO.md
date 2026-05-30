# Deepicode TODO

本文按开发优先级排列。完成后同步更新 `DONE.md`。

> **关联文档**：[实施计划](Deepicode实施计划.md)（每 Step 的验收标准 + § 代码借引逐模块明细 标注了每个模块参考哪个项目的哪个文件）| [ADVICE](ADVICE.md)（审查报告 + 持续关注项）

---

## 已完成

| 阶段 | 内容 | 日期 |
|------|------|------|
| Phase 0 | 脚手架 + 核心引擎（engine/client/context/session 最小版） | 2026-05-29 |
| Phase 1 | 核心引擎改造（SSE重试/repair/loop析出/tokenizer-pool/fold决策） | 2026-05-29~30 |
| TUI重构 | Ink框架复制（146文件）+ 7业务组件 + FullscreenLayout | 2026-05-30 |
| TUI审计 | 22项修复（bridge/loop/App/PromptInput/StatusBar/pipe） | 2026-05-30 |
| TM1+TM2 | ChatClient接口 + PROVIDERS预设 + ModelPicker组件 | 2026-05-30 |
| TUI打磨 | 状态栏重设计、光标修复、粘贴、模型持久化 | 2026-05-30 |
| Phase 4 | 工具层8工具（read/write/edit/bash/list_dir/grep/todowrite + hash-edit + fuzzy-edit + stale-read + repair） | 2026-05-29~30 |
| Phase 3 | 壳层增强（AppState + QueryEngine + Build/Plan Agent） | 2026-05-30 |

---

## 已知缺陷（先搁置）

| # | 问题 | 位置 | 说明 |
|---|------|------|------|
| **BUG-SIGINT** | Linux下Ctrl+C = SIGINT信号，Ink无法捕获；raw mode丢失后输入框失效 | `App.tsx` + `DeepiPromptInput.tsx` | 当前用`process.on('SIGINT')`接管中断/退出，但raw mode恢复不完整 |

---

## 第一优先：安全层 ✅

> ✅ S1+S2+S3 已完成。PermissionEngine（三级 Deny → Allow → Ask）、HookManager（before/afterToolCall + onLoopEvent）、FileSnapshot（.deepicode_patches/）。已集成到 streaming-executor.ts 和 engine.ts。`bun run typecheck` 零错误，`bun test` 66 pass。

### S1. Deny-first 权限引擎 ✅

参考：**CC** `src/hooks/toolPermission/PermissionContext.ts` + `src/utils/permissions/`

实现：`packages/security/src/permission.ts`。`PermissionEngine` 类，三级判定——Deny 规则优先 → Allow 规则 → 默认 Ask（exec tier）或 Allow（read/write tier）。

### S2. Hooks 系统 ✅

参考：**CC** `src/hooks/toolPermission/handlers/`

实现：`packages/security/src/hooks.ts`。`HookManager` 类，`beforeToolCall`（可返回 deny/allow 拦截工具执行）/ `afterToolCall`（执行后通知）/ `onLoopEvent`（事件观察）三个 Hook 点。

### S3. Git Snapshot 单文件追踪 ✅

参考：**OC** `packages/opencode/src/git/`

实现：`packages/security/src/snapshot.ts`。`FileSnapshot` 类，`.deepicode_patches/` 目录，`snapshot(filepath)` 保存原始内容，`revert(filepath)` 毫秒级恢复。

---

## 第二优先：壳层增强 + 多 Agent ✅

> ✅ SH1+SH2+SH3 已完成。AppState 集中式状态管理、QueryEngine 双模式事件系统、Build Agent + Plan Agent 多 Agent 系统。已集成到 engine.ts 和 TUI。`bun run typecheck` 零错误，`bun test` 66 pass。

### SH1. 集中式状态管理 ✅

参考：**CC** `src/state/AppState.tsx`

实现：`packages/shell/src/state.ts`。`AppState` 类，持有完整 UI 状态（消息/流式文本/推理文本/活跃工具/token 统计/agent/警告/错误），subscribe/notify 发布订阅模式。

### SH2. 双模式事件系统 ✅

参考：**CC** `src/QueryEngine.ts`

实现：`packages/core/src/query-engine.ts`。`QueryEngine` 类，`stream()` 异步生成器模式 + `query()` Promise 简捷模式 + `onEvent()` 推送订阅模式。

### SH3. 多 Agent 系统 ✅

参考：**OC** `packages/opencode/src/tool/task.ts` + `plan.ts`

实现：`packages/core/src/agent.ts`。`AGENTS` 预设表——**Build Agent**（全部工具：bash/read/write/edit/list_dir/grep/todowrite）和 **Plan Agent**（只读：read/list_dir/grep/todowrite）。`switchAgent()` 引擎集成 + 工具过滤 + TUI `/agent` 命令切换 + StatusBar 显示当前 agent。

---


## 第三优先：工具层生态

> 当前状态：8 个核心工具已实现 + registry + 安全基线。

### TL1. LSP 集成

参考：**OC** `packages/opencode/src/tool/lsp.ts`

### TL2. MCP 客户端

参考：**CC** `src/services/mcp/` + `packages/mcp-client/`

### TL3. Web Fetch

参考：**OC** `packages/opencode/src/tool/webfetch.ts`

---

## 第四优先：智能推理强度调节

参考：**RNX** `src/loop.ts`（strategy select 内嵌逻辑）

### ST1-4: Tier 配置 → TaskClassifier → ChainEstimator → StrategySelector

CNY 原生计价四档位，`packages/core/src/strategy/` 目录不存在，LoopEvent 已预留 `strategy_notify` / `strategy_estimate_refined`。

---


## 第五优先：测试与调优

### TT1. SSE 边界测试

streaming parser 任意 chunk 切分：1 字节 / 半个 UTF-8 / 半个 JSON。

### TT2. E2E 场景

bash / read_file / edit / 工具错误恢复 / 中断。不依赖真实 API。

### TT3. 性能基准 & 计费校准

CNY 预估 vs DeepSeek 账单误差 < 20%。TUI 帧率 > 30fps。

---

## 旧代码清理

| # | 内容 | 优先级 |
|---|------|--------|
| D5 | `buildPiModel` + `vendor/pi.d.ts` + `vendor/pi.js` | 移植遗留 |
| P3-4-5 | fold 竞态孤儿 tokenizer 任务 `loop.ts:40-43` | pool 5s 超时自动清理，加注释即可 |

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
| 0 | TUI 重构（Ink框架+7组件+审计+功能增量） | 4 | ✅ |
| 1 | 安全层（PermissionEngine + HookManager + FileSnapshot） | 3 | ✅ |
| 2 | 壳层增强 + 多 Agent（AppState + QueryEngine + Build/Plan Agent） | 3 | ✅ |
| 3 | 工具层生态（核心8工具已✅） | 3 | ⬜ |
| 4 | 智能推理调节 | 4 | ⬜ |
| 5 | 测试与调优 | 3 | ⬜ |
| — | 旧代码清理 | 2 | ⬜ |

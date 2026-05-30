# Deepicode TODO

本文只记录**待完成**工作。已完成项见 `DONE.md`。

> **关联文档**：[实施计划](Deepicode实施计划.md) | [ADVICE](ADVICE.md) | [DONE](DONE.md)

---

## 一、测试与调优

### TT1. SSE 边界测试

streaming parser 任意 chunk 切分：1 字节 / 半个 UTF-8 / 半个 JSON。

### TT2. E2E 场景

bash / read_file / edit / 工具错误恢复 / 中断。不依赖真实 API。

### TT3. 性能基准 & 计费校准

CNY 预估 vs DeepSeek 账单误差 < 20%。TUI 帧率 > 30fps。

---

## 二、智能推理强度调节

参考：**RNX** `src/loop.ts`（strategy select 内嵌逻辑）

### ST1-4: Tier 配置 → TaskClassifier → ChainEstimator → StrategySelector

CNY 原生计价四档位，`packages/core/src/strategy/` 目录不存在，LoopEvent 已预留 `strategy_notify` / `strategy_estimate_refined`。

---

## 三、旧代码清理

| # | 内容 | 优先级 |
|---|------|--------|
| D5 | `buildPiModel` + `vendor/pi.d.ts` + `vendor/pi.js` | 移植遗留 |
| P3-4-5 | fold 竞态孤儿 tokenizer 任务 | pool 5s 超时自动清理，加注释即可 |

---

## 四、暂缓

- TTSR 规则系统
- Universal Config Discovery
- Python Kernel
- 多前端（Web、IDE Plugin）

---

## 进度总览

| 内容 | 状态 |
|------|------|
| Phase 0-4 全部 + SIGINT 修复 + TUI 重构 + 安全层 + 壳层增强 + 多 Agent + 工具层 30+ 工具 + Skills + MCP + ADVICE 审计修复 38 项 | ✅ 见 DONE.md |
| 测试与调优（TT1-3） | ⬜ |
| 智能推理调节（ST1-4） | ⬜ |
| 旧代码清理 | ⬜ |

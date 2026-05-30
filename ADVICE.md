# Deepicode 代码审查与建议

**最后更新**: 2026-06-05

> 已修复项见 `DONE.md` § ADVICE 审计修复汇总。本文只保留待处理项和观察建议。

---

## 一、未修复的已知限制

| 编号 | 问题 | 理由 |
|------|------|------|
| P2-1 (FullReAudit) | fold 孤儿 tokenizer 任务 | pool 5s fallback 已覆盖，代码级取消收益低 |
| P2-8 (FullReAudit) | AgentEvent 死代码 | 低优先清理 |
| P3-11 (FullReAudit) | cron.ts deleteJob 跳过逻辑 | 边界 scenario，低概率触发 |
| P3-12 (FullReAudit) | workflow.ts 模拟实现 | 设计如此，待 Phase 6 实现 |
| P3-13 (FullReAudit) | removeDenyRule 无法移除正则 | 低使用频率 |
| NEW-3 (06-02 Audit) | shell-exec 僵尸进程 | detached 设计取舍 |
| NEW-10~16 (06-02 Audit) | 各种 P3 | 已知限制或低影响 |

## 二、未覆盖的风险

1. **SSE 流中断恢复**：`client.ts` 的 abort/retry 在 Bun 环境下的行为可能与 Node.js 不同
2. **大文件 hash 计算**：`hash-edit.ts` 的 `createReadStream` 在 100MB+ 文件上可能阻塞主线程
3. **Worker 生命周期**：`tokenizer-worker.js` 在 Bun 的 Worker 实现中可能有内存泄漏
4. **AbortSignal 仅 3/11 工具传递**：Ctrl+C 对大文件读/写无效
5. **错误格式不一致**：`[Error]` 前缀 vs `safeStringify({error:...})`

## 三、搁置的架构改进

- OBS-1: prefix.build() 重复调用 — 影响微小
- OBS-3: reasoning_content 入库策略 — 待 Phase 2
- A1: 工具执行后无独立验证步骤 — 待 Phase 7
- A2: Fold 操作成本未记录 — 待 Phase 2

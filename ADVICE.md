# Deepicode 代码审查与建议

**最后更新**: 2026-06-05（第十五轮 — TT1-TT3 测试发现的 Bug 归入 ADVICE）

> 已修复项见 `DONE.md`。

---

## 〇、测试发现的 Bug（TT1-TT3 533 项测试）

### 未修复

#### B1. `afterToolCall` 异常传播（Round 十六）

| 项 | 内容 |
|---|------|
| **位置** | `packages/security/src/hooks.ts` — `HookManager.runAfterToolCall` |
| **症状** | `afterToolCall` 回调抛异常时未被吞掉，向上传播中断主流程 |
| **测试** | `hooks.test.ts` — "should survive afterToolCall exception" 标记 `⚠️` 仍失败 |
| **原因** | `runAfterToolCall` 没有 try-catch 包裹每个回调 |
| **修复** | 在 `runAfterToolCall` 循环内加 `try { cb(...) } catch { /* swallow */ }` |

#### B2. `McpAuth.set()` 返回 `"stored"` 而非 `"not_implemented"`

| 项 | 内容 |
|---|------|
| **位置** | `packages/mcp/src/mcp-tools.ts` — `McpAuth.set` handler |
| **症状** | stub 实现返回 `{status: "stored"}`，但 TEST.md 预期/文档说明是 `"not_implemented"` |
| **测试** | `mcp-tools.test.ts` — "set validate" 通过是因为断言匹配了实际返回值 |
| **原因** | stub 作者选择了静默成功而非明确拒绝 |
| **修复** | 明确返回 `{status: "not_implemented", message: "MCP auth storage not implemented"}` 或将 stub 真正实现 |

#### B3. `sleep-clamp` 测试预期值过时（Known Failure）

| 项 | 内容 |
|---|------|
| **位置** | `packages/tools/__tests__/sleep.test.ts` — clamped test |
| **症状** | `duration_ms: 500000` 被 `Math.min(_, 300000)` 截断到 300000，但测试断言仍用旧预期值 |
| **测试** | 单独运行可见断言不符 |
| **原因** | 代码改过 clamp 逻辑但测试未同步更新 |
| **修复** | 更新测试预期值匹配当前 clamp 行为，或改用 `vi.spyOn` 验证 `Math.min` 被正确调用 |

#### B4. `bash-integration-concurrent` 竞态（Known Failure，偶发）

| 项 | 内容 |
|---|------|
| **位置** | 集成测试 — 所有工具文件同批运行时的 Vitest 线程池竞态 |
| **症状** | 偶发失败，单独运行通过 |
| **原因** | 多个测试共享的临时目录/进程文件出现竞争 |
| **修复** | 每个测试使用 `mkdtempSync` 独立目录；或标记为 `--pool=forks` 避免线程共享 |

### 已修复

| Bug | 位置 | 原因 | 修复 |
|-----|------|------|------|
| MockSseServer 连接泄漏 | `mock-sse-server.ts` | `server.close()` 未销毁 keep-alive socket | 追踪 `Set<Socket>` + `stop()` 时 `sock.destroy()` |
| `refinedEstimate` CJK 双重计数 | `token-estimator.ts:14-18` | CJK 字符同时匹配 `CJK_RE` 和 `PUNCT_RE`（`[^\w\s]`），导致 asciiCount 负值 | `PUNCT_RE` 排除 CJK 范围 `[^\w\s一-鿿㐀-䶿豈-﫿]` |

---

## 一、BUG_REPORT.md 评估

基于 FindBugV2.md 112 条 bug 模式的审查，36 项发现质量较高。


### 需要修复（优先排序）

| 优先级 | 编号 | 问题 | 影响 |
|--------|------|------|------|
| 🟢 P3 | **H6** | shell-exec error 未设 done=true | 低概率 |
| 🟢 P3 | **H7** | glob Windows 路径越界 | 非目标平台 |
| 🟢 P3 | **H9** | Provider 切换未清理历史消息 | 低概率（仅 DeepSeek） |
| 🟢 P3 | **H10** | session 恢复后 stats 清零显示 0% | 已知 tradeoff |
| 🟢 P3 | **H11** | reasoning_content 持久化膨胀 | 已知 OBS-3 |
| 🟢 P3 | **M4** | sensitive `.env.local` 等变体未覆盖 | 低概率 |
| 🟢 P3 | **M5** | bash 路径正则只匹配 ASCII | 边缘场景 |
| 🟢 P3 | **M6** | bash denylist 可被绕过 | 黑名单固有缺陷 |
| 🟢 P3 | **M8** | MCP 超时 unhandled rejection | 有 try-catch 包裹 |
| 🟢 P3 | **M10** | snapshot Date.now() 碰撞 | 低概率 |
| 🟢 P3 | **M13** | permission 大小写敏感 | 边缘场景 |
| 🟢 P3 | **L1-L10** | 各类低风险 | 影响微小 |

--

## 二、未修复的已知限制

（同上轮，无变化）

## 三、未覆盖的风险

1. **SSE 流中断恢复**：`client.ts` 的 abort/retry 在 Bun 环境下的行为可能与 Node.js 不同
2. **大文件 hash 计算**：`hash-edit.ts` 的 `createReadStream` 在 100MB+ 文件上可能阻塞主线程
3. **Worker 生命周期**：`tokenizer-worker.js` 在 Bun 的 Worker 实现中可能有内存泄漏
4. **AbortSignal 仅 3/11 工具传递**：Ctrl+C 对大文件读/写无效
5. **错误格式不一致**：`[Error]` 前缀 vs `safeStringify({error:...})`

## 四、搁置的架构改进

- OBS-1: prefix.build() 重复调用
- OBS-3: reasoning_content 入库策略
- A1: 工具执行后无独立验证步骤
- A2: Fold 操作成本未记录

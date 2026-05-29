## deepicode 项目代码审查报告

**审查时间**: 2026-05-29 / 2026-05-30（第五轮 TUI 审查，已全部修复） · **审查范围**: `packages/` 全部源代码

---

## 已修复

| # | 问题 | 位置 |
|---|------|------|
| B1 | SSE `done` 事件重复发射 | `client.ts` + `engine.ts` |
| B2 | 缺少 `write_file` 工具 | `tools/src/index.ts` |
| B3 | `bash` cwd 未 resolve | `shell-exec.ts` |
| B4 | 临时文件 `Date.now()` 碰撞 | `hash-edit.ts` |
| B5 | fuzzy regex 转义交叉干扰 | `fuzzy-edit.ts` |
| C1 | 缺少 `list_dir` / `grep` | 新增工具 |
| C4 | 9-Pass Fuzzy Edit 缺 pass | `fuzzy-edit.ts` |
| C2 | Session 不可恢复 | `session.ts` 新增 `SessionLoader` |
| C5 | 事件体系未分层 | 新增 `tool_progress` 事件 |
| P1-1 | finish_reason 不一致 | `client.ts` + `engine.ts` → `isToolUseFinishReason` |
| P1-2 | 空 toolCalls 死循环 | `engine.ts` → guard + warning |
| P1-3 | token-estimator 忽略 reasoning | `token-estimator.ts` |
| P2-1 | read_file 截断无提示 | `file-ops.ts` |
| P2-2 | list-dir unknown 类型 | `list-dir.ts` |
| P2-5 | SegmentedLog 死代码 | `session.ts` |
| D1 | SENSITIVE_FILE_PATTERNS 重复 | 提取到 `sensitive.ts` |
| D2 | `getState()` 硬编码 | `engine.ts` |
| N1 | 上下文无界增长 | `context/manager.ts` |
| N3 | hash-edit 临时文件泄漏 | `hash-edit.ts` |
| N4 | stale-read 全局污染 | `stale-read.ts` |
| #7 | Hash-Anchored Edit 完整化 | `hash-edit.ts` + `edit.ts` |
| P0-1 | grep 命令注入 | `grep.ts` → `spawnSync` |
| P0-2 | write_file 无 mkdir | `write-file.ts` |
| P1-1 | buildMessages 截断破坏消息对 | `context/manager.ts` |
| P1-2 | multiOccurrence 静默误替换 | `fuzzy-edit.ts` → `return null` |
| P1-3 | interrupt 延迟一轮 | `engine.ts` |
| P2-1 | truncate 无提示 | `shell-exec.ts` |
| P2-2 | sessionId Date.now 碰撞 | `engine.ts` → `randomUUID()` |
| P2-3 | reasoning_content 不入 API 上下文 | `client.ts` + `engine.ts` |
| P2-3b | SSE JSON 解析静默丢弃 | `client.ts` → `DEEPICODE_DEBUG` |
| P2-5 | sleep 监听器残留 | `client.ts` → `removeEventListener` |
| P2-6 | 防御性死代码分支 | `engine.ts` 保留并加注释 |
| P2-4-1 | Session 恢复重复 system 消息 | `engine.ts` → filter `role !== "system"` |
| P2-4-2 | enqueue JSON.stringify 无异常保护 | `session.ts` → try-catch |
| P2-4-3 | tool_progress shared 路径时序错误 | `streaming-executor.ts` → running 提前到 Promise.all 前 |
| P2-4-4 | tokenizer Worker 与主线程估算不一致 | `token-estimator.ts` + `tokenizer-worker.js` → 共享 `refinedEstimate` |
| P3-4-1 | apiCalls 重复计数 | `loop.ts` → 移到 done 事件 |
| P3-4-3 | todowrite 未验证 todo 项结构 | `todowrite.ts` → 运行时校验 |
| P3-4-4 | sensitive.ts 缺少常见模式 | `sensitive.ts` → 补充 `.env.*`/`*.pem`/`.npmrc` 等 8 模式 |

### 第五轮 TUI 修复

| # | 问题 | 位置 |
|---|------|------|
| P0-5-1 | bridge.ts assistant_delta 覆盖 user 消息 | `bridge.ts` → `assistantStarted` 标志 + 占位消息 |
| P0-5-2 | tool-call-view 同名工具状态覆盖 | `tool-call-view.ts` → `toolCallIndex` 唯一标识 + 状态机不回退 |
| P1-5-1 | bridge.ts 未处理 reasoning_delta | `bridge.ts` → 新增 case → statusLine |
| P1-5-2 | bridge.ts error 误更新 toolView | `bridge.ts` → 仅 `event.toolName` 存在时更新 |
| P1-5-3 | tool_progress 与 tool 事件竞争 | `tool-call-view.ts` → `STATUS_ORDER` 防止降级 |
| P1-5-4 | bridge.ts for-await 异常未捕获 | `bridge.ts` → try-catch |
| P1-5-5 | loader.ts timer 泄漏 | `loader.ts` → `destroy()` |
| P2-5-1 | warning/status 事件被忽略 | `bridge.ts` → statusLine 渲染 |
| P2-5-2 | strategy-notify timer 泄漏 + cardW 负数 | `strategy-notify.ts` → 清理旧 timer + `Math.max(3,...)` |
| P2-5-3 | input 文本溢出终端宽度 | `input.ts` → 水平滚动 + cursor 跟随 |
| P2-5-4 | input 历史无上限 | `input.ts` → `MAX_HISTORY=1000` |
| P2-5-5 | markdown table 列宽为 0 | `markdown.ts` → `colWidth` min 3 |
| P2-5-6 | markdown cache 无 LRU | `markdown.ts` → 50 条淘汰 |
| P2-5-7 | diff-preview s.length | `diff-preview.ts` → `visibleWidth` |
| P2-5-8 | streaming cwd 硬编码 | `streaming-executor.ts` → 构造函数 `cwd` 参数 |
| P3-5-1 | select-list filter 逻辑 | `select-list.ts` → 比较实际 item |
| P3-5-2 | stdin pasteSeqs 循环内清空 | `stdin-buffer.ts` → 循环前拷贝 |
| P3-5-3 | tui diffLines lc 强制覆盖 | `tui.ts` → 仅纯追加场景覆盖 |
| P3-5-4 | input ctrl+d 未处理 | `input.ts` → `\x04` → `__CANCEL__` |
| P3-5-5 | chat-view scroll 死代码 | `chat-view.ts` → 重写移除 |

---

## 待处理

| # | 问题 | 位置 | 说明 |
|---|------|------|------|
| P3-4-2 | prefix.build 每次 submit 无短路 | `engine.ts:140` | 纯性能优化 |
| P3-4-5 | fold 竞态孤儿 tokenizer 任务 | `loop.ts:40-43` | pool 5s 超时自动清理；已加注释 |

---

## 持续关注（低风险，不建议立即改动）

| # | 问题 | 理由 |
|---|------|------|
| 1 | Stale-read TOCTOU 窗口 | 毫秒级窗口，atomic rename + exclusive 并发 |
| 2 | Session JSONL 崩溃一致性 | best-effort 设计 |
| 3 | Bash 命令绕过 | 黑名单永远有绕过 |
| 4 | Fuzzy Edit flexible_whitespace 误匹配 | 前 7 pass 约束 |
| 5 | Prompt 注入 | system prompt 声明即可 |
| 6 | 设计文档功能缺口 | Phase 2 未实现 |

---

## 驳回

| 来源 | 原描述 | 驳回理由 |
|------|--------|---------|
| v2 | P0-1 reasoning_content | 已改为不入上下文 |
| v2 | P1-4 hash-edit sha256 重复 | indexOf 已保证精确匹配 |
| v2 | P1-5 computeFingerprint 工具顺序 | 不跨 session 持久化 |
| v2 | P1-6 fuzzy fallback 未 re-check stale | fuzzy 路径重新 readFile |
| Audit | NEW-P2-1 flushSoon 竞态 | 自身降级为低风险 |
| Audit | NEW-P2-4~7 | 不适用/不影响 |
| 第四轮 | NEW-3/4 | 不触发/已等价完成 |

---

## 总览

| 级别 | 数量 |
|------|------|
| 🟡 待处理 | 2 |
| ⬜ 关注 | 6 |
| ✅ 已修复 | 61 |
| ❌ 驳回 | 11 |

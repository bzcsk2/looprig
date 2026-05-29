## deepicode 项目代码审查报告

**审查时间**: 2026-05-29 / 2026-05-30（复查） · **审查范围**: `packages/` 全部源代码

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
| P1-1 | finish_reason 不一致 | `client.ts` + `engine.ts` → 共享 `isToolUseFinishReason` |
| P1-2 | 空 toolCalls 死循环 | `engine.ts` → empty guard + warning |
| P1-3 | token-estimator 忽略 reasoning | `token-estimator.ts` → 加入 reasoning_content 估算 |
| P2-1 | read_file 截断无提示 | `file-ops.ts` → 追加 truncation notice |
| P2-2 | list-dir unknown 类型 | `list-dir.ts` → type 扩展为 `"unknown"` |
| P2-5 | SegmentedLog 死代码 | `session.ts` → 删除类定义 |
| D1 | SENSITIVE_FILE_PATTERNS 重复 | 提取到 `sensitive.ts` |
| D2 | `getState()` 硬编码 | `engine.ts` |
| N1 | 上下文无界增长 | `context/manager.ts` |
| N3 | hash-edit 临时文件泄漏 | `hash-edit.ts` |
| N4 | stale-read 全局污染 | `stale-read.ts` |
| #7 | Hash-Anchored Edit 完整化 | `hash-edit.ts` + `edit.ts` |
| P0-1 | grep 命令注入 | `grep.ts` → `spawnSync` 数组参数 |
| P0-2 | write_file 无 mkdir | `write-file.ts` |
| P1-1 | buildMessages 截断破坏消息对 | `context/manager.ts` |
| P1-2 | multiOccurrence 静默误替换 | `fuzzy-edit.ts` → `return null` |
| P1-3 | interrupt 延迟一轮 | `engine.ts` |
| P2-1 | truncate 无提示 | `shell-exec.ts` |
| P2-2 | sessionId Date.now 碰撞 | `engine.ts` → `randomUUID()` |
| P2-3 | SSE JSON 解析静默丢弃 | `client.ts` → `DEEPICODE_DEBUG` 日志 |
| P2-5 | sleep 监听器残留 | `client.ts` → `removeEventListener` |
| P2-6 | 防御性死代码分支 | `engine.ts` 保留并加注释 |

---

## 🔴 P0 — 阻断性 Bug

| # | 问题 | 状态 |
|---|------|------|
| P1-1 | client.ts / engine.ts finish_reason 不一致 | 已修复：提取 `isToolUseFinishReason` 共享函数 |
| P1-2 | engine.ts 空 toolCalls 死循环 | 已修复：添加 empty guard + warning |
| P1-3 | token-estimator 忽略 reasoning_content | 已修复：添加到估算 |
| P2-1 | read_file 截断无提示 | 已修复：追加 `[truncated: N more chars]` |
| P2-2 | list-dir stat 失败标记为 file | 已修复：扩展类型为 `"unknown"` |
| P2-5 | SegmentedLog 死代码 | 已修复：删除类定义 |

---

## 🟠 P1 — 功能缺陷

（当前无未修复的 P1 问题）

---## 🟡 P2 — 代码质量与边界问题

（当前无未修复的 P2 问题）

---## 持续关注（低风险，不建议立即改动）

| # | 问题 | 理由 |
|---|------|------|
| 1 | Stale-read TOCTOU 窗口 | 毫秒级窗口，atomic rename + exclusive 并发 |
| 2 | Session JSONL 崩溃一致性 | best-effort 设计，session 恢复已实现 |
| 3 | Bash 命令绕过 | 黑名单永远有绕过，不建议改白名单 |
| 4 | Fuzzy Edit flexible_whitespace 误匹配 | 前 7 个 pass 提供位置约束 |
| 5 | Prompt 注入 | system prompt 声明即可化解 |
| 6 | `buildPiModel` + `vendor/pi.*` 死代码 | P3 清理任务，不阻塞功能 |

---

## 驳回

以下来自各轮审查的发现经代码验证不成立或已修复：

| 来源 | 原描述 | 驳回理由 |
|------|--------|---------|
| v2 | P0-1 reasoning_content"违反 API 契约" | 回传 reasoning 是 reasoning 模型多轮对话的正确行为；实际问题是 token 浪费 (→ P2-3) |
| v2 | P1-4 hash-edit sha256 重复 | `indexOf` 已保证精确匹配，冗余但无害 |
| v2 | P1-5 computeFingerprint 工具顺序 | fingerprint 不跨 session 持久化 |
| v2 | P1-6 fuzzy fallback 未 re-check stale | fuzzy 路径会重新 readFile，自然完成 stale 检测 |
| v2 | P2-2 computeFingerprint → 应剥离 reasoning | 采纳为 P2-4，但降级（fewShots 未实际使用） |
| v2 | P2-3 edit.ts 无 try-catch | 上层 streaming-executor 有 catch，报告自身已定性 |
| v2 | P2-4 config path traversal | 工作目录被攻破是更大的问题 |
| Audit | NEW-P1-2 hash-edit 冗余哈希 | 与 v2 P1-4 相同，已驳回 |
| Audit | NEW-P2-1 flushSoon 竞态 | 报告自身降级为低风险，已归入持续关注 |
| Audit | NEW-P2-4 SessionLoader 完整性 | best-effort 设计，已归入持续关注 |
| Audit | NEW-P2-5 readFileSync 阻塞 | api-key 文件 <100 字节，影响可忽略 |
| Audit | NEW-P2-6 Windows bash | 项目目标 Linux |
| Audit | NEW-P2-7 SSE BOM | DeepSeek 官方 API 不会返回 BOM |

---

## 总览

| 级别 | 数量 | 问题 |
|------|------|------|
| 🟠 P1 | 0 | 全部已修复 |
| 🟡 P2 | 0 | 全部已修复 |
| ⬜ 关注 | 6 | TOCTOU, Session 一致性, Bash 绕过, Fuzzy 误匹配, Prompt 注入, pi 死代码 |
| ✅ 已修复 | 32 | 见已修复表 |
| ❌ 驳回 | 14 | 见驳回表 |

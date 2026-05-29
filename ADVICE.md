## deepicode 项目代码审查报告

**审查时间**: 2026-05-29 / 2026-05-30（第五轮核心审查 + 第六轮 TUI 重做审查） · **审查范围**: `packages/` 全部源代码

> 前五轮审查共修复 63 项（核心引擎 + 工具层 + 旧 TUI），详见 `DONE.md` § ADVICE修复汇总。
> 旧 TUI 代码（oh-my-pi 移植版）已在 TUI 重构中整体删除，其修复记录保留在 DONE.md 作为历史参考。

---

## ✅ 已修复（2026-05-30 第七轮）

| # | 问题 | 修复方式 |
|---|------|----------|
| TUI-P0-1 | tool_progress 硬编码 `status: 'running'` | `bridge.tsx`：tool_progress 检查 content，`done` 时不回退 |
| TUI-P1-1 | error/warning 状态不渲染 | `App.tsx`：scrollable 区域底部添加 error/warning 显示 |
| TUI-P1-2 | Token 统计永远 ↑0 ↓0 | `loop.ts`：yield usage 事件 → `bridge.tsx` 累加到 tokens state |
| TUI-P1-3 | 同名工具状态更新歧义 | `bridge.tsx`：改为 `toolCallIndex` 精确匹配 |
| TUI-P1-4 | reasoning_delta 完全忽略 | `bridge.tsx`：追踪 reasoningText → `DeepiMessages.tsx` 显示 reasoning 行 |
| TUI-P1-5 | cursorPos closure 陈旧 | `DeepiPromptInput.tsx`：改用 `useRef` 存储光标位置 |
| TUI-P2-1 | tool_call_delta 事件忽略 | `bridge.tsx`：添加 case |
| TUI-P2-2 | status 事件忽略 | `bridge.tsx`：非 interrupt/tools_completed 的状态作为 warning 显示 |
| TUI-P2-3 | done 事件未被明确处理 | `bridge.tsx`：添加 case（空处理，finally 已负责清理） |
| TUI-P2-4 | warning 与 error 状态混淆 | `bridge.tsx`：warning 改为独立 `warnings[]` 数组 |
| TUI-P2-5 | Pipe 模式 error 输出到 stdout | `cli/src/tui.ts`：error/warning 改用 `errorOutput` (stderr) |
| TUI-P2-6 | Pipe 模式缺事件处理 | `cli/src/tui.ts`：添加 reasoning_delta / tool_call_delta / tool_progress / status / warning |
| TUI-P2-7 | 输入框无光标 | `DeepiPromptInput.tsx`：在输入位置渲染 `▊` 光标 |
| TUI-P2-8 | 快捷键缺失 | `DeepiPromptInput.tsx`：添加 Ctrl+D / Ctrl+U / Ctrl+K / Home / End / Ctrl+A / Ctrl+E |
| TUI-P2-9 | /exit 不优雅 | `App.tsx`：interrupt() + 延迟 300ms 退出 |
| TUI-P3-2 | CLAUDE_CODE 环境变量前缀 | `fullscreen.ts`：兼容 `DEEPCODE_NO_FLICKER` / `DEEPCODE_DISABLE_MOUSE` |
| TUI-P3-4 | StatusBar 无 flex 分隔 | `StatusBar.tsx`：添加 `<Box flexGrow={1} />` 分隔 |
| TUI-P3-6 | Pipe 模式 done 重复换行 | `cli/src/tui.ts`：移除 done case 的 `output.write("\n")` |
| TUI-P3-7 | messages 用 index 作 React key | `DeepiMessages.tsx`：改为 `role + index + content 前缀` 组合 key |
| TUI-P3-8 | Tool 消息截断无提示 | `DeepiMessages.tsx`：`slice(0, 200) + '...'` |
| TUI-P3-3 | 非全屏无滚动容器 | `FullscreenLayout.tsx`：非全屏路径也包 ScrollBox |
| P3-4-2 | prefix.build 每次 submit 无短路 | `engine.ts`：计算 cacheKey，未变化时跳过 rebuild |

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
| 7 | P3-4-5 fold 竞态孤儿 tokenizer | pool 5s 超时自动清理 |
| 8 | TUI-P3-1 Help 消息硬编码 | 不影响功能，后续扩展 `/model` 时自然解决 |
| 9 | TUI-P3-5 promptOverlayContext 空占位 | MVP 不需要斜杠命令建议 |

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
| ✅ 已修复 | 22（本轮） |
| ⬜ 关注 | 9 |
| ✅ 已修复（移入 DONE.md） | 63 |
| ❌ 驳回 | 11 |

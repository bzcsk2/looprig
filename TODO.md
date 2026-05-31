# Deepicode TODO

本文只记录**待完成**工作。已完成项见 `DONE.md`。
- deepicode-project：重要原则 — 能直接用 Claude Code 的代码就不要自己写
> **关联文档**：[实施计划](Deepicode实施计划.md) | [ADVICE](ADVICE.md) | [DONE](DONE.md)


---
## 一、TUI 界面重构（当前重点）

整体设计：键盘快捷键驱动，鼠标仅用于终端文本选择。**显示框架对齐 Reasonix**，后端保留 deepicode 的 LoopEvent + bridge 架构。

### 当前 TUI 架构（2026-05-31）

```
engine.submit() → LoopEvent(15种) → bridge.tsx(事件→React状态) → DeepiMessages → Reasonix组件渲染
```

**后端不变**：`engine.ts`、`loop.ts`、`LoopEvent`、`bridge.tsx`（事件→状态映射）
**前端已替换**：显示层全部使用 Reasonix 的组件（Markdown/Card/CardHeader/Spinner/ToolCard）

### 剩余功能

| # | 内容 | 优先级 | 说明 |
|---|------|--------|------|
| F3 | 流式输出无 token 速率显示 | P2 | Reasonix StreamingCard 有 t/s 显示 |
| F5 | 无 `StreamingCard`（流式输出卡片） | P2 | Reasonix 有专用流式组件 |

#### 架构差异（Reasonix vs Deepicode）

| 维度 | Reasonix | Deepicode 现状 | 差距 |
|------|----------|---------------|------|
| 数据模型 | `Card[]`（18 种 Card 类型） | 轻量 `TimelineItem[] + TurnView` | 中 |
| 事件转换 | `TurnTranslator`（有状态桥接） | `bridge.tsx`（直接 setState） | 中 |
| 状态管理 | `Store`（dispatch + reduce + subscribe） | `useState<BridgeState>` | 中 |
| 渲染 | `CardRenderer` 按 Card 类型分发 | `DeepiMessages` 一个组件处理所有 | 中 |

**决定**：保持 deepicode 的后端架构不变，只替换显示层组件。不重构 Card/Store/TurnTranslator。

### Phase 2：多行输入 + 斜杠命令补全

| # | 内容 | 涉及文件 | 状态 |
|---|------|---------|------|
| T20 | 多行输入：Ctrl+Enter 提交，Enter 换行 | `DeepiPromptInput.tsx` | ⬜ |
| T21 | 斜杠命令自动补全弹出窗口 | `CommandAutocomplete.tsx` (新) | ⬜ |
| T22 | 光标/编辑体验增强（Ctrl+←→ 跳词，Ctrl+Backspace 删词） | `DeepiPromptInput.tsx` | ⬜ |

### Phase 3：中英文切换

| # | 内容 | 涉及文件 | 状态 |
|---|------|---------|------|
| T30 | i18n 基础设施（t() 函数，zh-CN/en JSON） | `packages/tui/src/i18n/` (新) | ⬜ |
| T31 | 替换所有硬编码字符串（~30-40 处） | 所有 TUI 组件 | ⬜ |
| T32 | `/lang` 命令切换语言 | `packages/tui/src/App.tsx` | ⬜ |

### Phase 4：消息渲染增强

| # | 内容 | 涉及文件 | 状态 |
|---|------|---------|------|
| T40 | 虚拟消息列表（长会话性能） | `VirtualMessageList.tsx` (新) | ⬜ |
| T41 | 消息搜索（Ctrl+F） | `SearchOverlay.tsx` (新) | ⬜ |

---

## 二、Bug 修复（来自 ADVICE）

| # | 问题 | 位置 | 优先级 |
|---|------|------|--------|
| L2 | SessionWriter 队列无界增长 | `core/src/session.ts:114-142` | P2 |
| L5 | fuzzy-edit/hash-edit 未归一化 CRLF | `tools/src/fuzzy-edit.ts`, `hash-edit.ts` | P2 |
| — | notebook-edit 同步文件操作 → 异步 + 原子写入 | `tools/src/notebook-edit.ts` | P2 |
| — | /skill 跨包相对路径 import → package alias | `tui/src/App.tsx:171` | P2 |
| — | handleSessionSelect 卸载后 setState | `tui/src/App.tsx:217-230` | P3 |
| — | tool_call_id 规范化（跨 provider） | `core/src/loop.ts` | P3 |
| — | client.ts 3 处 any/as 类型断言 | `core/src/client.ts` | P3 |

---


## 三、Phase 2：智能推理强度调节

参考：**RNX** `src/loop.ts`（strategy select 内嵌逻辑）

| # | 内容 | 说明 |
|---|------|------|
| ST1 | Tier 配置定义（CNY 四档） | `packages/core/src/strategy/` 目录不存在 |
| ST2 | TaskClassifier（纯规则打分） | LoopEvent 已预留 `strategy_notify` / `strategy_estimate_refined` |
| ST3 | ChainEstimator（滑动 TPS + Agentic 补偿） | |
| ST4 | StrategySelector + TUI 倒计时 | |

---

## 四、测试待完成（来自 TEST.md）

### 🟡 中等（1 项进行中）

| # | 模块 | 项 |
|---|------|----|
| M10 | write_file | 权限继承 — 父目录 mode 继承 |

### 🔴 困难（23 项，需要真实环境/大量数据/复杂状态机）

| # | 模块 | 项 |
|---|------|----|
| H1 | Streaming | AbortSignal 终止后续工具 |
| H2 | Streaming | shared 工具并发安全 |
| H3 | Streaming | 工具执行超时 |
| H4 | Engine | interrupt 在工具执行中 |
| H5 | Engine | interrupt 在 SSE 流中 |
| H6 | Engine | submit 后 switchAgent |
| H7 | Engine | fold force 决策集成场景 |
| H8 | Engine | 并发 submit |
| H9 | Engine | submit 中 updateConfig |
| H10 | Engine | 超长对话 50 轮+ |
| H11 | edit | 极端文件 1MB 单行 |
| H12 | edit | 极端文件 10 万行 |
| H13 | bash | 超时 sleep 60 |
| H14 | bash | stdout 未完全消费 |
| H15 | bash | detached 子进程 |
| H16 | WebFetch | 超时 30s / DNS 失败 |
| H17 | McpClient | 全套 12 项 JSON-RPC stdio |
| H18 | McpHost | 全套 6 项 |
| H19 | MCP Tools | List/Read 资源 |
| H20 | Bridge | 全套 18 项 TUI 状态机 |
| H21 | Terminal | 全套 8 项 Ink/SIGINT |
| H22 | 压力 | 50 轮 / 50K JSON / 10MB 文件 |
| H23 | 压力 | 100 工具 / 1000 行 JSONL / 极端文件名 |

---

## 五、暂缓

- TTSR 规则系统
- Universal Config Discovery
- Python Kernel
- 多前端（Web、IDE Plugin）
- LSP 完整集成（当前仅返回 status:unavailable）
- E2E 测试覆盖 TUI 流程
- 长会话压测（50+ 轮）
- README / 配置指南 / 发布包

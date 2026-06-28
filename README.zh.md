# LoopRig

<p align="center">
  <a href="./README.md">English</a> |
  <strong>中文</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Bun-1.3+-orange" alt="Bun" />
  <img src="https://img.shields.io/badge/TypeScript-Ready-blue" alt="TypeScript" />
  <img src="https://img.shields.io/badge/Status-pre--1.0-yellow" alt="Status" />
  <img src="https://img.shields.io/badge/TUI-Ink%2FReact-blue" alt="TUI" />
  <img src="https://img.shields.io/badge/Schema-Zod_4-green" alt="Schema" />
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License" />
</p>

**LoopRig 是一个终端原生的监督式 Agent Loop 运行台，面向本地、免费和低成本编码模型。**

大部分 AI 编程工具默认依赖昂贵的头部模型来保证质量。LoopRig 的设计哲学不同：让更强的模型负责规划、监督、审查和纠偏，让便宜/免费/本地模型负责大量施工，再通过明确的执行闭环、证据汇报、失败恢复和权限边界把任务做完。

> LoopRig 不是要否定强模型，而是把强模型用在最有价值的位置，让弱模型、便宜模型和本地模型也能持续工作。

LoopRig 原名 **DeepReef**。仓库已经完成改名，但 npm 包名和 CLI 二进制可能仍暂时保留 `@deepreef/cli` / `deepreef`，直到后续包名迁移完成。

---

## LoopRig 是什么

LoopRig 是一个 TypeScript/Bun CLI 与 TUI Agent Runtime，核心能力包括：

- 面向低成本模型使用优化的 cache-aware agent loop
- 面向长任务的固定 Supervisor / Worker 工作流
- 面向弱模型、本地模型、不稳定模型的可调 harness 约束
- 基于 Ink 和 React 的终端 UI
- 30+ 内置工具：文件、搜索、编辑、Shell、Web、任务、Workflow、MCP、Memory、Notebook 等
- Skills、MCP、Plugin/content-pack 与 AgentMemory 集成
- 对 Shell 命令和文件修改采用 deny-first 权限处理
- 支持会话持久化和异常中断后的恢复

LoopRig 当前处于 **pre-1.0** 阶段。核心 CLI、工具、安全层、Memory、Plugin、Skills、MCP 和 Workflow 基础已经实现，但公开 API 与配置格式仍可能变化。

---

## 核心思路：Supervisor + Worker Loop

LoopRig 不采用单个 Agent 在无限循环中自由游走的脆弱模式，而是采用固定双角色执行结构：

```text
Supervisor 规划
  -> Worker 执行
  -> Worker 汇报
  -> Supervisor 检查证据
  -> 继续 / 修正 / 升级 / 求助人类
```

### Worker

Worker 是执行 Agent。它可以使用本地模型、免费模型或低成本 API 模型。普通对话时，Worker 可以像常规 coding agent 一样工作；进入 workflow 后，Worker 遵循 Supervisor 指令，并通过结构化 checkpoint 汇报进展。

### Supervisor

Supervisor 使用更强的模型。它负责规划、审查 Worker 汇报、读取不可变证据包、检测失败循环，并生成下一步结构化指令。当 workflow 无法安全推进时，Supervisor 应停止并向用户求助。

---

## 快速开始

### 安装 CLI

当前包名仍处在改名过渡期，暂时使用旧包名安装：

```bash
npm install -g @deepreef/cli
```

也可以使用 Bun：

```bash
bun install -g @deepreef/cli
```

当前命令行入口仍是：

```bash
deepreef
```

后续包名迁移完成后，这里应更新为未来的 `@looprig/cli` 包和 `looprig` 命令。

### 在项目中启动

```bash
cd your-project
deepreef
```

进入 LoopRig 后，优先使用：

```text
/help
/model
/workflow
```

`/help` 是主要使用入口。你可以直接询问命令、模型配置、workflow、harness、provider、session 恢复等问题。

### 从源码运行

```bash
git clone https://github.com/bzcsk2/looprig.git
cd looprig
bun install
bun run dev
```

---

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `/model` | 切换对话对象与模型配置，状态不丢失。 |
| `/workflow` | 启动 Supervisor / Worker 双角色工作流。 |
| `/sessions` | 查看和恢复历史会话，支持异常退出后的恢复。 |
| `/skill` | 浏览和启用内置工程技能。 |
| `/status` | 查看系统、模型、Provider、工具和 Session 状态。 |
| `/context` | 修改上下文策略。 |
| `/thinking` | 调整思考强度。 |
| `/harness` | 根据模型能力调整执行约束强度。 |
| `/help` | 查看帮助，也可以直接提问。 |

---

## 为什么需要 LoopRig

### 低成本模型经济学

多数 AI 编程工具依赖昂贵模型弥补编排不足。LoopRig 优先强化编排：

- 把昂贵智能用在规划、审查、恢复、验证这些关键判断上。
- 让便宜、免费、本地模型承担可重复的实现工作。
- 当 Worker 失败时，保持 loop 可恢复。
- 通过缓存友好的上下文管理和工具调用修复减少 token 浪费。

### 本地模型与弱模型可靠性

LoopRig 把模型能力不足视为运行时条件，而不是致命限制。Harness 系统允许用户为更弱的模型选择更严格的执行轨道：

- 更小的执行步长
- 更强的验证门禁
- 更频繁的进展汇报
- 有边界的重试次数
- 重复失败时升级给 Supervisor

### 终端原生工程实践

LoopRig 面向在真实代码仓库中工作的开发者，而不是泛聊天场景。它强调：

- 文件感知编辑
- 带权限检查的 Shell 执行
- 可恢复会话
- TUI 可观测性
- 项目本地配置
- 快速模型/Provider 切换

---

## 软件架构

LoopRig 采用核壳分离设计：

```text
packages/core      -> agent loop、API 适配、上下文、缓存、重试、workflow 基础
packages/tui       -> Ink/React 终端 UI、输入、状态栏、模型选择、workflow 展示
packages/tools     -> 文件、Shell、搜索、编辑、Web、MCP、Workflow、Task、Notebook 工具
packages/plugin    -> plugin/content-pack runtime、hooks、schema validation
packages/memory    -> AgentMemory 集成和 memory tools
packages/security  -> deny-first PermissionEngine、HookManager、FileSnapshot
packages/cli       -> 命令行入口
```

核心引擎通过 async stream 输出事件，因此 CLI、TUI、测试和未来 IDE/Web 壳层都可以消费同一套 runtime，而不需要把 UI 渲染和 Agent 执行耦合在一起。

```text
CLI / TUI / future IDE shell
             │
             ▼
     AsyncGenerator<LoopEvent>
             │
             ▼
        CoreEngine
             │
   ┌─────────┼─────────┐
   │         │         │
 Model   Context    Tools
 Client  Manager   Executor
```

---

## 内置能力

### 工具

LoopRig 内置工具覆盖：

- 文件读取、写入、编辑、列表
- grep 与项目搜索
- 带策略检查的 Shell 执行
- TODO / task tracking
- Web 访问
- MCP 工具发现和调用
- Workflow 控制
- Notebook 风格操作
- Memory 操作

### 编辑安全

LoopRig 使用分层编辑保护：

- hash-anchored editing
- fuzzy fallback matching
- stale-read protection
- file snapshots for rollback
- dangerous command blocking
- SSRF-aware web request handling

### Skills 与 MCP

Skills 是可复用的领域指令包。MCP 支持让 LoopRig 通过 JSON-RPC 2.0 / stdio MCP server 接入外部工具和数据源。

### AgentMemory

LoopRig 包含项目与 Agent 连续性相关的 Memory 集成。Memory 行为应视为可配置运行时状态，在敏感仓库中使用前需要审查。

---

## 模型与 Provider

LoopRig 围绕多类模型设计：

| 类型 | 用途 |
| --- | --- |
| 免费网关模型 | Worker 执行、探索、简单实现。 |
| 本地 OpenAI-compatible 模型 | 私有化、长时间、低成本 Worker 执行。 |
| 用户 API Key 模型 | Supervisor、审查、恢复、高质量执行。 |
| 自定义 OpenAI-compatible Endpoint | vLLM、Ollama、llama.cpp、本地网关或内部路由。 |

通过 `/model` 可以配置 Provider。本地模型通过 OpenAI-compatible 配置接入。

LoopRig 不绑定单一模型供应商，运行时真正关心的是：

```ts
{
  provider: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
}
```

---

## Eval 与沙箱方向

LoopRig 正在面向固定 `/eval` 工作流演进，用于比较 Worker 模型、Supervisor 策略、harness 强度和沙箱 profile。

规划中的评测环境包括：

| 环境 | 用途 |
| --- | --- |
| `sandbox` | 默认轻量评测环境，使用 fixture-copy 或 git worktree 隔离。 |
| `container` | 更强的 Docker/Podman 风格隔离，用于外部 benchmark 和复杂依赖 case。 |
| `localenv` | 面向用户真实本地项目的诊断模式，默认不作为官方模型能力分。 |

设计目标是在可复现环境中测试 Agent 能力，同时把真实本地项目诊断和官方 benchmark 分数清晰区分开。

---

## 安全边界

LoopRig 可以读取文件、编辑文件、运行命令和调用工具。它是强大的本地工程助手，不是完整安全边界。

当前安全策略包括：

- deny-first 权限引擎
- Shell 和文件写入操作需要显式授权
- 危险命令拦截
- 文件快照与回滚
- stale-read 编辑保护
- 子 Agent 权限隔离
- API Key 文件默认被 Git 忽略

不要在你不愿意审查 Agent 修改结果的仓库中运行 LoopRig。

---

## 开发与验证

```bash
bun install
bun run typecheck
bun test
bun run build
npm pack --dry-run
```

当前发布包名是 `@deepreef/cli`，命令行入口是 `deepreef`。这些名称预计会在后续包名迁移中更新。

---

## 文档

当前主要文档：

- [English README](./README.md)
- [Roadmap](./ROADMAP.md)
- [Changelog](./CHANGELOG.md)
- [Contributing](./CONTRIBUTING.md)
- [Security Policy](./SECURITY.md)

更多设计和实现笔记位于 [`docs/`](./docs)。其中部分文件是开发笔记，不一定是完整用户文档。

---

## 路线图

详见 [ROADMAP.md](./ROADMAP.md)。

近期重点：

- 完成 DeepReef 到 LoopRig 的命名迁移，包括包元数据和文档。
- 加固 npm 安装和 package smoke test。
- 稳定 Supervisor / Worker workflow 行为。
- 完善 Provider 配置和 harness 等级文档。
- 改进 Windows 终端兼容性。
- 增加面向弱模型/本地模型的可靠性 benchmark 与 `/eval` 工作流。

---

## 贡献

欢迎贡献本地模型预设、Provider 适配、MCP 示例、TUI 体验、workflow 可靠性测试、文档、安全加固、评测 fixtures 和沙箱 provider。

开始前请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md) 和 [SECURITY.md](./SECURITY.md)。

---

## 信念

> 真正有价值的 Agent，不是只在强模型上表现好，而是能把弱模型、便宜模型、本地模型组织起来，让它们稳定完成工程任务。

AI Coding Agent 的下一阶段是成本控制、交付质量和更可靠的 Loop。

**欢迎一起来让“便宜好用”成为 AI 编程的标配。**

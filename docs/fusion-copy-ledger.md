# Deepreef 融合复制台账

> 建立于 DRF-00 完成后（2026-06-12），固化当前 Deepreef 行为和测试基线。

## 1. 基线状态（RM-10/20/30/QST-10/PERM-10 完成后）

### 1.1 TypeCheck 基线

```bash
bun run typecheck
# 结果：tui-opentui 包存在预置类型错误（非本次变更引入）
# packages/tui/src/bridge.tsx 存在 exhaustive check 警告（预置）
# 本次变更文件无新增类型错误
```

### 1.2 Test 基线

```bash
bun test
# 结果：1954 pass, 18 skip, 503 fail, 26 errors
# 失败项主要集中在 memory 相关测试（agentmemory, sketches 等）
# 这些是预置问题，与 RM-10/20/30/QST-10/PERM-10 无关
```

### 1.3 Git Diff 基线

```bash
git diff --check
# 结果：tui-opentui 存在预置 trailing whitespace（非本次变更）
# packages/core, packages/tui, packages/security 无 whitespace 错误
```

---

## 2. 复制来源审计

### 2.1 QST-10：Question 完整交互闭环

| 来源文件 | 存在 | Deepreef 目标 | 复制类型 | 适配点 |
|---------|------|--------------|---------|--------|
| `opencode/packages/opencode/src/question/index.ts` | ✓ | `packages/core/src/question/` | copy | Effect → Promise；类型名 Deepreef 化 |
| `opencode/packages/opencode/src/question/schema.ts` | ✓ | `packages/core/src/question/types.ts` | copy | Schema → TypeScript interface |
| `opencode/packages/opencode/src/tool/question.ts` | ✓ | `packages/tools/src/ask-user.ts` | adapt | Effect → Promise；工具输出语义保留 |
| `opencode/packages/opencode/src/tool/question.txt` | ✓ | 参考 | reference-only | 工具描述文本参考 |
| `opencode/packages/opencode/src/cli/cmd/run/question.shared.ts` | ✓ | `packages/tui/src/question-state.ts` | copy | 主体复制；只改类型和命名 |

**Deepreef 新增文件：**

| 文件 | 说明 |
|------|------|
| `packages/core/src/question/id.ts` | 队列前缀 ID 生成器（`que_`） |
| `packages/core/src/question/service.ts` | QuestionService 类：ask/reply/reject/list |
| `packages/core/src/question/index.ts` | 模块导出 |
| `packages/tui/src/QuestionPrompt.tsx` | React/Ink 问题面板组件 |
| `packages/core/__tests__/question-service.test.ts` | 10 个测试用例 |

### 2.2 PERM-10：权限规则、Auto Accept 与子 Agent 冒泡

| 来源文件 | 存在 | Deepreef 目标 | 复制类型 | 适配点 |
|---------|------|--------------|---------|--------|
| `opencode/packages/opencode/src/permission/index.ts` | ✓ | `packages/core/src/permission/` | copy | Effect → Promise；规则引擎重写 |
| `opencode/packages/opencode/src/core/src/v1/config/permission.ts` | ✓ | `packages/core/src/permission/types.ts` | adapt | 类型定义保留；配置格式适配 |
| `opencode/packages/opencode/src/tool/shell.ts` | ✓ | `packages/core/src/permission/patterns/shell.ts` | copy | shell 命令扫描逻辑 |
| `opencode/packages/opencode/src/cli/cmd/tui/routes/session/permission.tsx` | ✓ | `packages/tui/src/PermissionPrompt.tsx` | adapt | Effect → React/Ink；三阶段 UI |

**Deepreef 新增文件：**

| 文件 | 说明 |
|------|------|
| `packages/core/src/permission/types.ts` | PermissionAction, PermissionMode, PermissionRule 等类型 |
| `packages/core/src/permission/rules.ts` | evaluateRules() 通配符匹配、mergeRulesets()、fromConfig() |
| `packages/core/src/permission/service.ts` | PermissionService 类：ask/reply/interrupt/shutdown |
| `packages/core/src/permission/index.ts` | 模块导出 |
| `packages/core/src/subagent/permission.ts` | deriveSubagentPermissions()、bubble 模式 |
| `packages/core/__tests__/permission-service.test.ts` | 18 个测试用例 |

### 2.3 RM-10/20/30：删除任务（无复制）

| 任务 | 删除内容 | 说明 |
|------|---------|------|
| RM-10 | `free-auto` 虚拟 provider、自动候选路由 | 不复制，直接删除 |
| RM-20 | `/thinking auto`、ModeSelector、ModeStats、StrategyTier | 不复制，直接删除 |
| RM-30 | TokenizerPool、Worker、refined token 估算 | 不复制，直接删除 |

---

## 3. 许可证处理

| 来源项目 | 许可证 | 处理方式 |
|---------|--------|---------|
| OpenCode | MIT | 复制文件保留来源注释和版权声明 |
| iceCoder | MIT | 复制文件保留来源注释和版权声明 |
| SmallCode | MIT | 复制文件保留来源注释和版权声明 |
| Deepreef | MIT | 本项目自身 |

---

## 4. 调用图（最小）

### 4.1 Question 调用链

```
用户输入 → ask-user.ts → ToolContext.askUser()
  → engine.questionService.ask()
    → TUI bridge: question_ask 事件
    → QuestionPrompt.tsx 渲染
    → 用户回复 → bridge: question_reply 事件
    → engine.questionService.reply()
    → Promise resolve → ask-user.ts 返回结果
```

### 4.2 Permission 调用链

```
工具执行 → evaluatePermission()
  → PermissionService.ask()
    → 检查 session-approved rules
    → 检查 config rules
    → 检查 legacy PermissionEngine
    → 检查 hooks
    → TUI bridge: permission_ask 事件
    → PermissionPrompt.tsx 渲染（三阶段）
    → 用户回复 → bridge: permission_reply 事件
    → PermissionService.reply()
    → Promise resolve → 工具执行/拒绝
```

### 4.3 Subagent Permission 冒泡

```
子 Agent 工具调用 → evaluatePermission()
  → deriveSubagentPermissions()
    → 检查父级 deny rules
    → bubble 模式 → 返回 { allowed: false, bubble: true }
    → TUI 显示父级确认
    → 用户回复 → 继续/拒绝
```

---

## 5. 关闭条件确认

- [x] 后续任务不再引用不存在的源文件
- [x] 基线失败项被记录（memory 测试预置问题）
- [x] 本次变更文件无新增类型错误
- [x] 本次变更文件无 whitespace 错误

---

*台账建立时间：2026-06-12*
*建立者：DRF-00 任务*

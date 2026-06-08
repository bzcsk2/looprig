# ECC Manifest Content Pack 审查问题与修复任务

## 1. 文档用途

本文记录对 `docs/ecc-manifest-content-pack-implementation-plan.md` 当前实施结果的审查发现。

实施 Agent 应修复本文列出的缺陷，并按验收清单验证。不要重写现有可复用实现，不要回退工作区中的其他修改。

当前判断：

- Zod 前置修复基本完成。
- executable plugin 的 CLI/Engine 接线基本完成。
- ECC manifest 内容包核心能力仍未完成。
- 当前整体完成度约 40%，不能声明 ECC 兼容已经完成。

## 2. 已执行验证

以下命令已通过：

```bash
bun run typecheck

bun test \
  packages/plugin/__tests__ \
  packages/tools/__tests__/skill-loader.test.ts \
  packages/mcp/__tests__/mcp-host.test.ts \
  packages/core/__tests__/config.test.ts \
  packages/tui/__tests__/status-command.test.ts
```

结果：

```text
138 pass
0 fail
```

这些测试主要覆盖旧功能，不能证明 ECC 内容包兼容正确。

真实 ECC smoke test 暴露的问题：

```text
profile minimal   -> 0 modules
profile developer -> 0 modules
profile full      -> 0 modules
```

三个 profile 均返回：

```text
skills: 1 个完整 skills 根目录
agents: 63
rules: 21
commands: 0
hooks: 0
mcp: 0
```

这说明 profile/module/component 选择没有生效，默认目录发现反而加载了全部资产。

## 3. P0：修复 ECC Profile、Module、Component 解析

### 3.1 问题

文件：

- `packages/plugin/src/content-pack/types.ts`
- `packages/plugin/src/content-pack/ecc-manifests.ts`
- `packages/plugin/src/content-pack/resolver.ts`

当前实现假设：

```ts
profiles.profiles: InstallProfile[]
module.paths: Record<string, string[]>
components.components: InstallComponent[]
```

真实 ECC 格式：

```json
{
  "profiles": {
    "minimal": {
      "modules": ["rules-core", "agents-core"]
    }
  }
}
```

```json
{
  "modules": [
    {
      "id": "framework-language",
      "kind": "skills",
      "paths": ["skills/react-patterns", "skills/python-patterns"]
    }
  ]
}
```

实施 Agent 必须读取并对照：

- `/vol4/Agent/ECC/manifests/install-profiles.json`
- `/vol4/Agent/ECC/manifests/install-modules.json`
- `/vol4/Agent/ECC/manifests/install-components.json`

### 3.2 修复要求

1. 为真实 ECC 格式定义准确类型。
2. profiles 支持对象映射，不要只支持数组。
3. components 支持真实 ECC 格式。
4. module `paths` 按 `module.kind` 分类，不能假设 paths 自带分类 key。
5. 正确展开 module dependencies。
6. include component 加入对应 modules。
7. exclude component 移除对应 modules。
8. 实现 `strict`、`compatible`、`ignore` targetMode。
9. 未知 profile、module、component 必须产生明确 diagnostic。
10. `profile` 未显式配置时，按原计划使用 `developer` 默认值。

### 3.3 验收

真实 ECC 的以下 profile 必须解析出不同 module 和资产集合：

```text
minimal
developer
full
```

必须断言：

```text
minimal.modules.length > 0
developer.modules.length > minimal.modules.length
full.modules.length >= developer.modules.length
```

## 4. P0：禁止默认目录发现绕过选择性安装

### 4.1 问题

文件：

- `packages/plugin/src/content-pack/parser.ts`
- `packages/plugin/src/content-pack/resolver.ts`

`parseManifest()` 当前无条件加入：

- 完整 `skills/`
- 完整 `agents/`
- 完整 `rules/`
- 完整 `commands/`

这会让 profile/module 选择失去意义。

### 4.2 修复要求

需要区分两种模式：

1. 标准 Claude/Codex plugin，没有 selective-install manifests：
   - 按 Claude Code 协议自动发现默认目录。
2. ECC selective-install 内容包：
   - 资产必须主要从选定 module paths 生成。
   - manifest 中显式声明的基础资产如何合并，必须定义清楚且不能导致全量加载。

建议：

- parser 只负责解析 manifest 声明和默认候选。
- resolver 检测到 ECC install manifests 后，以选定 modules 为主要资产来源。
- 对 module path 是目录、文件或 glob-like 路径分别安全展开。
- 不允许选择 `minimal` 后仍自动加载完整 ECC skills、agents、rules。

### 4.3 验收

真实 ECC：

```text
minimal、developer、full 的资产数量必须不同。
```

且：

```text
minimal 不得加载 ECC 全部 63 个 agents 和全部 skills。
```

## 5. P0：修复路径边界安全

### 5.1 问题

文件：

- `packages/plugin/src/content-pack/resolver.ts`
- 可能新增 `packages/plugin/src/content-pack/path-security.ts`

当前使用：

```ts
candidate.startsWith(rootDir)
```

这无法阻止：

```text
root:      /trusted/pack
candidate: /trusted/pack-evil/file
```

Hooks 和 MCP assets 当前没有路径边界检查。

### 5.2 修复要求

1. 使用 `resolve()`、`relative()` 和 `isAbsolute()` 判断路径是否位于 root 内。
2. 所有资产统一经过同一个安全函数：
   - skills
   - agents
   - rules
   - commands
   - hooks
   - MCP
3. 拒绝：
   - `../` 路径穿越
   - root 前缀欺骗
   - 指向 root 外的符号链接
4. 对被阻止资产产生 diagnostic。
5. 不读取、不执行、不连接被阻止资产。

### 5.3 验收

新增测试覆盖：

- `../outside`
- `/trusted/pack-evil`
- root 内符号链接指向 root 外
- hooks/MCP 路径穿越

## 6. P0：修复 MCP Manifest 解析与安全选项

### 6.1 问题

文件：

- `packages/plugin/src/content-pack/parser.ts`
- `packages/plugin/src/runtime.ts`
- `packages/mcp/src/host.ts`

ECC `.codex-plugin/plugin.json` 使用：

```json
{
  "mcpServers": "./.mcp.json"
}
```

当前 parser 将 plugin manifest 本身加入 MCP assets。随后 runtime 把字符串当成 MCP server 对象枚举，产生：

```text
MCP server "0" missing command
MCP server "1" missing command
...
```

真实 ECC smoke test 即使配置：

```json
{
  "mcp": {
    "enabled": true,
    "allowNpx": true,
    "allowPlaceholderEnv": true,
    "servers": ["github"]
  }
}
```

仍得到 `configs: 0`。

### 6.2 修复要求

1. 支持 `mcpServers` 的真实 manifest 形式：
   - 字符串路径
   - 字符串路径数组
   - inline MCP server object
2. `.mcp.json` 与 manifest inline config 应正确合并。
3. 实现并尊重：
   - `mcp.enabled`
   - `allowStdio`
   - `allowHttp`
   - `allowNpx`
   - `allowPlaceholderEnv`
   - `servers` 白名单
4. 默认安全策略：
   - MCP 默认关闭
   - HTTP 默认跳过
   - `npx` / `npx -y` 默认跳过
   - placeholder env 默认跳过
5. placeholder 检测至少覆盖：
   - `YOUR_`
   - `_HERE`
   - `PLACEHOLDER`
   - `<TOKEN>`
6. MCP config 必须经过 schema 校验，不得把未经验证的数据传给 `McpHost.connect()`。
7. 每个跳过原因必须产生结构化 diagnostic。

### 6.3 验收

真实 ECC：

- 默认不连接 MCP。
- 启用后仅返回白名单允许且安全的 stdio MCP。
- HTTP、placeholder、npx 默认跳过并有明确诊断。
- `allowNpx` 等选项开启后行为相应改变。

## 7. P0：Hooks 必须真正接入且默认安全

### 7.1 问题

文件：

- `packages/cli/src/tui.ts`
- `packages/plugin/src/runtime.ts`
- `packages/plugin/src/content-pack/hook-bridge.ts`
- `packages/plugin/src/hook-adapter.ts`
- `packages/security/src/hooks.ts`

当前问题：

- CLI 创建 `PluginRuntime` 时没有传入 `engine.hookManager`。
- `loadHookConfigs()` 没有生产调用。
- `executeEccHookCommand()` 没有生产调用。
- ECC hooks 没有注册进 Deepreef hook lifecycle。
- hook command 执行函数直接使用 `sh -c`，没有 allowlist、cwd、最小 env 或输出限制。

### 7.2 修复要求

1. CLI 初始化 runtime 时传入 Engine 的 `hookManager`。
2. runtime executable plugin hooks 必须真正注册。
3. ECC hooks 默认只识别，不执行。
4. 真执行必须同时满足：
   - `hooks.enabled === true`
   - 对应 hook 类型允许
   - command hook id 在 allowlist
5. 执行 command hook 时：
   - cwd 固定为 workspace root
   - 使用最小环境变量
   - timeout 生效
   - stdout/stderr 有长度上限
   - before hook 失败采用安全策略
6. matcher 必须映射到真实 Deepreef tool name。
7. 无法映射的 lifecycle event 只诊断，不伪装成已执行。

### 7.3 验收

新增测试：

- 默认不执行 hooks。
- 开启 hooks 但未开启 command hooks 时不执行。
- allowlist 外不执行。
- allowlist 内可执行。
- timeout 生效。
- matcher 正确匹配。
- executable plugin hooks 从 CLI/Engine 生产链路真实运行。

## 8. P1：修复 Rules 配置语义

### 8.1 问题

文件：

- `packages/plugin/src/content-pack/resolver.ts`
- `packages/plugin/src/runtime.ts`
- `packages/plugin/src/content-pack/rules-compiler.ts`
- `packages/cli/src/tui.ts`

当前只检查：

```ts
rules.enabled
```

没有实现：

- `rules.mode: "off"`
- `rules.mode: "skill"`
- 按选定 modules 加载
- 稳定顺序
- 来源分区

### 8.2 修复要求

1. `mode: "off"` 时不生成 system prompt。
2. `mode: "system"` 时只编译选中规则。
3. `mode: "skill"` 时转换为可加载 skill，不注入 system prompt。
4. 按稳定路径排序。
5. 保持字符预算与截断诊断。
6. system prompt 中标明 content pack 来源。

## 9. P1：将 Commands 转换为可用 Skills

### 9.1 问题

`PluginRuntime.loadCommandSkills()` 已实现，但 CLI 和 Skill 工具没有消费结果。

### 9.2 修复要求

1. `commands.enabled` 默认 false。
2. 开启且 `mode: "skill"` 时，生成 `ecc-command:<name>` skill。
3. 将生成的 command skills 注入 Skill 工具。
4. 不修改 TUI slash command 控制流。
5. command skill 必须包含来源信息。

## 10. P1：修复 Skills 来源、冲突和选择性加载

### 10.1 问题

文件：

- `packages/tools/src/skill-loader.ts`
- `packages/tools/src/skills/index.ts`
- `packages/plugin/src/runtime.ts`

当前：

- 外部 skill 没有设置 `source`。
- ECC skill 在列表中显示为 `built-in`。
- 重名时外部 skill 被直接丢弃。
- `ecc:<name>` 实际没有被创建。
- runtime 仅适合传入完整 skills 根目录，不适合 profile 选中的单个 skill 目录。

### 10.2 修复要求

1. Skill loader 支持传入明确的 skill assets，而不只是父目录。
2. 外部 skill 设置：

```ts
source: {
  pluginId: "...",
  path: "..."
}
```

3. 内置 skill 保持原名并优先。
4. 外部重名 skill 使用 `<pluginId>:<name>`，不可直接丢弃。
5. 支持按原名和命名空间名搜索；加载冲突项时必须要求命名空间。
6. profile 只暴露实际选择的 skills。

## 11. P1：状态和诊断展示

### 11.1 问题

文件：

- `packages/cli/src/tui.ts`
- `packages/tui/src/App.tsx`
- `packages/tui/src/WelcomeScreen.tsx`
- `packages/tui/src/status/*`

当前 `pluginCount` 只统计：

```ts
status.loadedPlugins.length
```

content packs、资产数量和 diagnostics 没有展示。

### 11.2 修复要求

展示至少包括：

- executable plugin 数量
- content pack 数量
- skills/agents/rules/hooks/MCP 资产数量
- warning/error diagnostic 数量

不要只显示一个容易误解的 plugin 总数。

## 12. P1：Manifest 与 Plugin 配置校验

### 12.1 问题

- `packages/plugin/src/config.ts` 未使用 Zod/Standard Schema 校验。
- Manifest、ECC profiles/modules/components 直接 `JSON.parse()` 后强制断言类型。
- 无效字段可能静默进入 resolver。

### 12.2 修复要求

1. 为 plugin config、Claude/Codex manifest、ECC install manifests 增加 schema 校验。
2. 校验失败不得继续使用 raw parsed。
3. 单个无效资产不应让其他有效资产失效。
4. diagnostic 必须包含文件和字段上下文，但不要泄露敏感值。

## 13. 必须新增的测试文件

至少新增：

```text
packages/plugin/__tests__/content-pack-discovery.test.ts
packages/plugin/__tests__/content-pack-resolver.test.ts
packages/plugin/__tests__/ecc-content-pack.test.ts
packages/plugin/__tests__/content-pack-path-security.test.ts
packages/plugin/__tests__/content-pack-mcp.test.ts
packages/plugin/__tests__/content-pack-hooks.test.ts
packages/plugin/__tests__/content-pack-rules.test.ts
packages/plugin/__tests__/content-pack-commands.test.ts
packages/plugin/__tests__/content-pack-runtime-integration.test.ts
```

测试必须覆盖：

- 标准 Claude plugin 默认目录发现。
- 标准 Codex plugin manifest。
- 真实 ECC profile/module/component 格式。
- profile 间资产数量不同。
- include/exclude/dependencies/targetMode。
- 全部资产类型的路径安全。
- Skills 来源和冲突命名空间。
- Rules mode。
- Commands as skills。
- MCP 安全选项。
- Hooks 默认关闭和 allowlist。
- 同一 workspace 同时加载 manifest content pack 与 Zod executable plugin。

## 14. 真实 ECC Smoke Test

使用：

```json
[
  {
    "spec": "/vol4/Agent/ECC",
    "options": {
      "type": "content-pack",
      "profile": "developer",
      "target": "deepreef",
      "targetMode": "compatible",
      "hooks": {
        "enabled": false
      },
      "mcp": {
        "enabled": false
      }
    }
  }
]
```

必须验证：

1. ECC 被识别为 content pack。
2. `developer` profile 找到且 modules 非空。
3. 只加载 developer profile 对应资产。
4. `tdd-workflow` 或 profile 内其他 skill 可加载。
5. profile 外 skill 不应被加载。
6. 选中的 agents 注册到动态 registry。
7. 选中的 rules 按 mode 处理。
8. hooks/MCP 默认不执行、不连接。
9. status 显示 content pack 和资产统计。
10. 没有致命启动错误。

还必须比较：

```text
minimal
developer
full
```

确认 modules 和资产集合确实不同。

## 15. 完成验收命令

实施 Agent 至少运行：

```bash
bun run typecheck
bun test packages/plugin/__tests__
bun test packages/tools/__tests__/skill-loader.test.ts
bun test packages/mcp/__tests__/mcp-host.test.ts packages/mcp/__tests__/mcp-tools.test.ts
bun test packages/core/__tests__/agent.test.ts
bun test packages/tui/__tests__/status-command.test.ts
bun test
```

此外必须运行真实 ECC smoke test，并在完成报告中列出：

- minimal/developer/full 的 module 数量。
- 每个 profile 的 skills/agents/rules/commands/hooks/MCP 数量。
- 默认关闭 hooks/MCP 的证明。
- MCP 安全跳过诊断。
- 路径穿越测试结果。
- content pack 与 executable Zod plugin 同时加载结果。

## 16. 禁止事项

- 不要通过删除 selective-install 功能来规避真实 ECC 格式。
- 不要继续用默认目录发现加载完整 ECC，再声称 profile 已支持。
- 不要把 `/vol4/Agent/ECC` 写死进生产源码。
- 不要默认执行 ECC hooks。
- 不要默认连接 ECC MCP。
- 不要使用字符串 `startsWith()` 作为路径边界安全判断。
- 不要让未经 schema 校验的 manifest/MCP 配置进入运行时。
- 不要绕过 `executePluginTool()` 调用 Zod executable plugin。
- 不要回退或覆盖工作区中的无关修改。

## 17. 完成定义

只有满足以下条件才能声明修复完成：

- 真实 ECC profiles/modules/components 正确解析。
- selective install 不再被默认目录发现绕过。
- Skills、Agents、Rules、Commands、Hooks、MCP 均按选项正确消费。
- Hooks 和 MCP 默认安全关闭，显式开启仍受策略控制。
- 路径边界对所有资产类型有效。
- TUI/status 能展示 content pack 状态和诊断。
- 计划要求的单元、集成、真实 ECC smoke 和全量回归测试通过。

# 配置系统

DeepReef 使用 TOML 格式的配置文件，支持多层级合并和类型安全的 Zod 校验。

## 配置文件路径

配置按优先级从低到高合并：

1. **内置默认值** — 硬编码在 `packages/core/src/config/defaults.ts`
2. **用户配置** — `~/.deepreef/config.toml`
3. **项目配置** — `<project-root>/.deepreef/config.toml`
4. **CLI 参数** — 命令行传入的参数

## 快速开始

```bash
# 查看当前配置文件路径
/config

# 查看 workflow 配置
/config workflow

# 修改配置
/config workflow.max_rounds 10
/config workflow.mode loop
/config workflow.autonomous true

# 在编辑器中打开配置文件
/config open

# 重新加载配置
/config reload
```

## 配置结构

```toml
version = "2026.6"

# 工作流配置
[workflow]
mode = "loop"                    # alone | subagent | loop
max_rounds = 10                  # 最大迭代轮数
autonomous = true                # 是否自动继续

# 目标配置
[goal]
auto_continue = true             # 目标完成后是否自动继续
budget = 100000                  # Token 预算（0 = 无限）

# 模型配置
[providers.anthropic]
api_key_env = "ANTHROPIC_API_KEY"
base_url = "https://api.anthropic.com"

[providers.openai]
api_key_env = "OPENAI_API_KEY"
base_url = "https://api.openai.com/v1"

[models.default]
provider = "anthropic"
model = "claude-sonnet-4-20250514"

# Agent 配置
[agents.supervisor]
thinking = "high"

[agents.worker]
thinking = "high"

# 工具策略
[tools.supervisor.loop]
deny = ["update_goal"]

[tools.worker.loop]
deny = ["bash", "edit_file", "apply_patch", "write_file"]
```

## 配置模板

DeepReef 提供四种配置模板：

| 模板 | 说明 | 适用场景 |
|------|------|----------|
| `default` | 默认配置 | 通用场景 |
| `local-first` | 本地优先 | 本地开发，最小权限 |
| `safe-readonly` | 安全只读 | 只读操作，安全审查 |
| `autonomous-coding` | 自主编码 | 全自动编码，最大权限 |

使用 CLI 初始化配置：

```bash
# 使用默认模板
deepreef config init

# 使用指定模板
deepreef config init --template local-first
```

## 配置验证

```bash
# 验证配置文件
deepreef config validate

# 验证并显示详细信息
deepreef config validate --verbose
```

## 配置迁移

当配置文件版本落后时，系统会自动迁移：

1. 备份原配置文件为 `.toml.bak`
2. 应用迁移规则
3. 保存新版本配置
4. 显示迁移警告

## 工具策略

工具策略控制 Agent 可以使用哪些工具：

```toml
[tools.supervisor.loop]
deny = ["update_goal"]           # Supervisor 在 loop 模式下禁止使用 update_goal

[tools.worker.loop]
deny = ["bash", "edit_file"]     # Worker 在 loop 模式下禁止使用 bash 和 edit_file

[tools.worker.subagent]
deny = ["bash"]                  # Worker 在 subagent 模式下禁止使用 bash
```

### 硬拒绝

工具策略中的 `deny` 列表是硬拒绝，无法通过 TUI 权限确认覆盖。

## 环境变量

配置文件中可以使用环境变量：

```toml
[providers.anthropic]
api_key_env = "ANTHROPIC_API_KEY"  # 从环境变量读取 API Key
```

## 故障排除

### 配置加载失败

```bash
# 检查配置文件语法
deepreef config validate

# 查看配置加载路径
deepreef config path

# 重新加载配置
/config reload
```

### 权限问题

如果工具被策略拒绝，检查 `[tools]` 配置：

```toml
[tools.worker.loop]
deny = ["bash"]  # Worker 在 loop 模式下禁止使用 bash
```

### 配置不生效

1. 检查配置文件路径是否正确
2. 运行 `/config reload` 重新加载
3. 检查配置文件语法是否正确
4. 查看是否有迁移警告

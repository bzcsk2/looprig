# DeepSeek V4 API 测试

## 测试脚本

### 1. 官方 API — `test_deepseek_v4_api.py`

```bash
export DEEPSEEK_API_KEY="sk-..."
python3 test_deepseek_v4_api.py
```

| 环境变量 | 默认值 |
|----------|--------|
| `DEEPSEEK_API_KEY` | （必填） |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash` |

### 2. OpenCode Zen API — `test_opencode_zen_api.py`

免费使用，无需注册。

```bash
python3 test_opencode_zen_api.py
```

| 环境变量 | 默认值 |
|----------|--------|
| `ZEN_MODEL` | `deepseek-v4-flash-free` |

## Zen vs 官方 API 对比

### 调用方式

| 维度 | Zen | 官方 |
|------|-----|------|
| Base URL | `https://opencode.ai/zen/v1` | `https://api.deepseek.com` |
| 认证 | `Bearer public`（免费）或 `<key>` | `Bearer <key>` |
| 模型名 | `deepseek-v4-flash-free` | `deepseek-v4-flash` / `deepseek-v4-pro` |
| 响应速度 | ~3s | ~1-2s |
| 注册要求 | 免费模型无需注册 | 需要 API key |

### 响应结构差异

| 字段 | Zen | 官方 |
|------|-----|------|
| `model` | 请求 `flash-free`，返回 `flash` | 返回请求的原名 |
| `cost` | 额外返回 `"cost": "0"` | 无此字段 |
| `usage.*` 格式 | 完全一致 | 完全一致 |
| `choices[0].message.*` | 完全一致 | 完全一致 |
| `tool_calls` 格式 | 完全一致 | 完全一致 |

### 功能差异

- **默认 reasoning**：Zen 默认总是返回 `reasoning_content`；官方默认不返回
- **Context**：Zen 免费版 200K，官方 1M
- **参数兼容性**：`thinking`、`reasoning_effort`、`tools`、`response_format` 完全兼容

## 思考模式参数

参考 [官方文档](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode)：

- 开启：`"thinking": {"type": "enabled"}`（默认）
- 关闭：`"thinking": {"type": "disabled"}`
- 强度：`"reasoning_effort": "high"` 或 `"max"`
- 多轮拼接（无工具调用）：只传 `content`，`reasoning_content` 会被 API 忽略
- 多轮拼接（有工具调用）：必须完整回传 `reasoning_content`

## DeepSeek V4 API 参考

- **Base URL**: `https://api.deepseek.com`（官方） / `https://opencode.ai/zen/v1`（Zen）
- **模型**: `deepseek-v4-flash`, `deepseek-v4-pro`, `deepseek-v4-flash-free`
- **上下文**: 1M tokens（免费版 200K）
- **思考模式**: 默认开启，可通过 `"thinking": {"type": "disabled"}` 关闭
- **推理强度**: `reasoning_effort="high"` 或 `"max"`
- **API 密钥**: https://platform.deepseek.com

---

# Reasonix (DeepSeek-Reasonix) 配置

[Reasonix](https://github.com/esengine/DeepSeek-Reasonix) 是一个 DeepSeek 原生的终端 AI 编程代理，已配置为使用 OpenCode Zen API（免费）。

## 项目位置

```
/vol4/Agent/DeepSeek-Reasonix/
```

## 配置内容

### `.env` 文件（`/vol4/Agent/DeepSeek-Reasonix/.env`）

```
DEEPSEEK_API_KEY=public
DEEPSEEK_BASE_URL=https://opencode.ai/zen/v1
REASONIX_LOG_LEVEL=INFO
```

### `~/.reasonix/config.json`

```json
{
  "model": "deepseek-v4-flash-free"
}
```

## 启动方式

以下命令均在 `/vol4/Agent/DeepSeek-Reasonix` 目录下执行。

### 1. Code Agent（推荐）

```bash
./node_modules/.bin/tsx src/cli/index.ts code
```

启动 DeepSeek 驱动的编码 agent，自动挂载文件系统和 shell 工具。

### 2. 聊天模式

```bash
./node_modules/.bin/tsx src/cli/index.ts chat
```

纯聊天的 Ink TUI，不挂文件系统/shell 工具。

### 3. 一次性任务

```bash
./node_modules/.bin/tsx src/cli/index.ts run "你的任务描述"
```

结果直接输出到 stdout，适合管道操作。

### 4. 诊断

```bash
./node_modules/.bin/tsx src/cli/index.ts doctor
```

检查 Node 版本、API Key、配置状态。

### 5. 会话管理

```bash
./node_modules/.bin/tsx src/cli/index.ts --help
```

| 选项 | 说明 |
|------|------|
| `--no-proxy` | 跳过 HTTP 代理，直连 API |
| `--model <name>` | 临时切换模型（默认 `deepseek-v4-flash-free`） |
| `--no-dashboard` | 关闭自动启动的仪表盘 |
| `--no-session` | 不持久化会话 |
| `--session <name>` | 指定会话名 |
| `-n, --new` | 强制新建会话 |

## 注意事项

- **模型名**：Zen 免费模型必须用 `deepseek-v4-flash-free`（`deepseek-v4-flash` 会报 401）
- **上下文**：DeepSeek V4 Flash 官方支持 1M 上下文，`deepseek-v4-flash-free` 同样为 1M
- **依赖**：`Node >= 22`（当前 `v22.21.1` ✔）
- **成本**：Zen API 免费使用，成本显示为 `$0.000000`
- **Proxy**：如果环境有 HTTP 代理且代理不支持 `opencode.ai`，需要加 `--no-proxy`
- **余额接口**：`/user/balance` 在 Zen API 上不存在，doctor 会报 `api reach fail`，不影响正常使用

## 对 Reasonix 源文件的修改

### 1. `src/cli/commands/code.tsx` — 加载顺序

```diff
-  const resolvedModel = opts.model?.trim() || loadModel() || DEFAULT_MODEL;
   loadDotenv();
   bridgeEndpointEnv();
+  const resolvedModel = opts.model?.trim() || loadModel() || DEFAULT_MODEL;
```

**原因**：`loadModel()` 需要 `DEEPSEEK_BASE_URL` 来判断是否使用自定义端点（否则会拒绝非官方模型名）。原代码在 `loadDotenv()` 之前调用 `loadModel()`，导致 `.env` 中的 `DEEPSEEK_BASE_URL` 不可见，`deepseek-v4-flash-free` 被回退为 `deepseek-v4-flash` → Zen API 报 401。

### 2. `src/telemetry/stats.ts` — 注册上下文与定价

```diff
  "deepseek-v4-flash": 1_000_000,
  "deepseek-v4-pro": 1_000_000,
+ "deepseek-v4-flash-free": 1_000_000,
```

```diff
  "deepseek-reasoner": { inputCacheHit: 0.0028, inputCacheMiss: 0.14, output: 0.28 },
+ "deepseek-v4-flash-free": { inputCacheHit: 0, inputCacheMiss: 0, output: 0 },
```

**原因**：`deepseek-v4-flash-free` 不在 `DEEPSEEK_CONTEXT_TOKENS` 中时，Reasonix 回退到 `DEFAULT_CONTEXT_TOKENS = 131072`（128K），浪费了模型实际支持的 1M 上下文。同时添加免费定价（全 0）让成本面板正确显示 `$0.00`。

### 3. `src/loop/thinking.ts` — 思考模式识别

```diff
-  if (model === "deepseek-v4-flash" || model === "deepseek-v4-pro") return true;
+  if (model === "deepseek-v4-flash" || model === "deepseek-v4-pro" || model === "deepseek-v4-flash-free") return true;
```

**原因**：Zen 的 `deepseek-v4-flash-free` 默认返回 `reasoning_content`，需要和官方 V4 模型一样启用 thinking 模式处理逻辑。

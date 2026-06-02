# Deepicode 运行日志诊断指南

最后更新：2026-06-02

本文档提供查看和诊断 Deepicode 运行日志的完整方法。

---

## 1. 快速开始

### 1.1 开启日志

```bash
# 最简方式：开启 debug 级别日志
DEEPICODE_LOG_LEVEL=debug deepicode

# 或使用 CLI 参数
deepicode --debug
```

### 1.2 查看日志

```bash
# 查看当天日志
cat .deepicode/logs/runtime-$(date +%Y-%m-%d).jsonl

# 实时跟踪
tail -f .deepicode/logs/runtime-*.jsonl

# 使用 jq 格式化
cat .deepicode/logs/runtime-*.jsonl | jq .
```

---

## 2. 环境变量配置

| 变量 | 作用 | 默认值 | 示例 |
|------|------|--------|------|
| `DEEPICODE_LOG_LEVEL` | 日志级别 | 未设置（关闭） | `debug`, `info`, `warn`, `error`, `off` |
| `DEEPICODE_LOG_FILE` | 日志文件路径 | `.deepicode/logs/runtime-YYYY-MM-DD.jsonl` | `/tmp/deepicode.log` |
| `DEEPICODE_LOG_FILTER` | 事件名过滤 | 未设置（全部） | `api.*,tool.*` |
| `DEEPICODE_LOG_RETENTION_DAYS` | 保留天数 | `7` | `30` |
| `DEEPICODE_LOG_MAX_TOTAL_MB` | 最大总大小 | `100` | `500` |
| `DEEPICODE_LOG_SYMLINK` | 创建 latest 链接 | 未设置 | `1` |
| `DEEPICODE_TUI_DEBUG` | TUI 诊断 | 未设置 | `1` |
| `DEEPICODE_TRACE` | Perfetto 追踪 | 未设置 | `1` |

---

## 3. CLI 参数

| 参数 | 作用 | 示例 |
|------|------|------|
| `--debug` / `-d` | 开启 debug 级别 | `deepicode --debug` |
| `--debug=<pattern>` | 开启 debug 并过滤 | `deepicode --debug=api.*` |
| `--debug-file=<path>` | 指定日志文件 | `deepicode --debug-file=/tmp/debug.log` |
| `--trace` | 开启 Perfetto 追踪 | `deepicode --trace` |

**优先级：** CLI 参数 > 环境变量 > 默认关闭

---

## 4. 日志格式

每行是一个 JSON 对象：

```json
{
  "ts": "2026-06-02T10:30:00.000Z",
  "level": "info",
  "event": "api.stream.done",
  "sessionId": "abc123",
  "ttftMs": 850,
  "durationMs": 3200,
  "finishReason": "stop"
}
```

### 4.1 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `ts` | string | ISO 8601 时间戳 |
| `level` | string | 日志级别：debug/info/warn/error |
| `event` | string | 事件名（稳定接口） |
| `sessionId` | string | 会话 ID |
| 其他 | unknown | 事件特定字段 |

### 4.2 敏感字段自动脱敏

以下字段会被替换为 `[REDACTED]`：

- `apiKey`, `api_key`
- `authorization`
- `password`, `passwd`
- `secret`, `token`
- `credential`, `cookie`

---

## 5. 事件字典

### 5.1 API 与 SSE

| 事件 | 级别 | 关键字段 | 说明 |
|------|------|----------|------|
| `api.request.start` | info | `model`, `messageCount`, `thinkingMode` | API 请求开始 |
| `api.stream.first_event` | debug | `ttftMs` | 首个 SSE 事件时间 |
| `api.stream.done` | info | `finishReason`, `durationMs` | 流式完成 |
| `api.usage` | info | `promptTokens`, `completionTokens`, `costCNY` | Token 用量 |
| `api.request.retry` | warn | `attempt`, `status`, `delayMs` | 请求重试 |
| `api.request.http_error` | warn | `status`, `attempt` | HTTP 错误 |

### 5.2 工具执行

| 事件 | 级别 | 关键字段 | 说明 |
|------|------|----------|------|
| `tool.batch.start` | debug | `count`, `sharedCount` | 工具批次开始 |
| `tool.batch.done` | debug | `durationMs`, `errorCount` | 工具批次完成 |
| `tool.execute.done` | info | `toolName`, `durationMs`, `isError` | 单个工具完成 |
| `tool.execute.denied` | warn | `toolName`, `permissionSource` | 工具被拒绝 |
| `tool.result.overflow` | info | `toolName`, `originalChars` | 结果溢出持久化 |

### 5.3 Loop 与 Engine

| 事件 | 级别 | 关键字段 | 说明 |
|------|------|----------|------|
| `loop.stream.retry` | warn | `consecutiveErrors`, `turnCount` | 流式重试 |
| `loop.max_turns` | warn | `maxTurns` | 达到最大轮次 |
| `reasoning.mode.switch` | info | `from`, `to`, `reason` | 推理模式切换 |

### 5.4 MCP

| 事件 | 级别 | 关键字段 | 说明 |
|------|------|----------|------|
| `mcp.host.start` | info | `serverCount` | MCP 主机启动 |
| `mcp.server.connect.done` | info | `mcpServer`, `durationMs` | 服务器连接完成 |
| `mcp.request.done` | debug | `mcpServer`, `method`, `durationMs` | MCP 请求完成 |
| `mcp.request.error` | warn | `mcpServer`, `method`, `errorClass` | MCP 请求错误 |

---

## 6. 常见诊断场景

### 6.1 API 请求慢

```bash
# 查看 TTFT（首 token 时间）
cat .deepicode/logs/runtime-*.jsonl | jq 'select(.event == "api.stream.first_event") | {ttftMs, model}'

# 查看所有 API 耗时
cat .deepicode/logs/runtime-*.jsonl | jq 'select(.event == "api.stream.done") | {durationMs, finishReason}'
```

**正常范围：**
- TTFT: < 2000ms
- 总耗时: < 30000ms

### 6.2 工具执行失败

```bash
# 查看失败的工具
cat .deepicode/logs/runtime-*.jsonl | jq 'select(.event == "tool.execute.done" and .isError == true) | {toolName, durationMs}'

# 查看被拒绝的工具
cat .deepicode/logs/runtime-*.jsonl | jq 'select(.event == "tool.execute.denied") | {toolName, permissionSource}'
```

### 6.3 重试和错误

```bash
# 查看重试
cat .deepicode/logs/runtime-*.jsonl | jq 'select(.event == "api.request.retry") | {attempt, status, delayMs}'

# 查看流式错误
cat .deepicode/logs/runtime-*.jsonl | jq 'select(.event == "loop.stream.retry") | {consecutiveErrors, turnCount}'
```

### 6.4 推理模式切换

```bash
# 查看模式切换
cat .deepicode/logs/runtime-*.jsonl | jq 'select(.event == "reasoning.mode.switch") | {from, to, reason}'
```

### 6.5 Token 用量统计

```bash
# 汇总 Token 用量
cat .deepicode/logs/runtime-*.jsonl | jq 'select(.event == "api.usage") | {promptTokens, completionTokens, costCNY}' | jq -s 'add'
```

---

## 7. 事件过滤

### 7.1 按事件名过滤

```bash
# 只看 API 相关事件
DEEPICODE_LOG_FILTER=api.* deepicode

# 只看工具相关事件
DEEPICODE_LOG_FILTER=tool.* deepicode

# 多个过滤器
DEEPICODE_LOG_FILTER=api.*,tool.*,loop.* deepicode
```

### 7.2 使用 CLI 过滤

```bash
# 只看 API 事件
deepicode --debug=api.*

# 只看工具事件
deepicode --debug=tool.*
```

### 7.3 使用 jq 过滤

```bash
# 只看 warn 和 error 级别
cat .deepicode/logs/runtime-*.jsonl | jq 'select(.level == "warn" or .level == "error")'

# 只看特定会话
cat .deepicode/logs/runtime-*.jsonl | jq 'select(.sessionId == "abc123")'

# 只看特定时间范围
cat .deepicode/logs/runtime-*.jsonl | jq 'select(.ts >= "2026-06-02T10:00:00Z" and .ts < "2026-06-02T11:00:00Z")'
```

---

## 8. Perfetto 追踪

### 8.1 开启追踪

```bash
# 方式 1：环境变量
DEEPICODE_TRACE=1 deepicode

# 方式 2：CLI 参数
deepicode --trace
```

### 8.2 查看追踪

1. 运行 Deepicode 并执行一些操作
2. 追踪文件保存在 `.deepicode/traces/trace-<session-id>.json`
3. 打开 https://ui.perfetto.dev
4. 拖拽或打开 trace 文件

### 8.3 追踪层级

```
Interaction
  └─ LLM Request
       └─ Tool Batch
            └─ Tool: <toolName>
```

### 8.4 追踪字段

| 字段 | 说明 |
|------|------|
| `ttft_ms` | 首 token 时间 |
| `prompt_tokens` | 输入 token 数 |
| `completion_tokens` | 输出 token 数 |
| `duration_ms` | 总耗时 |
| `success` | 是否成功 |

---

## 9. 日志轮转与清理

### 9.1 自动清理

日志按日期自动分文件：

```
.deepicode/logs/
  runtime-2026-06-01.jsonl
  runtime-2026-06-02.jsonl
  latest.jsonl -> runtime-2026-06-02.jsonl
```

### 9.2 配置保留策略

```bash
# 保留 30 天
DEEPICODE_LOG_RETENTION_DAYS=30 deepicode

# 最大 500MB
DEEPICODE_LOG_MAX_TOTAL_MB=500 deepicode
```

### 9.3 手动清理

```bash
# 删除 7 天前的日志
find .deepicode/logs -name "runtime-*.jsonl" -mtime +7 -delete

# 查看日志总大小
du -sh .deepicode/logs/
```

---

## 10. 故障排查

### 10.1 日志未生成

**检查：**

1. `DEEPICODE_LOG_LEVEL` 是否设置且不为 `off`
2. `.deepicode/logs/` 目录是否有写入权限
3. 磁盘空间是否充足

```bash
# 验证环境变量
echo $DEEPICODE_LOG_LEVEL

# 检查目录权限
ls -la .deepicode/logs/

# 检查磁盘空间
df -h .
```

### 10.2 日志文件过大

**解决：**

```bash
# 启用自动清理
DEEPICODE_LOG_RETENTION_DAYS=7 DEEPICODE_LOG_MAX_TOTAL_MB=100 deepicode

# 或手动清理
find .deepicode/logs -name "runtime-*.jsonl" -mtime +3 -delete
```

### 10.3 性能影响

**正常情况：** 日志异步写入，不影响性能。

**如果发现性能问题：**

```bash
# 使用过滤减少日志量
DEEPICODE_LOG_FILTER=api.*,tool.* deepicode

# 或降低日志级别
DEEPICODE_LOG_LEVEL=warn deepicode
```

### 10.4 旧版 DEEPICODE_DEBUG

**弃用提示：**

```
[deprecated] DEEPICODE_DEBUG is deprecated. Use DEEPICODE_LOG_LEVEL=debug instead.
```

**迁移方法：**

```bash
# 旧方式（已弃用）
DEEPICODE_DEBUG=1 deepicode

# 新方式
DEEPICODE_LOG_LEVEL=debug deepicode
```

---

## 11. 高级用法

### 11.1 自定义日志文件

```bash
# 输出到自定义路径
DEEPICODE_LOG_FILE=/var/log/deepicode.jsonl deepicode

# 同时开启 latest 链接
DEEPICODE_LOG_FILE=/var/log/deepicode.jsonl DEEPICODE_LOG_SYMLINK=1 deepicode
```

### 11.2 组合使用

```bash
# 完整调试环境
DEEPICODE_LOG_LEVEL=debug \
DEEPICODE_LOG_FILTER=api.*,tool.*,loop.* \
DEEPICODE_LOG_SYMLINK=1 \
DEEPICODE_TRACE=1 \
deepicode --debug
```

### 11.3 分析脚本示例

```bash
#!/bin/bash
# analyze-logs.sh - 分析 Deepicode 日志

LOG_FILE=${1:-".deepicode/logs/runtime-$(date +%Y-%m-%d).jsonl"}

echo "=== API 请求统计 ==="
cat "$LOG_FILE" | jq -r 'select(.event == "api.stream.done") | "\(.durationMs)ms \(.finishReason)"' | sort | uniq -c | sort -rn

echo ""
echo "=== 工具执行统计 ==="
cat "$LOG_FILE" | jq -r 'select(.event == "tool.execute.done") | "\(.toolName): \(.durationMs)ms \(.isError)"' | sort | uniq -c | sort -rn

echo ""
echo "=== 错误统计 ==="
cat "$LOG_FILE" | jq -r 'select(.level == "warn" or .level == "error") | "\(.level): \(.event)"' | sort | uniq -c | sort -rn

echo ""
echo "=== Token 用量 ==="
cat "$LOG_FILE" | jq -s 'select(.[] | .event == "api.usage") | add | "Prompt: \(.promptTokens) Completion: \(.completionTokens) Cost: \(.costCNY)"'
```

---

## 12. 相关文件

| 文件 | 说明 |
|------|------|
| `packages/core/src/runtime-logger.ts` | RuntimeLogger 实现 |
| `packages/core/src/perfetto-tracing.ts` | Perfetto 追踪实现 |
| `packages/mcp/src/diagnostics.ts` | MCP 诊断接口 |
| `packages/tui/src/diagnostics.ts` | TUI 诊断接口 |
| `Deepicode-LogSystem-Migration-Plan.md` | 日志系统迁移方案 |

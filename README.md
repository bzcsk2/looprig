# deepicode

DeepSeek V4 优化的上下文分区 agent，基于 pi-ai 框架。

## 架构

### 核心：三区域上下文分区

参考 [Reasonix](https://github.com/bczsk2/reasonix-core) 的 DeepSeek prefix-cache 优化思路，将发送给 API 的 messages 数组分割为三个区域：

```
[ImmutablePrefix] + [AppendOnlyLog] + [VolatileScratch]
         ↓                 ↓                 ↓
   字节稳定系统提示     只追加历史对话      每轮临时状态
```

布局确保前 N 个 token 跨轮字节一致，使 DeepSeek V4 的 prefix-cache（`prompt_cache_hit_tokens`）能持续命中，降低推理成本和延迟。

| 模块 | 功能 |
|------|------|
| `context/immutable.ts` | ImmutablePrefix — 系统提示词，session 生命周期内只构建一次 |
| `context/append-log.ts` | AppendOnlyLog — 对话历史，只追加不修改 |
| `context/scratch.ts` | VolatileScratch — 每轮临时状态，自动清空 |
| `context/manager.ts` | ContextManager — 组装三区域 messages 数组 |

### LLM 层：pi-ai

AI 框架 [Pi](https://github.com/earendil-works/pi-mono) 的 `pi-ai` 包提供 OpenAI SDK 封装、多 provider 兼容、SSE 流式解析。

| 模块 | 功能 |
|------|------|
| `vendor/pi.js` + `vendor/pi.d.ts` | pi-ai 的薄包装层（类型声明 + 运行时） |
| `loop.ts` | AgentLoop — tool call 处理 + 多轮循环 |
| `config.ts` | pi-ai Model 对象构建（opencode.ai 自定义 provider） |
| `index.ts` | 交互式 CLI（Node.js readline REPL） |

## 使用

```bash
cd /vol4/Agent/deepicode
npx tsx src/index.ts          # 交互模式
echo "你好" | npx tsx src/index.ts   # 单轮
```

环境变量：

| 变量 | 默认值 |
|------|--------|
| `DEEPSEEK_API_KEY` | `public` |
| `DEEPSEEK_BASE_URL` | `https://opencode.ai/zen/v1` |
| `DEEPSEEK_MODEL` | `deepseek-v4-flash-free` |

## 测试

```bash
npx vitest run                # 所有测试
npx vitest run tests/context.test.ts   # 仅单元测试
npx vitest run tests/integration.test.ts  # 集成测试（默认跳过）
```

## 文件结构

```
src/
├── vendor/
│   ├── pi.js          # pi-ai 运行时包装
│   └── pi.d.ts        # pi-ai 类型声明
├── context/
│   ├── immutable.ts   # ImmutablePrefix (Reasonix 参考)
│   ├── append-log.ts  # AppendOnlyLog (Reasonix 参考)
│   ├── scratch.ts     # VolatileScratch (Reasonix 参考)
│   └── manager.ts     # ContextManager (Reasonix 参考)
├── config.ts          # 配置 + pi-ai Model 构建
├── loop.ts            # AgentLoop (streamSimple + tool call)
├── index.ts           # REPL CLI
└── types.ts           # 共享类型
tests/
├── context.test.ts    # 14 个单元测试
└── integration.test.ts# 3 个集成测试（默认跳过）
```

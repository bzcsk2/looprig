import { describe, it, expect } from "vitest"
import { ImmutablePrefix } from "../src/context/immutable.js"
import { AppendOnlyLog } from "../src/context/append-log.js"
import { ContextManager } from "../src/context/manager.js"
import { completeSimple } from "../src/vendor/pi.js"
import type { DeepicodeConfig } from "../src/config.js"
import { buildPiModel } from "../src/config.js"

// Zen API 测试配置（默认接受 "public" 作为 apiKey）
const ZEN_CONFIG: DeepicodeConfig = {
  apiKey: "public",
  baseUrl: "https://opencode.ai/zen/v1",
  model: "deepseek-v4-flash-free",
  maxTokens: 512,
  temperature: 0.3,
}

// 根据测试配置构建 pi-ai 模型对象
const model = buildPiModel(ZEN_CONFIG)

// 与真实 Zen API 的集成测试（默认接受 "public" 作为 apiKey）
// describe.skip 默认跳过，仅在 CI 或手动开启时运行
describe.skip("AgentLoop 集成测试", { timeout: 60000 }, () => {
  // 测试跨多轮对话的 prefix-cache 指标有效性
  it("should produce valid prefix-cache metrics across multiple turns", async () => {
    const ctx = new ContextManager()
    ctx.prefix.build("You are a helpful assistant. Keep answers very short.")

    let totalHits = 0   // 累计缓存命中数
    let totalMisses = 0 // 累计缓存未命中数

    for (let turn = 1; turn <= 2; turn++) {
      ctx.startTurn()
      ctx.log.append({ role: "user", content: `Turn ${turn}: say a short greeting` })

      const messages = ctx.buildMessages()
      const systemMsg = messages.find((m) => m.role === "system")
      // 构建 pi-ai 请求上下文：systemPrompt + messages（剥离 system 消息）
      const context = {
        systemPrompt: systemMsg?.content ?? undefined,
        messages: messages.filter((m) => m.role !== "system").map((m) => ({
          role: m.role === "tool" ? "toolResult" as const : m.role as "user",
          content: m.content ?? "",
          timestamp: Date.now(),
        })),
      }

      // 调用非流式接口获取完整回复
      const resp = await completeSimple(model, context, {
        apiKey: ZEN_CONFIG.apiKey,
        maxTokens: 200,
      })

      // 提取文本内容，回退到占位文本
      const content = resp.content.find((c) => c.type === "text")?.text || "(thinking completed)"
      ctx.log.append({ role: "assistant", content })

      const usage = resp.usage
      totalHits += usage.cacheRead
      totalMisses += usage.cacheWrite

      // 验证前缀哈希始终非空
      expect(ctx.prefix.cacheKey).toBeTruthy()
    }

    const total = totalHits + totalMisses
    expect(total).toBeGreaterThan(0)
    if (totalHits > 0) {
      console.log(`Cache: ${totalHits} hit / ${totalMisses} miss = ${((totalHits / total) * 100).toFixed(1)}%`)
    }
  })

  // 测试每轮 prefix 哈希值是否完全相同（字节稳定性）
  it("should produce identical prefix hashes on every turn", () => {
    const ctx = new ContextManager()
    ctx.prefix.build("You are a helpful assistant.")

    const hashes: string[] = []
    for (let turn = 0; turn < 5; turn++) {
      hashes.push(ctx.prefix.cacheKey)
    }

    // 所有哈希值必须相同，证明 prefix 字节未变
    expect(new Set(hashes).size).toBe(1)
  })

  // 测试跨轮消息顺序是否正确维护
  it("should maintain correct message ordering across turns", async () => {
    const ctx = new ContextManager()
    ctx.prefix.build("You are a helpful assistant. Keep answers under 5 words.")

    // 第一轮：用户提问，助手回复
    ctx.startTurn()
    ctx.log.append({ role: "user", content: "What is 2+2?" })
    const systemMsg = ctx.buildMessages().find((m) => m.role === "system")
    const context1 = {
      systemPrompt: systemMsg?.content ?? undefined,
      messages: ctx.buildMessages().filter((m) => m.role !== "system").map((m) => ({
        role: m.role === "tool" ? "toolResult" as const : m.role as "user",
        content: m.content ?? "",
        timestamp: Date.now(),
      })),
    }
    const resp1 = await completeSimple(model, context1, {
      apiKey: ZEN_CONFIG.apiKey,
      maxTokens: 50,
    })
    const text1 = resp1.content.find((c) => c.type === "text")?.text || ""
    ctx.log.append({ role: "assistant", content: text1 })

    // 第二轮：用户追问新问题
    ctx.startTurn()
    ctx.log.append({ role: "user", content: "What color is the sky?" })

    // 验证日志长度正确增长
    expect(ctx.log.messages).toHaveLength(3)     // user1 + assistant1 + user2
    expect(ctx.buildMessages()).toHaveLength(4)  // system + user1 + assistant1 + user2

    const systemMsg2 = ctx.buildMessages().find((m) => m.role === "system")
    const context2 = {
      systemPrompt: systemMsg2?.content ?? undefined,
      messages: ctx.buildMessages().filter((m) => m.role !== "system").map((m) => ({
        role: m.role === "tool" ? "toolResult" as const : m.role as "user",
        content: m.content ?? "",
        timestamp: Date.now(),
      })),
    }
    const resp2 = await completeSimple(model, context2, {
      apiKey: ZEN_CONFIG.apiKey,
      maxTokens: 50,
    })
    const text2 = resp2.content.find((c) => c.type === "text")?.text || ""
    ctx.log.append({ role: "assistant", content: text2 })

    // 最终日志应有 4 条：user1 + assistant1 + user2 + assistant2
    expect(ctx.log.messages).toHaveLength(4)
  })
})

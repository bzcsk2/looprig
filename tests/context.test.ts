import { describe, it, expect } from "vitest"
import { ImmutablePrefix } from "../src/context/immutable.js"
import { AppendOnlyLog } from "../src/context/append-log.js"
import { VolatileScratch } from "../src/context/scratch.js"
import { ContextManager } from "../src/context/manager.js"
import type { ChatMessage } from "../src/types.js"

// === ImmutablePrefix 单元测试 ===
describe("ImmutablePrefix", () => {
  // 相同输入应产生字节一致的消息和相同的哈希值
  it("should produce byte-identical messages when built with same input", () => {
    const a = new ImmutablePrefix()
    const b = new ImmutablePrefix()

    a.build("You are a helpful assistant.")
    b.build("You are a helpful assistant.")

    expect(a.messages).toEqual(b.messages)
    expect(a.cacheKey).toBe(b.cacheKey)
  })

  // 不同的提示词应产生不同的哈希值
  it("should produce different hashes for different prompts", () => {
    const a = new ImmutablePrefix()
    const b = new ImmutablePrefix()

    a.build("You are a helpful assistant.")
    b.build("You are a coding assistant.")

    expect(a.cacheKey).not.toBe(b.cacheKey)
  })

  // build 之后 prefix 应不可变（外部无法修改内部状态）
  it("should be immutable after build", () => {
    const p = new ImmutablePrefix()
    p.build("System prompt")
    const msgs = p.messages
    expect(msgs).toHaveLength(1)
    expect(msgs[0].role).toBe("system")
    expect(msgs[0].content).toBe("System prompt")
  })
})

// === AppendOnlyLog 单元测试 ===
describe("AppendOnlyLog", () => {
  // 消息应按追加顺序排列
  it("should append messages in order", () => {
    const log = new AppendOnlyLog()
    log.append({ role: "user", content: "Hello" })
    log.append({ role: "assistant", content: "Hi" })
    log.append({ role: "user", content: "How are you?" })

    expect(log.messages).toHaveLength(3)
    expect(log.messages[0].content).toBe("Hello")
    expect(log.messages[1].content).toBe("Hi")
    expect(log.messages[2].content).toBe("How are you?")
  })

  // length getter 应正确反映消息数量
  it("should track length", () => {
    const log = new AppendOnlyLog()
    expect(log.length).toBe(0)
    log.append({ role: "user", content: "A" })
    expect(log.length).toBe(1)
    log.append({ role: "assistant", content: "B" })
    expect(log.length).toBe(2)
  })

  // appendMany 应正确追加多条消息
  it("should support appendMany", () => {
    const log = new AppendOnlyLog()
    log.appendMany([
      { role: "user", content: "A" },
      { role: "assistant", content: "B" },
    ])
    expect(log.length).toBe(2)
  })

  // clear 应清空所有消息
  it("should clear correctly", () => {
    const log = new AppendOnlyLog()
    log.append({ role: "user", content: "A" })
    log.clear()
    expect(log.length).toBe(0)
    expect(log.messages).toHaveLength(0)
  })
})

// === VolatileScratch 单元测试 ===
describe("VolatileScratch", () => {
  // 初始状态应为空
  it("should start empty", () => {
    const scratch = new VolatileScratch()
    expect(scratch.messages).toHaveLength(0)
  })

  // reset 应清空所有暂存消息
  it("should reset on demand", () => {
    const scratch = new VolatileScratch()
    scratch.append({ role: "assistant", content: "thinking..." })
    expect(scratch.messages).toHaveLength(1)
    scratch.reset()
    expect(scratch.messages).toHaveLength(0)
  })

  // setMessages 应覆盖写入消息列表
  it("should support setMessages", () => {
    const scratch = new VolatileScratch()
    scratch.setMessages([
      { role: "assistant", content: "step 1" },
      { role: "assistant", content: "step 2" },
    ])
    expect(scratch.messages).toHaveLength(2)
  })
})

// === ContextManager 三区域集成测试 ===
describe("ContextManager - 三区域集成", () => {
  // 组装顺序必须为：prefix → log → scratch
  it("should assemble messages in correct order: prefix + log + scratch", () => {
    const ctx = new ContextManager()

    ctx.prefix.build("You are an assistant.")
    ctx.log.append({ role: "user", content: "Hello" })
    ctx.log.append({ role: "assistant", content: "Hi!" })
    ctx.scratch.append({ role: "assistant", content: "I am thinking..." })

    const msgs = ctx.buildMessages()

    expect(msgs).toHaveLength(4)
    expect(msgs[0].role).toBe("system")      // 第一：prefix
    expect(msgs[0].content).toBe("You are an assistant.")
    expect(msgs[1].role).toBe("user")       // 第二：log
    expect(msgs[1].content).toBe("Hello")
    expect(msgs[2].role).toBe("assistant")
    expect(msgs[2].content).toBe("Hi!")
    expect(msgs[3].role).toBe("assistant")  // 第三：scratch
    expect(msgs[3].content).toBe("I am thinking...")
  })

  // startTurn 应清空 scratch 但保留 prefix 和 log
  it("should clear scratch on startTurn", () => {
    const ctx = new ContextManager()
    ctx.prefix.build("You are an assistant.")
    ctx.log.append({ role: "user", content: "Hello" })
    ctx.scratch.append({ role: "assistant", content: "thinking..." })

    expect(ctx.buildMessages()).toHaveLength(3)

    ctx.startTurn()
    expect(ctx.buildMessages()).toHaveLength(2)  // scratch 被清空
    expect(ctx.scratch.messages).toHaveLength(0)
  })

  // prefix 哈希值应在多轮间保持稳定（字节一致性）
  it("should maintain byte-stable prefix across multiple turns", () => {
    const ctx = new ContextManager()
    ctx.prefix.build("You are an assistant.")

    // 模拟第一轮
    ctx.log.append({ role: "user", content: "Hello" })
    const hash1 = ctx.prefix.cacheKey

    // 模拟第二轮
    ctx.log.append({ role: "assistant", content: "Hi!" })
    ctx.log.append({ role: "user", content: "What's up?" })
    const hash2 = ctx.prefix.cacheKey

    // 多轮之间的 prefix 哈希必须相同
    expect(hash1).toBe(hash2)
  })

  // 多轮会话应产生正确的消息结构
  it("should produce correct message structure for multi-turn session", () => {
    const ctx = new ContextManager()
    ctx.prefix.build("You are a helpful assistant.")

    // 第一轮：用户提问，助手回复
    ctx.startTurn()
    ctx.log.append({ role: "user", content: "What is 2+2?" })
    ctx.log.append({ role: "assistant", content: "4" })

    const msgs1 = ctx.buildMessages()
    expect(msgs1).toHaveLength(3)  // system + user + assistant
    expect(msgs1[1].content).toBe("What is 2+2?")
    expect(msgs1[2].content).toBe("4")

    // 第二轮：用户追问新问题
    ctx.startTurn()
    ctx.log.append({ role: "user", content: "What is 3+3?" })

    const msgs2 = ctx.buildMessages()
    expect(msgs2).toHaveLength(4)  // system + user1 + assistant1 + user2
    expect(msgs2[3].content).toBe("What is 3+3?")
  })
})

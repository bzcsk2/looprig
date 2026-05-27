// 导入 Node.js readline 模块，用于实现命令行交互
import * as readline from "node:readline"
// 配置加载函数
import { loadConfig } from "./config.js"
// Agent 循环核心类
import { AgentLoop } from "./loop.js"
// Agent 事件类型
import type { AgentEvent } from "./types.js"

// 系统提示词：定义助手的行为准则
const SYSTEM_PROMPT = `你是一个高效的编码助手。
你简洁、精确，只输出必要的内容。
当用户需要读取文件时，使用 read_file 工具。
当用户需要执行命令时，使用 run_command 工具。
当任务完成时，明确告知用户。`

// 格式化 token 用量信息为可读字符串
function printUsage(u: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; prompt_cache_hit_tokens?: number; prompt_cache_miss_tokens?: number }): string {
  // 基础信息：输入 tokens / 输出 tokens
  const parts = [`in ${u.prompt_tokens ?? 0}`, `out ${u.completion_tokens ?? 0}`]
  // 如果有缓存命中，附加 cache hit 数
  if (u.prompt_cache_hit_tokens) parts.push(`cache+${u.prompt_cache_hit_tokens}`)
  return parts.join(" / ")
}

// REPL 主循环：Read-Eval-Print Loop
async function repl() {
  // 加载配置（环境变量或默认值）
  const config = loadConfig()
  // 创建 Agent 实例
  const agent = new AgentLoop(config)
  // 设置系统提示词
  agent.setSystemPrompt(SYSTEM_PROMPT)

  // 创建 readline 接口，监听标准输入输出
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "",
  })

  // 输出启动信息到 stderr（不影响 stdout 的输出流）
  console.error(`deepicode v0.1.0 — 三区域上下文分割 + pi-ai`)
  console.error(`  API: ${config.baseUrl}`)
  console.error(`  模型: ${config.model}`)
  console.error(`  输入 /bye 或 Ctrl+C 退出\n`)

  // ask：封装 readline.question 为 Promise 形式
  const ask = (): Promise<string> => new Promise((resolve) => rl.question(">>> ", resolve))

  // 首次输入：优先取命令行参数，否则进入交互模式询问
  let input = process.argv.slice(2).join(" ").trim() || (await ask().catch(() => ""))

  // 主循环：不断读取用户输入并处理
  while (input) {
    // 退出命令检查
    if (input === "/bye" || input === "/exit") break

    console.error()
    // 将输入交给 agent.chat 处理，逐事件消费流式输出
    for await (const event of agent.chat(input)) {
      switch (event.type) {
        case "text":
          // 文本输出写入 stdout（正常输出流）
          process.stdout.write(event.content ?? "")
          break
        case "reasoning":
          // 思考过程：当前暂不展示，直接跳过
          break
        case "tool_call_start":
          // 工具调用开始时，在 stderr 打印工具名和参数摘要
          console.error(`\n[工具] ${event.toolCall?.function.name}(${event.toolCall?.function.arguments.slice(0, 80)})`)
          break
        case "tool_call_end":
          // 工具调用完成
          console.error(`[工具完成]`)
          break
        case "usage":
          // token 用量信息
          console.error(`\n--- ${printUsage(event.usage ?? {})}`)
          break
        case "error":
          // 错误信息
          console.error(`\n错误: ${event.error}`)
          break
      }
    }

    console.error()
    // 获取下一轮用户输入
    input = await ask().catch(() => "")
  }

  // 关闭 readline 接口
  rl.close()
}

// 启动 REPL，捕获顶层异常
repl().catch(console.error)

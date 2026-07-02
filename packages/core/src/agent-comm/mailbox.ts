import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs"
import { resolve, dirname } from "node:path"
import { randomUUID } from "node:crypto"
import type { AgentMessage, AgentRole, MailboxReadOptions } from "./types.js"

export class Mailbox {
  private basePath: string

  constructor(basePath?: string) {
    this.basePath = basePath ?? resolve(process.cwd(), ".covalo", "sessions")
  }

  private mailboxPath(threadId: string): string {
    return resolve(this.basePath, threadId, "mailbox.jsonl")
  }

  send(
    msg: Omit<AgentMessage, "id" | "createdAt" | "readAt">,
  ): AgentMessage {
    const message: AgentMessage = {
      ...msg,
      id: randomUUID(),
      createdAt: Date.now(),
    }

    const path = this.mailboxPath(msg.threadId)
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(path, JSON.stringify(message) + "\n", "utf-8")
    return message
  }

  read(options: MailboxReadOptions): AgentMessage[] {
    const path = this.mailboxPath(options.threadId)
    if (!existsSync(path)) return []

    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean)
    const messages: AgentMessage[] = []

    for (const line of lines) {
      try {
        const msg = JSON.parse(line) as AgentMessage

        if (options.goalId && msg.goalId !== options.goalId) continue
        if (options.workflowId && msg.workflowId !== options.workflowId) continue
        if (options.to && msg.to !== options.to) continue
        if (options.unreadOnly && msg.readAt !== undefined) continue

        messages.push(msg)
      } catch {
        // Skip corrupted lines
        continue
      }
    }

    if (options.limit && messages.length > options.limit) {
      return messages.slice(0, options.limit)
    }

    return messages
  }

  markRead(messageId: string, threadId: string): boolean {
    const path = this.mailboxPath(threadId)
    if (!existsSync(path)) return false

    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean)
    let found = false

    const updated = lines.map((line) => {
      try {
        const msg = JSON.parse(line) as AgentMessage
        if (msg.id === messageId && !msg.readAt) {
          msg.readAt = Date.now()
          found = true
          return JSON.stringify(msg)
        }
        return line
      } catch {
        return line
      }
    })

    if (found) {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, updated.join("\n") + "\n", "utf-8")
    }

    return found
  }

  hasTriggerTurnItems(threadId: string, goalId?: string): boolean {
    const path = this.mailboxPath(threadId)
    if (!existsSync(path)) return false

    const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean)
    for (const line of lines) {
      try {
        const msg = JSON.parse(line) as AgentMessage
        if (msg.delivery === "trigger_turn" && msg.readAt === undefined) {
          if (goalId && msg.goalId !== goalId) continue
          return true
        }
      } catch {
        continue
      }
    }
    return false
  }
}



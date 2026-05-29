import { Component } from "../tui";
import { visibleWidth } from "../utils";

interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
}

const ROLE_LABELS: Record<string, string> = { user: "You", assistant: "Deepicode", tool: "Tool" };

export class ChatView implements Component {
  messages: ChatMessage[] = [];
  autoScroll = true;

  addMessage(role: ChatMessage["role"], content: string): void {
    this.messages.push({ role, content });
  }

  updateLastMessage(content: string): void {
    if (this.messages.length === 0) return;
    this.messages[this.messages.length - 1]!.content = content;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const lines: string[] = [];
    // show last N messages that fit; each message = header + content lines + spacer
    const w = Math.max(20, width);
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i]!;
      const label = ROLE_LABELS[msg.role] ?? msg.role;
      const header = `\x1b[1m${label}\x1b[0m`;
      const msgLines: string[] = [header];
      const contentLines = msg.content.split("\n");
      for (const cl of contentLines) {
        if (cl.length === 0) { msgLines.push(""); continue; }
        if (visibleWidth(cl) > w - 2) {
          // simple wrap at width
          let remaining = cl;
          while (remaining.length > 0) {
            const chunk = remaining.slice(0, w - 2);
            msgLines.push(` ${chunk}`);
            remaining = remaining.slice(w - 2);
          }
        } else {
          msgLines.push(` ${cl}`);
        }
      }
      // prepend so newest messages are at bottom
      lines.unshift(...msgLines);
    }
    return lines;
  }
}

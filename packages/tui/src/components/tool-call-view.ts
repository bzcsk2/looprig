import { Component } from "../tui";

interface ToolCall {
  index: number;
  name: string;
  status: "pending" | "running" | "done" | "error";
  content?: string;
}

const STATUS_ORDER: Record<ToolCall["status"], number> = { pending: 0, running: 1, done: 2, error: 3 };

export class ToolCallView implements Component {
  #tools: ToolCall[] = [];

  addTool(name: string, index: number): void {
    this.#tools.push({ name, index, status: "pending" });
  }

  updateTool(index: number, name: string, status: ToolCall["status"], content?: string): void {
    // match by index first (unique), fallback to name match for backward compat
    let tool: ToolCall | undefined;
    if (index >= 0) {
      tool = this.#tools.find(t => t.index === index);
    }
    if (!tool) {
      tool = this.#tools.find(t => t.name === name && t.status === "pending");
    }
    if (!tool) {
      // last resort: find by name only
      tool = this.#tools.find(t => t.name === name);
    }
    if (!tool) return;
    // prevent downgrade: done/error → running is a no-op
    const current = STATUS_ORDER[tool.status];
    const incoming = STATUS_ORDER[status];
    if (incoming < current) return;
    tool.status = status;
    if (content !== undefined) tool.content = content;
  }

  clear(): void { this.#tools = []; }
  invalidate(): void {}

  render(width: number): string[] {
    if (this.#tools.length === 0) return [];
    const lines: string[] = [];
    for (const t of this.#tools) {
      const icon = t.status === "running" ? "\x1b[93m⟳\x1b[0m" : t.status === "done" ? "\x1b[92m✓\x1b[0m" : t.status === "error" ? "\x1b[91m✗\x1b[0m" : "\x1b[90m⋯\x1b[0m";
      const line = ` ${icon} \x1b[90m${t.name}\x1b[0m`;
      lines.push(line);
    }
    return lines;
  }
}

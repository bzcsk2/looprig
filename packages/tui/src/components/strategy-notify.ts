import { Component } from "../tui";

const TIERS = [
  { id: "chat-fast", label: "Chat Fast", price: "¥0.50/M", desc: "快速问答" },
  { id: "chat-full", label: "Chat Full", price: "¥2.00/M", desc: "一般对话" },
  { id: "reasoner-budget", label: "Reasoner Budget", price: "¥4.00/M", desc: "推理(省钱)" },
  { id: "reasoner", label: "Reasoner", price: "¥16.00/M", desc: "深度推理" },
];

export class StrategyNotify implements Component {
  #selected = 1;
  #countdown = 3;
  onSelect?: (id: string) => void;
  #timer?: ReturnType<typeof setInterval>;

  startCountdown(cb: (id: string) => void): void {
    if (this.#timer) clearInterval(this.#timer);
    this.onSelect = cb;
    this.#countdown = 3;
    this.#timer = setInterval(() => {
      this.#countdown--;
      if (this.#countdown <= 0) { clearInterval(this.#timer); cb(TIERS[this.#selected]!.id); }
    }, 1000);
  }

  handleInput(data: string): void {
    if (data === "\x1b[C" || data === "right") this.#selected = Math.min(this.#selected + 1, TIERS.length - 1);
    if (data === "\x1b[D" || data === "left") this.#selected = Math.max(this.#selected - 1, 0);
    if (data === "\r" || data === "\n") { clearInterval(this.#timer); this.onSelect?.(TIERS[this.#selected]!.id); }
  }

  invalidate(): void {}

  render(width: number): string[] {
    const lines: string[] = [];
    lines.push("\x1b[1m  选择推理强度  \x1b[0m");
    lines.push("");
    const cardW = Math.max(3, Math.floor((width - 10) / 4));
    let row = "";
    for (let i = 0; i < TIERS.length; i++) {
      const t = TIERS[i]!;
      const sel = i === this.#selected;
      const prefix = sel ? "\x1b[7m" : "";
      const suffix = sel ? "\x1b[0m" : "";
      const label = t.label.padEnd(cardW);
      row += ` ${prefix}${label}${suffix} `;
    }
    lines.push(row);
    const row2 = TIERS.map(t => ` ${t.price.padEnd(cardW)} `).join("");
    lines.push(row2);
    const row3 = TIERS.map(t => ` ${t.desc.padEnd(cardW)} `).join("");
    lines.push(row3);
    lines.push("");
    lines.push(`  \x1b[90m自动选择 ${this.#countdown}s\x1b[0m`);
    return lines;
  }
}

import { Text } from "./text";
import { TUI } from "../tui";

export class Loader extends Text {
  #ui: TUI;
  #spinnerColorFn: (text: string) => string;
  #messageColorFn: (text: string) => string;
  #message: string;
  #spinnerFrames: string[];
  #frameIndex = 0;
  #intervalId?: ReturnType<typeof setInterval>;

  constructor(
    ui: TUI,
    spinnerColorFn: (text: string) => string,
    messageColorFn: (text: string) => string,
    message: string,
    spinnerFrames?: string[],
  ) {
    super("", 1, 1);
    this.#ui = ui;
    this.#spinnerColorFn = spinnerColorFn;
    this.#messageColorFn = messageColorFn;
    this.#message = message;
    this.#spinnerFrames = spinnerFrames ?? ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    this.#start();
  }

  #start(): void {
    this.#updateText();
    this.#intervalId = setInterval(() => {
      this.#frameIndex = (this.#frameIndex + 1) % this.#spinnerFrames.length;
      this.#updateText();
      this.#ui.requestRender();
    }, 80);
  }

  #updateText(): void {
    const frame = this.#spinnerColorFn(this.#spinnerFrames[this.#frameIndex]!);
    const msg = this.#messageColorFn(this.#message);
    this.setText(`${frame} ${msg}`);
  }

  destroy(): void {
    if (this.#intervalId) { clearInterval(this.#intervalId); this.#intervalId = undefined; }
  }
}

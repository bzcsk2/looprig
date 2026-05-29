import { TUI } from "./tui";
import { ChatView } from "./components/chat-view";
import { ToolCallView } from "./components/tool-call-view";
import { TokenEstimate } from "./components/token-estimate";
import { StatusLine } from "./components/status-line";
import { Input } from "./components/input";
import type { LoopEvent } from "../../core/src/interface.js";

export function processEvents(tui: TUI, chatView: ChatView, toolView: ToolCallView, _tokenEst: TokenEstimate, statusLine: StatusLine, _input: Input, events: AsyncGenerator<LoopEvent>): void {
  (async () => {
    let assistantContent = "";
    let assistantStarted = false;
    try {
      for await (const event of events) {
        switch (event.role) {
          case "assistant_delta":
            if (!assistantStarted) { chatView.addMessage("assistant", ""); assistantStarted = true; }
            assistantContent += event.content ?? "";
            chatView.updateLastMessage(assistantContent);
            break;
          case "assistant_final":
            if (!assistantStarted && assistantContent) {
              chatView.addMessage("assistant", assistantContent);
            }
            assistantStarted = false;
            assistantContent = "";
            break;
          case "reasoning_delta":
            statusLine.setModel(`thinking: ${(event.content ?? "").slice(0, 60)}...`);
            break;
          case "tool_start":
            toolView.addTool(event.toolName ?? "unknown", event.toolCallIndex ?? -1);
            break;
          case "tool":
            if (event.toolName) toolView.updateTool(event.toolCallIndex ?? -1, event.toolName, "done");
            break;
          case "tool_progress":
            if (event.toolName) toolView.updateTool(event.toolCallIndex ?? -1, event.toolName, "running");
            break;
          case "error":
            if (event.toolName) {
              toolView.updateTool(event.toolCallIndex ?? -1, event.toolName, "error");
            } else {
              statusLine.setModel(`\x1b[91mError: ${(event.content ?? "").slice(0, 80)}\x1b[0m`);
            }
            break;
          case "warning":
            statusLine.setModel(`\x1b[93m⚠ ${event.content ?? ""}\x1b[0m`);
            break;
          case "status":
            statusLine.setModel(event.content ?? "");
            break;
        }
        tui.requestRender();
      }
    } catch (e: any) {
      statusLine.setModel(`\x1b[91mFatal: ${e?.message || e}\x1b[0m`);
      tui.requestRender();
    }
    if (assistantContent) {
      if (!assistantStarted) chatView.addMessage("assistant", assistantContent);
      tui.requestRender();
    }
  })();
}

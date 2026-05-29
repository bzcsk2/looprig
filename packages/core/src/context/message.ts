import type { ChatMessage, ToolCall } from "../types.js"

function cloneToolCall(call: ToolCall): ToolCall {
  return {
    id: call.id,
    type: call.type,
    function: {
      name: call.function.name,
      arguments: call.function.arguments,
    },
  }
}

export function cloneChatMessage(message: ChatMessage): ChatMessage {
  return {
    role: message.role,
    content: message.content,
    tool_calls: message.tool_calls?.map(cloneToolCall),
    tool_call_id: message.tool_call_id,
    name: message.name,
    is_error: message.is_error,
  }
}

export function cloneChatMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.map(cloneChatMessage)
}

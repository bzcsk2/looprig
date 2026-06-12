export {
  parseEmbeddedToolCallsFromText,
  containsEmbeddedToolCalls,
  stripEmbeddedToolCalls,
  prepareAssistantContentForHistory,
  stripResidualToolChannelMarkup,
  partialEmbeddedToolPrefixSuffix,
  EMBEDDED_TOOL_OPEN_MARKERS,
} from "./text-parsers.js"
export type { TextSpan, ParsedEmbeddedToolCalls } from "./text-parsers.js"

export {
  salvageTextToolCallsInResponse,
  resolveSalvagedLlmResponse,
  sanitizeAssistantContentForUser,
  TextToolCallStreamFilter,
  containsTextFormatToolCalls,
  parseTextFormatToolCalls,
  stripTextFormatToolCalls,
} from "./text-salvage.js"
export type { SalvableAssistantResponse } from "./text-salvage.js"

export { stripEmbeddedThinking } from "./thinking-strip.js"

/**
 * 剥离 assistant 正文中的思考块标签（如 thinking / reasoning）。
 */

const THINKING_BLOCK_RE = /<(?:redacted_)?think(?:ing)?>[\s\S]*?<\/(?:redacted_)?think(?:ing)?>/gi
const REASONING_BLOCK_RE = /<reasoning>[\s\S]*?<\/reasoning>/gi
const THINKING_TAIL_RE = /<(?:redacted_)?think(?:ing)?>[\s\S]*$/i
const REASONING_TAIL_RE = /<reasoning>[\s\S]*$/i

/**
 * 去掉完整与未闭合的思考块，并规整尾部空白。
 */
export function stripEmbeddedThinking(content: string): string {
  if (!content) return ""
  let result = content
    .replace(THINKING_BLOCK_RE, "")
    .replace(REASONING_BLOCK_RE, "")
    .replace(THINKING_TAIL_RE, "")
    .replace(REASONING_TAIL_RE, "")
  return result.replace(/^\s*\n+/, "").trimEnd()
}

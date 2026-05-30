export interface FoldDecision {
  action: "none" | "suggest" | "force"
  ratio: number
  used: number
  total: number
}

const CHARS_PER_TOKEN = 4
const MSG_OVERHEAD = 10
const CJK_RE = /[一-鿿㐀-䶿豈-﫿]/g
const PUNCT_RE = /[^\w\s一-鿿㐀-䶿豈-﫿]/g

/** 精细估算（CJK 1.5 token/字, 标点 2 token/字, ASCII CHARS_PER_TOKEN 字/token） */
export function refinedEstimate(text: string): number {
  const cjkCount = (text.match(CJK_RE) || []).length
  const punctCount = (text.match(PUNCT_RE) || []).length
  const asciiCount = text.length - cjkCount - punctCount
  return Math.ceil(cjkCount * 1.5 + punctCount * 2 + asciiCount / CHARS_PER_TOKEN)
}

export function estimateTokens(messages: Array<{ role?: string; content?: string | null; reasoning_content?: string | null }>): number {
  let total = 0
  for (const msg of messages) {
    total += MSG_OVERHEAD
    if (msg.content) total += refinedEstimate(msg.content)
    if (msg.reasoning_content) total += refinedEstimate(msg.reasoning_content)
  }
  return total
}

export function getFoldDecision(used: number, total: number): FoldDecision {
  const ratio = total > 0 ? used / total : 0
  if (ratio <= 0.65) return { action: "none", ratio, used, total }
  if (ratio <= 0.75) return { action: "suggest", ratio, used, total }
  if (ratio <= 0.80) return { action: "suggest", ratio, used, total }
  return { action: "force", ratio, used, total }
}

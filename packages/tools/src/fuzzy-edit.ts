export interface FuzzyEditResult {
  edited: string
  replacedCount: number
  method: string
}

export function fuzzyReplaceOnce(haystack: string, needle: string, replacement: string): FuzzyEditResult | null {
  // Pass 1: exact match
  let idx = haystack.indexOf(needle)
  if (idx >= 0) {
    return { edited: haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length), replacedCount: 1, method: "exact" }
  }

  // Pass 2: trimmed variants (trim entire needle, or trim right sides of lines)
  const trimmedNeedle = needle.trim()
  if (trimmedNeedle) {
    let j = haystack.indexOf(trimmedNeedle)
    if (j >= 0) {
      return { edited: haystack.slice(0, j) + replacement + haystack.slice(j + trimmedNeedle.length), replacedCount: 1, method: "trimmed_full" }
    }
  }

  const rightTrimmed = trimRightLines(needle)
  if (rightTrimmed && rightTrimmed !== needle) {
    let j = haystack.indexOf(rightTrimmed)
    if (j >= 0) {
      return { edited: haystack.slice(0, j) + replacement + haystack.slice(j + rightTrimmed.length), replacedCount: 1, method: "trimmed_lines" }
    }
  }

  // Pass 3: Flexible whitespace match using regex
  // Split needle on whitespace, escape each segment independently, then join with \s+
  // This avoids backslash-whitespace interaction from escapeRegExp
  try {
    const trimmed = needle.trim()
    if (trimmed) {
      const parts = trimmed.split(/\s+/)
      if (parts.length > 1) {
        const escapedParts = parts.map(escapeRegExp)
        const flexRegex = new RegExp(escapedParts.join('\\s+'))
        const match = haystack.match(flexRegex)
        if (match && match.index !== undefined) {
          return {
            edited: haystack.slice(0, match.index) + replacement + haystack.slice(match.index + match[0].length),
            replacedCount: 1,
            method: "flexible_whitespace"
          }
        }
      }
    }
  } catch (e) {
    // Ignore regex compilation errors
  }

  return null
}

function escapeRegExp(string: string): string {
  // Escapes regex special characters. Doesn't escape spaces.
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function trimRightLines(s: string): string {
  return s
    .split("\n")
    .map((l) => l.replace(/\s+$/u, ""))
    .join("\n")
}

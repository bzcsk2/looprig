export interface FuzzyEditResult {
  edited: string
  replacedCount: number
  method: string
}

export function fuzzyReplaceOnce(haystack: string, needle: string, replacement: string): FuzzyEditResult | null {
  const passes: Array<{ name: string; transform: (s: string) => string; mapBack?: undefined }> = [
    { name: "exact", transform: (s) => s },
    { name: "trimRightLines", transform: trimRightLines },
    { name: "normalizeWhitespace", transform: normalizeWhitespace },
    { name: "normalizeIndent", transform: normalizeIndent },
  ]

  for (const pass of passes) {
    const h = pass.transform(haystack)
    const n = pass.transform(needle)
    const idx = h.indexOf(n)
    if (idx < 0) continue

    // mapping back is hard; keep fuzzy fallback simple by only using transforms that preserve length-ish.
    // For these passes we still apply replacement on original via exact search when possible.
    if (pass.name === "exact") {
      return { edited: haystack.slice(0, idx) + replacement + haystack.slice(idx + needle.length), replacedCount: 1, method: pass.name }
    }

    // For fuzzy passes, fall back to searching original needle trimmed variants.
    const altNeedles = generateAltNeedles(needle)
    for (const alt of altNeedles) {
      const j = haystack.indexOf(alt)
      if (j >= 0) return { edited: haystack.slice(0, j) + replacement + haystack.slice(j + alt.length), replacedCount: 1, method: pass.name }
    }
  }

  return null
}

function generateAltNeedles(needle: string): string[] {
  const alts = new Set<string>()
  alts.add(needle)
  alts.add(needle.trim())
  alts.add(trimRightLines(needle))
  return [...alts]
}

function trimRightLines(s: string): string {
  return s
    .split("\n")
    .map((l) => l.replace(/\s+$/u, ""))
    .join("\n")
}

function normalizeWhitespace(s: string): string {
  return s.replace(/[ \t]+/gu, " ").replace(/\r\n/gu, "\n")
}

function normalizeIndent(s: string): string {
  return s
    .split("\n")
    .map((l) => l.replace(/^\s+/u, ""))
    .join("\n")
}


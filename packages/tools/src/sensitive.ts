export const SENSITIVE_FILE_PATTERNS = [
  /(^|\/|\\)api-key$/,
  /(^|\/|\\)\.env$/,
  /(^|\/|\\)\.env\.local$/,
  /(^|\/|\\)\.git\//,
  /(^|\/|\\)id_rsa$/,
  /(^|\/|\\)id_ed25519$/,
  /(^|\/|\\)\.ssh\//,
  /(^|\/|\\)known_hosts$/,
]

export function isSensitive(path: string): boolean {
  const normalized = path.replace(/\\/g, "/")
  for (const p of SENSITIVE_FILE_PATTERNS) {
    if (p.test(normalized)) return true
  }
  return false
}

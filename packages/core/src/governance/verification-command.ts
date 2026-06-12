/**
 * 验收命令判定（BranchBudget 续段时清除 build/test 失败计数）。
 */

/** 与 harness 验收命令判定对齐。 */
export function isHarnessVerificationCommand(command: string): boolean {
  const c = command.toLowerCase()
  return /\b(npm|pnpm|yarn)\s+(run\s+)?(test:e2e|test|lint|build|typecheck|check)\b/.test(c)
    || /\b(npm|pnpm|yarn)\s+test\b/.test(c)
    || /\b(vitest|jest|mocha|pytest|go test|cargo test)\b/.test(c)
    || /\b(npx\s+vitest|npx\s+tsc|tsc\s+--no-?emit)\b/i.test(command)
    || /\bnode\s+--check\b/.test(c)
}

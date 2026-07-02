import type { AgentBenchmarkCase, AgentBenchmarkSuite } from "./types.js"

export const AGENT_BENCHMARK_CASES: AgentBenchmarkCase[] = [
  {
    id: "swe-bench-lite-single-fix",
    source: "swe-bench",
    title: "SWE-bench style single issue fix",
    difficulty: "medium",
    taskType: "single-file-fix",
    prompt: "Fix a realistic GitHub issue using repository tests as evidence.",
    verification: ["Run the failing test before and after the fix.", "Summarize the changed files."],
    evaluationSignals: ["test-pass-rate", "before-after-verdict", "diff-size", "wall-time"],
    tags: ["github-issue", "regression", "tests"],
  },
  {
    id: "swe-bench-verified-multifile",
    source: "swe-bench",
    title: "SWE-bench Verified style multi-file repair",
    difficulty: "hard",
    taskType: "multi-file-refactor",
    prompt: "Resolve a bug that requires reading multiple modules and preserving public behavior.",
    verification: ["Run targeted tests.", "Run typecheck or lint when available."],
    evaluationSignals: ["test-pass-rate", "diff-size", "wall-time", "supervisor-judge"],
    tags: ["multi-file", "verified", "repository-understanding"],
  },
  {
    id: "human-eval-function-synthesis",
    source: "human-eval",
    title: "HumanEval style function synthesis",
    difficulty: "easy",
    taskType: "test-generation",
    prompt: "Implement a small function from a docstring and satisfy hidden-style examples.",
    verification: ["Run unit tests.", "Check edge cases from the prompt."],
    evaluationSignals: ["test-pass-rate", "schema-validity"],
    tags: ["unit", "algorithm", "python"],
  },
  {
    id: "mbpp-basic-programming",
    source: "mbpp",
    title: "MBPP style basic programming task",
    difficulty: "easy",
    taskType: "test-generation",
    prompt: "Implement a compact programming task with explicit examples.",
    verification: ["Run generated and provided examples."],
    evaluationSignals: ["test-pass-rate", "schema-validity"],
    tags: ["unit", "algorithm", "examples"],
  },
  {
    id: "repo-bench-navigation",
    source: "repo-bench",
    title: "RepoBench style repository navigation",
    difficulty: "medium",
    taskType: "long-horizon",
    prompt: "Find the right location in a repository and make a scoped behavior change.",
    verification: ["Explain file selection.", "Run the relevant project check."],
    evaluationSignals: ["tool-trace", "test-pass-rate", "diff-size"],
    tags: ["navigation", "long-context", "repo"],
  },
  {
    id: "codejoust-style-agent-race",
    source: "codejoust",
    title: "CodeJoust style same-task agent race",
    difficulty: "medium",
    taskType: "single-file-fix",
    prompt: "Run multiple Worker model targets on the same scoped bug and rank by objective engineering signals.",
    verification: ["Use the same repository checkout and validation command for every Worker.", "Record test pass ratio, diff size, cost, and wall time."],
    evaluationSignals: ["test-pass-rate", "cost", "diff-size", "wall-time"],
    tags: ["agent-race", "model-comparison", "objective-scoring"],
  },
  {
    id: "litebench-style-agent-rollout",
    source: "litebench",
    title: "LiteBench style multi-turn rollout",
    difficulty: "medium",
    taskType: "long-horizon",
    prompt: "Score a multi-turn Worker rollout with tool trace evidence instead of only the final answer.",
    verification: ["Persist tool names, arguments, and results for the run.", "Score the final answer and the trace efficiency."],
    evaluationSignals: ["tool-trace", "test-pass-rate", "wall-time"],
    tags: ["agent-rollout", "tool-trace", "multi-turn"],
  },
  {
    id: "agentprobe-style-regression",
    source: "agentprobe",
    title: "AgentProbe style behavior regression",
    difficulty: "easy",
    taskType: "tool-recovery",
    prompt: "Detect whether a prompt, model, or dependency change regresses an agent behavior baseline.",
    verification: ["Compare the current output to a committed baseline.", "Assert required tool calls and forbidden tool arguments."],
    evaluationSignals: ["snapshot-regression", "semantic-regression", "tool-trace", "schema-validity"],
    tags: ["regression", "snapshot", "tool-assertions"],
  },
  {
    id: "issuebenchkit-style-private-issue",
    source: "issuebenchkit",
    title: "IssueBenchKit style private issue task",
    difficulty: "medium",
    taskType: "failing-test-diagnosis",
    prompt: "Package a real local issue into a repeatable before/after benchmark with one validation command.",
    verification: ["Prove the command fails before and passes after.", "Store manifest metadata and run result JSON."],
    evaluationSignals: ["before-after-verdict", "test-pass-rate", "wall-time"],
    tags: ["private-suite", "github-issue", "before-after"],
  },
  {
    id: "covalo-tool-recovery",
    source: "covalo-regression",
    title: "Tool failure recovery",
    difficulty: "medium",
    taskType: "tool-recovery",
    prompt: "Recover from malformed tool output, stale reads, or a failed command without losing task progress.",
    verification: ["Show the recovery step.", "Avoid repeating the same failing action more than twice."],
    evaluationSignals: ["tool-trace", "snapshot-regression", "supervisor-judge"],
    tags: ["agentic", "tool-use", "recovery"],
  },
]

export const DEFAULT_AGENT_BENCHMARK_SUITE: AgentBenchmarkSuite = {
  id: "covalo-agent-scoring-v1",
  title: "Covalo Agent Run Scoring Suite",
  description: "A mixed suite inspired by common GitHub issue repair, academic coding-agent benchmarks, and public agent-eval tooling.",
  cases: AGENT_BENCHMARK_CASES,
}

export function selectBenchmarkCases(tags: string[] = []): AgentBenchmarkCase[] {
  if (tags.length === 0) return [...AGENT_BENCHMARK_CASES]
  const wanted = new Set(tags)
  return AGENT_BENCHMARK_CASES.filter(c =>
    c.tags.some(tag => wanted.has(tag))
    || c.evaluationSignals.some(signal => wanted.has(signal))
    || wanted.has(c.source)
    || (c.difficulty && wanted.has(c.difficulty))
  )
}

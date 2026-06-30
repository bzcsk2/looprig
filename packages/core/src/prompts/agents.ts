/**
 * Agent definitions — Worker, Supervisor, Subagent built-in prompts.
 *
 * @module
 */
export {
  getAgent,
  getAgentSystemPrompt,
  agentConfigFor,
  AGENTS,
} from "../agent.js";
export type { AgentDefinition } from "../agent.js";

export {
  getSubagentSystemPrompt,
  BUILTIN_SUBAGENTS,
} from "../subagent/definition.js";

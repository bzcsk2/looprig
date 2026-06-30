/**
 * Workflow prompts — Supervisor guided loop, coordinator prompts.
 *
 * @module
 */
export {
  buildSupervisorRequestMessages,
  formatSupervisorAdviceForScratch,
  injectAdviceToContext,
  buildSupervisorDegradedMessage,
} from "../supervisor/guided-loop.js";

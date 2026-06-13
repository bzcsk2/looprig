import { z } from "zod"

export const AgentRoleSchema = z.enum(["worker", "supervisor"])

export const HarnessStrictnessSchema = z.enum(["strict", "normal", "loose"])

export const ThinkingModeSchema = z.enum(["off", "open", "high"])

export const AgentRoleProfileSchema = z.strictObject({
  role: AgentRoleSchema,
  modelTarget: z.string().min(1),
  harness: HarnessStrictnessSchema,
  thinking: ThinkingModeSchema,
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  tools: z.strictObject({
    allow: z.array(z.string()).optional(),
    deny: z.array(z.string()).optional(),
  }),
  plugins: z.array(z.string()),
  mcpServers: z.array(z.string()),
  skills: z.array(z.string()),
})

export const AgentProfilesConfigSchema = z.strictObject({
  version: z.literal(1),
  worker: AgentRoleProfileSchema,
  supervisor: AgentRoleProfileSchema,
}).refine(
  (data) => data.worker.role === "worker",
  { message: "worker.role must be 'worker'" }
).refine(
  (data) => data.supervisor.role === "supervisor",
  { message: "supervisor.role must be 'supervisor'" }
)

export type ValidatedAgentProfilesConfig = z.infer<typeof AgentProfilesConfigSchema>

export function validateAgentProfiles(
  data: unknown
): { success: true; data: ValidatedAgentProfilesConfig } | { success: false; error: string } {
  const result = AgentProfilesConfigSchema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  const errorMessages = result.error.issues.map(
    (issue) => `${issue.path.join(".")}: ${issue.message}`
  )
  return { success: false, error: errorMessages.join("; ") }
}

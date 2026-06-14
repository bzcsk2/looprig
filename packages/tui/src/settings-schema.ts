import { z } from "zod"

export const PersistedSkillSchema = z.object({
  name: z.string().min(1),
  description: z.string(),
  content: z.string(),
})

export const TuiSettingsSchema = z.object({
  agent: z.string().optional(),
  thinkingMode: z.string().optional(),
  activeSkills: z.array(PersistedSkillSchema).optional(),
  theme: z.string().optional(),
  workflowMode: z.enum(["alone", "subagent", "loop"]).optional(),
})

export const LangConfigSchema = z.object({
  lang: z.enum(["zh-CN", "en"]),
})

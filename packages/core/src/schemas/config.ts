import { z } from "zod"

export const LastConfigSchema = z.object({
  provider: z.string().optional(),
  model: z.string().optional(),
  baseUrl: z.string().optional(),
})

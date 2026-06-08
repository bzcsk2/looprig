import { z } from "zod"

export const PluginSpecSchema = z.union([
  z.string(),
  z.array(z.unknown()).min(2).max(2),
  z.object({ spec: z.string(), options: z.record(z.string(), z.unknown()).optional() }),
])

export const PluginConfigSchema = z.array(PluginSpecSchema)

import { z } from "zod"

export const McpServerConfigSchema = z.object({
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
})

export const McpConfigSchema = z.object({
  mcpServers: z.record(z.string(), McpServerConfigSchema).optional(),
})

export const McpAuthEntrySchema = z.object({
  apiKey: z.string().min(1),
  updatedAt: z.number(),
})

export const McpAuthStoreSchema = z.record(z.string(), McpAuthEntrySchema)

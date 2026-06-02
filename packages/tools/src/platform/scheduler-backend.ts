import { platform as hostPlatform } from "node:os"
import type { SupportedPlatform } from "./shell-backend.js"

export type SchedulerBackend = { id: "crontab" | "schtasks" | "unsupported" }

export function getSchedulerBackend(platform: SupportedPlatform = normalizePlatform()): SchedulerBackend {
  return { id: platform === "win32" ? "schtasks" : "crontab" }
}

function normalizePlatform(): SupportedPlatform {
  const value = hostPlatform()
  return value === "win32" || value === "darwin" ? value : "linux"
}

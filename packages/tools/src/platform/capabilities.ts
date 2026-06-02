import { platform as hostPlatform } from "node:os"
import { getNotificationBackend } from "./notification-backend.js"
import { getSchedulerBackend } from "./scheduler-backend.js"
import { resolveShellBackend, type ShellBackend, type SupportedPlatform } from "./shell-backend.js"

export interface PlatformCapabilities {
  platform: SupportedPlatform
  shell: ShellBackend
  scheduler: { id: "crontab" | "schtasks" | "unsupported" }
  notification: { id: "notify-send" | "osascript" | "powershell" | "terminal-bell" }
  supportsPosixSignals: boolean
}

export function normalizePlatform(value = hostPlatform()): SupportedPlatform {
  if (value === "win32" || value === "darwin") return value
  return "linux"
}

export async function getPlatformCapabilities(platform = normalizePlatform()): Promise<PlatformCapabilities> {
  const shell = await resolveShellBackend(platform)
  return {
    platform,
    shell,
    scheduler: getSchedulerBackend(platform),
    notification: getNotificationBackend(platform),
    supportsPosixSignals: platform !== "win32",
  }
}

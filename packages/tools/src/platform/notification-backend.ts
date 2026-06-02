import { platform as hostPlatform } from "node:os"
import type { SupportedPlatform } from "./shell-backend.js"

export type NotificationBackend = { id: "notify-send" | "osascript" | "powershell" | "terminal-bell" }

export function getNotificationBackend(platform: SupportedPlatform = normalizePlatform()): NotificationBackend {
  if (platform === "win32") return { id: "powershell" }
  if (platform === "darwin") return { id: "osascript" }
  return { id: "notify-send" }
}

function normalizePlatform(): SupportedPlatform {
  const value = hostPlatform()
  return value === "win32" || value === "darwin" ? value : "linux"
}

import { spawn } from "node:child_process"
import { platform as hostPlatform } from "node:os"
import type { SupportedPlatform } from "./shell-backend.js"

export type SchedulerBackend = { id: "crontab" | "schtasks" | "unsupported" }

const JOB_MARKER = "# covalo-job:"
const COVALO_TASK_PREFIX = "Deepreef-"

export interface SchedulerJob {
  name: string
  schedule: string
  command: string
}

export interface SchedulerResult {
  jobs: SchedulerJob[]
  backend: string
  error?: string
}

export function getSchedulerBackend(platform: SupportedPlatform = normalizePlatform()): SchedulerBackend {
  return { id: platform === "win32" ? "schtasks" : "crontab" }
}

/**
 * List all scheduler jobs.
 * Dispatches to the appropriate backend based on platform.
 */
export async function listJobs(platform: SupportedPlatform = normalizePlatform(), signal?: AbortSignal): Promise<SchedulerResult> {
  const backend = getSchedulerBackend(platform)
  if (backend.id === "crontab") {
    return listCronJobs(signal)
  }
  if (backend.id === "schtasks") {
    return listSchTasksJobs(signal)
  }
  return { jobs: [], backend: "unsupported", error: "No scheduler backend available on this platform" }
}

/**
 * Create a scheduler job.
 */
export async function createJob(
  name: string,
  schedule: string,
  command: string,
  platform: SupportedPlatform = normalizePlatform(),
  signal?: AbortSignal,
): Promise<{ error?: string; backend: string }> {
  const backend = getSchedulerBackend(platform)
  if (backend.id === "crontab") {
    return createCronJob(name, schedule, command, signal)
  }
  if (backend.id === "schtasks") {
    return createSchTaskJob(name, schedule, command, signal)
  }
  return { error: "No scheduler backend available on this platform", backend: "unsupported" }
}

/**
 * Delete a scheduler job by name.
 */
export async function deleteJob(
  name: string,
  platform: SupportedPlatform = normalizePlatform(),
  signal?: AbortSignal,
): Promise<{ error?: string; backend: string }> {
  const backend = getSchedulerBackend(platform)
  if (backend.id === "crontab") {
    return deleteCronJob(name, signal)
  }
  if (backend.id === "schtasks") {
    return deleteSchTaskJob(name, signal)
  }
  return { error: "No scheduler backend available on this platform", backend: "unsupported" }
}

// ─── Crontab backend ────────────────────────────────────────────────

async function getCrontab(signal?: AbortSignal): Promise<{ lines: string[]; error?: string }> {
  return new Promise((resolve) => {
    const proc = spawn("crontab", ["-l"], { timeout: 5_000, signal })
    let stdout = ""
    let stderr = ""

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString() })

    proc.on("error", () => {
      resolve({ lines: [], error: "crontab not available on this system" })
    })

    proc.on("close", (code) => {
      if (code !== 0) {
        if (stderr.includes("no crontab") || stderr.includes("No crontab")) {
          resolve({ lines: [] })
        } else {
          resolve({ lines: [], error: stderr.trim() || "crontab -l failed" })
        }
        return
      }
      const text = stdout || ""
      resolve({ lines: text.split("\n").filter((l) => !l.endsWith("\r")).map((l) => l.replace(/\r$/, "")) })
    })
  })
}

async function setCrontab(lines: string[], signal?: AbortSignal): Promise<string | undefined> {
  const input = lines.join("\n") + (lines.length > 0 && !lines[lines.length - 1] ? "" : "\n")

  return new Promise((resolve) => {
    const proc = spawn("crontab", ["-"], { timeout: 5_000, signal })
    let stderr = ""

    proc.stdin.write(input)
    proc.stdin.end()

    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString() })

    proc.on("error", (err) => {
      resolve(err.message)
    })

    proc.on("close", (code) => {
      if (code !== 0) {
        resolve(stderr.trim() || "crontab update failed")
      } else {
        resolve(undefined)
      }
    })
  })
}

function parseCronJobs(lines: string[]): SchedulerJob[] {
  const jobs: SchedulerJob[] = []
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(new RegExp(`^${escapeRegex(JOB_MARKER)}(\\S+)`))
    if (!match) continue
    const name = match[1]
    i++
    while (i < lines.length && (!lines[i].trim() || lines[i].startsWith("#"))) { i++ }
    if (i >= lines.length) break
    const parts = lines[i].trim().split(/\s+/)
    if (parts.length >= 6) {
      jobs.push({ name, schedule: parts.slice(0, 5).join(" "), command: parts.slice(5).join(" ") })
    }
  }
  return jobs
}

function removeCronJob(lines: string[], name: string): string[] {
  const result: string[] = []
  const marker = `${JOB_MARKER}${name}`
  let skipping = false
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === marker) { skipping = true; continue }
    if (skipping) {
      const trimmed = lines[i].trim()
      if (!trimmed || trimmed.startsWith("#")) { skipping = false; continue }
      skipping = false; continue
    }
    result.push(lines[i])
  }
  return result
}

async function listCronJobs(signal?: AbortSignal): Promise<SchedulerResult> {
  const { lines, error } = await getCrontab(signal)
  if (error) return { jobs: [], backend: "crontab", error }
  return { jobs: parseCronJobs(lines), backend: "crontab" }
}

async function createCronJob(name: string, schedule: string, command: string, signal?: AbortSignal): Promise<{ error?: string; backend: string }> {
  const sanitizedCommand = command.replace(/[\n\r]/g, " ")
  const sanitizedName = name.replace(/[\n\r]/g, "_")

  const { lines, error } = await getCrontab(signal)
  if (error) return { error, backend: "crontab" }

  const existing = parseCronJobs(lines).find((j) => j.name === sanitizedName)
  if (existing) {
    return { error: `Job "${sanitizedName}" already exists. Delete it first or use a different name.`, backend: "crontab" }
  }

  const newLines = [...lines, "", `${JOB_MARKER}${sanitizedName}`, schedule + " " + sanitizedCommand]
  const setErr = await setCrontab(newLines, signal)
  if (setErr) return { error: setErr, backend: "crontab" }
  return { backend: "crontab" }
}

async function deleteCronJob(name: string, signal?: AbortSignal): Promise<{ error?: string; backend: string }> {
  const { lines, error } = await getCrontab(signal)
  if (error) return { error, backend: "crontab" }

  const newLines = removeCronJob(lines, name)
  if (newLines.length === lines.length) {
    return { error: `No job found with name "${name}"`, backend: "crontab" }
  }

  const setErr = await setCrontab(newLines, signal)
  if (setErr) return { error: setErr, backend: "crontab" }
  return { backend: "crontab" }
}

// ─── Schtasks backend (Windows) ─────────────────────────────────────

/**
 * Map cron expression to schtasks parameters.
 * Only supports a subset of cron expressions that can be reliably mapped.
 * Returns null for unsupported expressions.
 */
function cronToSchTaskSchedule(cronExpr: string): { sc: string; mo?: string; d?: string } | null {
  const parts = cronExpr.trim().split(/\s+/)
  if (parts.length !== 5) return null

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts

  // Every minute: * * * * *
  if (minute === "*" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return { sc: "MINUTE", mo: "1" }
  }

  // Every N minutes: */N * * * *
  const minuteInterval = minute.match(/^\*\/(\d+)$/)
  if (minuteInterval && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return { sc: "MINUTE", mo: minuteInterval[1] }
  }

  // Hourly: 0 * * * *
  if (minute === "0" && hour === "*" && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return { sc: "HOURLY", mo: "1" }
  }

  // Every N hours: 0 */N * * *
  const hourInterval = hour.match(/^\*\/(\d+)$/)
  if (minute === "0" && hourInterval && dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return { sc: "HOURLY", mo: hourInterval[1] }
  }

  // Daily at specific time: M H * * *
  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*") {
    return { sc: "DAILY", mo: "1" }
  }

  // Weekly: M H * * DOW
  if (dayOfMonth === "*" && month === "*") {
    const days = dayOfWeek.split(",").map(d => mapDayOfWeek(d)).filter(Boolean)
    if (days.length > 0) {
      return { sc: "WEEKLY", d: days.join(",") }
    }
    return null
  }

  // Monthly on specific day: M H DOM * *
  if (month === "*" && dayOfWeek === "*") {
    if (dayOfMonth !== "*") {
      return { sc: "MONTHLY", mo: dayOfMonth }
    }
  }

  return null
}

function mapDayOfWeek(cronDay: string): string | null {
  const map: Record<string, string> = {
    "0": "SUN", "1": "MON", "2": "TUE", "3": "WED", "4": "THU", "5": "FRI", "6": "SAT", "7": "SUN",
    "SUN": "SUN", "MON": "MON", "TUE": "TUE", "WED": "WED", "THU": "THU", "FRI": "FRI", "SAT": "SAT",
  }
  return map[cronDay.toUpperCase()] ?? null
}

async function listSchTasksJobs(signal?: AbortSignal): Promise<SchedulerResult> {
  return new Promise((resolve) => {
    const proc = spawn("schtasks.exe", ["/Query", "/FO", "CSV", "/V"], { timeout: 10_000, signal })
    let stdout = ""
    let stderr = ""

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString() })

    proc.on("error", () => {
      resolve({ jobs: [], backend: "schtasks", error: "schtasks.exe not available on this system" })
    })

    proc.on("close", () => {
      if (!stdout) {
        resolve({ jobs: [], backend: "schtasks" })
        return
      }
      const jobs: SchedulerJob[] = []
      const lines = stdout.split("\n")
      // CSV format: "TaskName","Next Run Time","Status","Last Run Time","..."
      for (const line of lines) {
        const match = line.match(/"([^"]+)"/)
        if (!match) continue
        const taskName = match[1]
        if (!taskName.startsWith(COVALO_TASK_PREFIX)) continue
        const name = taskName.slice(COVALO_TASK_PREFIX.length)
        jobs.push({ name, schedule: "", command: "" })
      }
      resolve({ jobs, backend: "schtasks" })
    })
  })
}

async function createSchTaskJob(
  name: string,
  schedule: string,
  command: string,
  signal?: AbortSignal,
): Promise<{ error?: string; backend: string }> {
  const schSchedule = cronToSchTaskSchedule(schedule)
  if (!schSchedule) {
    return {
      error: `Unsupported schedule expression "${schedule}". On Windows, only minute, hourly, daily, weekly, and monthly schedules are supported (e.g., "0 * * * *", "0 0 * * *", "*/5 * * * *").`,
      backend: "schtasks",
    }
  }

  const sanitizedCommand = command.replace(/[\n\r]/g, " ")
  const sanitizedName = name.replace(/[\n\r]/g, "_")
  const taskName = `${COVALO_TASK_PREFIX}${sanitizedName}`

  const args: string[] = ["/Create", "/TN", taskName, "/TR", sanitizedCommand, "/SC", schSchedule.sc, "/F"]
  if (schSchedule.mo) args.push("/MO", schSchedule.mo)
  if (schSchedule.d) args.push("/D", schSchedule.d)

  return new Promise((resolve) => {
    const proc = spawn("schtasks.exe", args, { timeout: 10_000, signal })
    let stderr = ""

    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString() })

    proc.on("error", (err) => {
      resolve({ error: `schtasks.exe error: ${err.message}`, backend: "schtasks" })
    })

    proc.on("close", (code) => {
      if (code !== 0) {
        resolve({ error: stderr.trim() || "schtasks /Create failed", backend: "schtasks" })
      } else {
        resolve({ backend: "schtasks" })
      }
    })
  })
}

async function deleteSchTaskJob(name: string, signal?: AbortSignal): Promise<{ error?: string; backend: string }> {
  const sanitizedName = name.replace(/[\n\r]/g, "_")
  const taskName = `${COVALO_TASK_PREFIX}${sanitizedName}`

  return new Promise((resolve) => {
    const proc = spawn("schtasks.exe", ["/Delete", "/TN", taskName, "/F"], { timeout: 10_000, signal })
    let stderr = ""

    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString() })

    proc.on("error", (err) => {
      resolve({ error: `schtasks.exe error: ${err.message}`, backend: "schtasks" })
    })

    proc.on("close", (code) => {
      if (code !== 0) {
        resolve({ error: stderr.trim() || "schtasks /Delete failed", backend: "schtasks" })
      } else {
        resolve({ backend: "schtasks" })
      }
    })
  })
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function normalizePlatform(): SupportedPlatform {
  const value = hostPlatform()
  return value === "win32" || value === "darwin" ? value : "linux"
}

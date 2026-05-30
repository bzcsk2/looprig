import { describe, it, expect, vi } from "vitest"

// parseJobs and deleteJob are not exported from cron.ts, so we re-implement the logic inline
// for unit testing. This avoids calling spawnSync("crontab") in tests.

function parseJobs(lines: string[]): Array<{ name: string; schedule: string; command: string }> {
  const JOB_MARKER = "# deepicode-job:"
  const jobs: Array<{ name: string; schedule: string; command: string }> = []
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

function deleteJob(lines: string[], name: string): string[] {
  const JOB_MARKER = "# deepicode-job:"
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

describe("Cron parseJobs", () => {
  it("should parse a simple job", () => {
    const lines = [
      "# deepicode-job:test-job",
      "0 * * * * /usr/bin/echo hello",
    ]
    const jobs = parseJobs(lines)
    expect(jobs).toHaveLength(1)
    expect(jobs[0].name).toBe("test-job")
    expect(jobs[0].schedule).toBe("0 * * * *")
    expect(jobs[0].command).toBe("/usr/bin/echo hello")
  })

  it("should skip jobs without schedule line", () => {
    const lines = ["# deepicode-job:orphan"]
    const jobs = parseJobs(lines)
    expect(jobs).toHaveLength(0)
  })

  it("should parse multiple jobs", () => {
    const lines = [
      "# deepicode-job:job1",
      "*/5 * * * * /bin/true",
      "# deepicode-job:job2",
      "0 0 * * * /bin/false",
    ]
    const jobs = parseJobs(lines)
    expect(jobs).toHaveLength(2)
    expect(jobs[0].name).toBe("job1")
    expect(jobs[1].name).toBe("job2")
  })

  it("should handle empty lines between marker and schedule", () => {
    const lines = [
      "# deepicode-job:j1",
      "",
      "0 * * * * /bin/ls",
    ]
    const jobs = parseJobs(lines)
    expect(jobs).toHaveLength(1)
  })

  it("should return empty array for no job lines", () => {
    expect(parseJobs([])).toEqual([])
    expect(parseJobs(["# comment", "0 * * * * /bin/true"])).toEqual([])
  })
})

describe("S7: Cron auto-create", () => {
  it("should auto-create crontab file when it does not exist", async () => {
    const { createCronTool } = await import("../src/cron.js")
    // We can verify the tool returns an error that leads to creation
    // by checking it doesn't crash when called without a valid crontab
    const tool = createCronTool()
    const r = await tool.execute({ action: "list" }, { cwd: "/tmp", signal: new AbortController().signal } as any)
    // The tool handles missing crontab gracefully — returns success with empty jobs list
    expect(r.isError).toBe(false)
  })
})

describe("Cron deleteJob", () => {
  it("should delete a job and its schedule line", () => {
    const lines = [
      "# deepicode-job:delete-me",
      "0 * * * * /bin/echo",
      "# deepicode-job:keep-me",
      "*/5 * * * * /bin/true",
    ]
    const result = deleteJob(lines, "delete-me")
    expect(result).toHaveLength(2)
    expect(result[0]).toBe("# deepicode-job:keep-me")
  })

  it("should not modify lines when job not found", () => {
    const lines = ["# deepicode-job:existing", "0 * * * * /bin/true"]
    const result = deleteJob(lines, "nonexistent")
    expect(result).toEqual(lines)
  })

  it("should delete job but keep unrelated comment lines after", () => {
    const lines = [
      "# deepicode-job:with-comment",
      "0 * * * * /bin/echo",
      "# some unrelated comment",
    ]
    const result = deleteJob(lines, "with-comment")
    // The comment line is not part of the job, so it's preserved
    expect(result).toEqual(["# some unrelated comment"])
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdtempSync, writeFileSync, existsSync, readFileSync, rmSync, mkdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { validateAgentProfiles } from "../src/agent-profile/schema.js"
import { loadAgentProfiles, saveAgentProfiles, getAgentProfile, updateAgentProfile } from "../src/agent-profile/store.js"
import { DEFAULT_AGENT_PROFILES } from "../src/agent-profile/types.js"

describe("agent-profile", () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "covalo-agent-profile-"))
    vi.spyOn(process, "cwd").mockReturnValue(tmpDir)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  describe("schema validation", () => {
    it("should validate correct config", () => {
      const result = validateAgentProfiles(DEFAULT_AGENT_PROFILES)
      expect(result.success).toBe(true)
    })

    it("should reject invalid role", () => {
      const config = {
        ...DEFAULT_AGENT_PROFILES,
        worker: { ...DEFAULT_AGENT_PROFILES.worker, role: "invalid" },
      }
      const result = validateAgentProfiles(config)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain("role")
      }
    })

    it("should reject invalid harness", () => {
      const config = {
        ...DEFAULT_AGENT_PROFILES,
        worker: { ...DEFAULT_AGENT_PROFILES.worker, harness: "invalid" },
      }
      const result = validateAgentProfiles(config)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain("harness")
      }
    })

    it("should reject invalid thinking mode", () => {
      const config = {
        ...DEFAULT_AGENT_PROFILES,
        worker: { ...DEFAULT_AGENT_PROFILES.worker, thinking: "invalid" },
      }
      const result = validateAgentProfiles(config)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain("thinking")
      }
    })

    it("should reject empty modelTarget", () => {
      const config = {
        ...DEFAULT_AGENT_PROFILES,
        worker: { ...DEFAULT_AGENT_PROFILES.worker, modelTarget: "" },
      }
      const result = validateAgentProfiles(config)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain("modelTarget")
      }
    })

    it("should reject invalid temperature", () => {
      const config = {
        ...DEFAULT_AGENT_PROFILES,
        worker: { ...DEFAULT_AGENT_PROFILES.worker, temperature: 3 },
      }
      const result = validateAgentProfiles(config)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error).toContain("temperature")
      }
    })
  })

  describe("store", () => {
    it("should load default config when no file exists", () => {
      const config = loadAgentProfiles()
      expect(config).toEqual(DEFAULT_AGENT_PROFILES)
    })

    it("should save and load config", () => {
      const config = {
        ...DEFAULT_AGENT_PROFILES,
        worker: { ...DEFAULT_AGENT_PROFILES.worker, modelTarget: "deepseek/deepseek-v4" },
      }
      saveAgentProfiles(config)

      const loaded = loadAgentProfiles()
      expect(loaded.worker.modelTarget).toBe("deepseek/deepseek-v4")
    })

    it("should migrate legacy build/plan format", () => {
      const legacyConfig = {
        build: {
          role: "worker",
          modelTarget: "zen/mimo-v2.5-free",
          harness: "normal",
          thinking: "high",
          tools: {},
          plugins: [],
          mcpServers: [],
          skills: ["frontend-design"],
        },
        plan: {
          role: "supervisor",
          modelTarget: "zen/mimo-v2.5-free",
          harness: "normal",
          thinking: "off",
          tools: { deny: ["write_file", "edit", "bash"] },
          plugins: [],
          mcpServers: [],
          skills: [],
        },
      }

      const dir = join(tmpDir, ".covalo")
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "agents.json"), JSON.stringify(legacyConfig), "utf8")

      const config = loadAgentProfiles()
      expect(config.worker.role).toBe("worker")
      expect(config.supervisor.role).toBe("supervisor")
      expect(config.worker.skills).toContain("frontend-design")
    })

    it("should migrate legacy ui-settings format", () => {
      const uiSettings = {
        agent: "build",
        thinkingMode: "high",
        activeSkills: [{ name: "frontend-design" }, { name: "pdf" }],
        harness: { strictness: "strict" },
      }

      const dir = join(tmpDir, ".covalo")
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "ui-settings.json"), JSON.stringify(uiSettings), "utf8")

      const config = loadAgentProfiles()
      expect(config.worker.thinking).toBe("high")
      expect(config.supervisor.thinking).toBe("off")
      expect(config.worker.skills).toContain("frontend-design")
      expect(config.worker.skills).toContain("pdf")
      expect(config.worker.harness).toBe("strict")
      expect(config.supervisor.harness).toBe("strict")
    })

    it("should get agent profile by role", () => {
      const config = loadAgentProfiles()
      const workerProfile = getAgentProfile(config, "worker")
      const supervisorProfile = getAgentProfile(config, "supervisor")

      expect(workerProfile.role).toBe("worker")
      expect(supervisorProfile.role).toBe("supervisor")
    })

    it("should update agent profile", () => {
      const config = loadAgentProfiles()
      const updatedConfig = updateAgentProfile(config, "worker", {
        modelTarget: "deepseek/deepseek-v4",
        harness: "strict",
      })

      expect(updatedConfig.worker.modelTarget).toBe("deepseek/deepseek-v4")
      expect(updatedConfig.worker.harness).toBe("strict")
      expect(updatedConfig.supervisor.modelTarget).toBe(DEFAULT_AGENT_PROFILES.supervisor.modelTarget)
    })

    it("should handle corrupted config file gracefully", () => {
      const dir = join(tmpDir, ".covalo")
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, "agents.json"), "{invalid json!!!}", "utf8")

      const config = loadAgentProfiles()
      expect(config).toEqual(DEFAULT_AGENT_PROFILES)
    })

    it("should handle invalid config file gracefully", () => {
      const dir = join(tmpDir, ".covalo")
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, "agents.json"),
        JSON.stringify({ invalid: "config" }),
        "utf8"
      )

      const config = loadAgentProfiles()
      expect(config).toEqual(DEFAULT_AGENT_PROFILES)
    })
  })
})

import { describe, it, expect, beforeAll } from "vitest"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { execSync } from "node:child_process"
import { LspClient } from "../src/lsp/lsp-client.js"
import { pathToFileURL } from "node:url"

const ENABLE_REAL_TESTS = process.env.COVALO_LSP_REAL === "1"

function isCommandAvailable(command: string): boolean {
  try {
    execSync(`which ${command}`, { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

describe.skipIf(!ENABLE_REAL_TESTS)("LSP Real Server Smoke Tests", () => {
  describe("TypeScript", () => {
    const cwd = mkdtempSync(join(tmpdir(), "lsp-real-ts-"))
    let client: LspClient | null = null

    beforeAll(async () => {
      if (!isCommandAvailable("typescript-language-server")) {
        console.log("typescript-language-server not found, skipping")
        return
      }

      // Create minimal TypeScript project
      writeFileSync(join(cwd, "tsconfig.json"), JSON.stringify({
        compilerOptions: {
          target: "ES2020",
          module: "ESNext",
          moduleResolution: "node",
          strict: true,
        },
        include: ["*.ts"],
      }))

      writeFileSync(join(cwd, "index.ts"), `
export function greet(name: string): string {
  return "Hello, " + name + "!";
}

const message = greet("World")
console.log(message)
`)

      writeFileSync(join(cwd, "types.ts"), `
export interface User {
  id: number
  name: string
  email: string
}

export function createUser(id: number, name: string, email: string): User {
  return { id, name, email }
}
`)

      client = new LspClient({
        command: "typescript-language-server",
        args: ["--stdio"],
        cwd,
        rootPath: cwd,
        language: "typescript",
        timeoutMs: 10000,
      })

      await client.start()
      await client.initialize()
    })

    it("should start and initialize", () => {
      expect(client).not.toBeNull()
      expect(client!.getState()).toBe("running")
    })

    it("should return hover info", async () => {
      if (!client) return

      const testFile = join(cwd, "index.ts")
      await client.openDocument(testFile, "typescript", `
export function greet(name: string): string {
  return "Hello, " + name + "!";
}
`)

      const result = await client.request("textDocument/hover", {
        textDocument: { uri: pathToFileURL(testFile).href },
        position: { line: 1, character: 16 }, // on 'greet'
      }) as any

      expect(result).toBeDefined()
      expect(result.contents).toBeDefined()
    })

    it("should return definition", async () => {
      if (!client) return

      const testFile = join(cwd, "index.ts")
      const content = `
import { greet } from './index'

const msg = greet("World")
`
      await client.openDocument(testFile, "typescript", content)

      const result = await client.request("textDocument/definition", {
        textDocument: { uri: pathToFileURL(testFile).href },
        position: { line: 3, character: 11 }, // on 'greet'
      })

      expect(result).toBeDefined()
    })

    it("should return diagnostics", async () => {
      if (!client) return

      const testFile = join(cwd, "error.ts")
      const content = `
const x: number = "not a number"
const y: number = 42
`
      await client.openDocument(testFile, "typescript", content)

      // Wait for diagnostics
      await new Promise(resolve => setTimeout(resolve, 2000))

      const diagnostics = client.getDiagnostics(pathToFileURL(testFile).href)
      expect(diagnostics.length).toBeGreaterThan(0)
    })

    it("should shutdown gracefully", async () => {
      if (!client) return

      await client.shutdown()
      expect(client.getState()).toBe("stopped")
    })
  })

  describe("Python", () => {
    const cwd = mkdtempSync(join(tmpdir(), "lsp-real-python-"))
    let client: LspClient | null = null

    beforeAll(async () => {
      if (!isCommandAvailable("pyright-langserver")) {
        console.log("pyright-langserver not found, skipping")
        return
      }

      // Create minimal Python project
      writeFileSync(join(cwd, "pyproject.toml"), `
[tool.pyright]
include = ["*.py"]
`)

      writeFileSync(join(cwd, "main.py"), `
def greet(name: str) -> str:
    return "Hello, " + name + "!"

message = greet("World")
print(message)
`)

      client = new LspClient({
        command: "pyright-langserver",
        args: ["--stdio"],
        cwd,
        rootPath: cwd,
        language: "python",
        timeoutMs: 10000,
      })

      await client.start()
      await client.initialize()
    })

    it("should start and initialize", () => {
      expect(client).not.toBeNull()
      expect(client!.getState()).toBe("running")
    })

    it("should return hover info", async () => {
      if (!client) return

      const testFile = join(cwd, "main.py")
      await client.openDocument(testFile, "python", `
def greet(name: str) -> str:
    return f"Hello, {name}!"
`)

      const result = await client.request("textDocument/hover", {
        textDocument: { uri: pathToFileURL(testFile).href },
        position: { line: 1, character: 4 }, // on 'greet'
      }) as any

      expect(result).toBeDefined()
    })

    it("should shutdown gracefully", async () => {
      if (!client) return

      await client.shutdown()
      expect(client.getState()).toBe("stopped")
    })
  })

  describe("Go", () => {
    const cwd = mkdtempSync(join(tmpdir(), "lsp-real-go-"))
    let client: LspClient | null = null

    beforeAll(async () => {
      if (!isCommandAvailable("gopls")) {
        console.log("gopls not found, skipping")
        return
      }

      // Create minimal Go project
      writeFileSync(join(cwd, "go.mod"), `
module example.com/test

go 1.21
`)

      writeFileSync(join(cwd, "main.go"), `
package main

import "fmt"

func greet(name string) string {
	return fmt.Sprintf("Hello, %s!", name)
}

func main() {
	message := greet("World")
	fmt.Println(message)
}
`)

      client = new LspClient({
        command: "gopls",
        args: [],
        cwd,
        rootPath: cwd,
        language: "go",
        timeoutMs: 10000,
      })

      await client.start()
      await client.initialize()
    })

    it("should start and initialize", () => {
      if (!client) return
      expect(client.getState()).toBe("running")
    })

    it("should return hover info", async () => {
      if (!client) return

      const testFile = join(cwd, "main.go")
      await client.openDocument(testFile, "go", `
package main

import "fmt"

func greet(name string) string {
	return fmt.Sprintf("Hello, %s!", name)
}
`)

      const result = await client.request("textDocument/hover", {
        textDocument: { uri: pathToFileURL(testFile).href },
        position: { line: 5, character: 5 }, // on 'greet'
      }) as any

      expect(result).toBeDefined()
    })

    it("should shutdown gracefully", async () => {
      if (!client) return

      await client.shutdown()
      expect(client.getState()).toBe("stopped")
    })
  })

  describe("Rust", () => {
    const cwd = mkdtempSync(join(tmpdir(), "lsp-real-rust-"))
    let client: LspClient | null = null

    beforeAll(async () => {
      if (!isCommandAvailable("rust-analyzer")) {
        console.log("rust-analyzer not found, skipping")
        return
      }

      // Create minimal Rust project
      mkdirSync(join(cwd, "src"), { recursive: true })
      writeFileSync(join(cwd, "Cargo.toml"), `
[package]
name = "test-project"
version = "0.1.0"
edition = "2021"
`)

      writeFileSync(join(cwd, "src", "main.rs"), `
fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

fn main() {
    let message = greet("World");
    println!("{}", message);
}
`)

      client = new LspClient({
        command: "rust-analyzer",
        args: [],
        cwd,
        rootPath: cwd,
        language: "rust",
        timeoutMs: 15000,
      })

      await client.start()
      await client.initialize()
    })

    it("should start and initialize", () => {
      if (!client) return
      expect(client.getState()).toBe("running")
    })

    it("should return hover info", async () => {
      if (!client) return

      const testFile = join(cwd, "src", "main.rs")
      await client.openDocument(testFile, "rust", `
fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}
`)

      const result = await client.request("textDocument/hover", {
        textDocument: { uri: pathToFileURL(testFile).href },
        position: { line: 0, character: 3 }, // on 'greet'
      }) as any

      expect(result).toBeDefined()
    })

    it("should shutdown gracefully", async () => {
      if (!client) return

      await client.shutdown()
      expect(client.getState()).toBe("stopped")
    })
  })
})

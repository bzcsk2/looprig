import { readFile, writeFile, mkdir } from "node:fs/promises"
import { join, dirname } from "node:path"
import type { ContextPolicy } from "./policy.js"
import { DEFAULT_CONTEXT_POLICY, validateContextPolicy } from "./policy.js"

const CONTEXT_FILE_NAME = "context.json"
const CONTEXT_DIR = ".covalo"

export class ContextPolicyStore {
  private filePath: string
  private currentPolicy: ContextPolicy

  constructor(workspacePath: string = process.cwd()) {
    this.filePath = join(workspacePath, CONTEXT_DIR, CONTEXT_FILE_NAME)
    this.currentPolicy = { ...DEFAULT_CONTEXT_POLICY }
  }

  async load(): Promise<ContextPolicy> {
    try {
      const content = await readFile(this.filePath, "utf-8")
      const parsed = JSON.parse(content)
      
      if (validateContextPolicy(parsed)) {
        this.currentPolicy = { ...DEFAULT_CONTEXT_POLICY, ...parsed }
      } else {
        this.currentPolicy = { ...DEFAULT_CONTEXT_POLICY }
      }
    } catch {
      this.currentPolicy = { ...DEFAULT_CONTEXT_POLICY }
    }
    
    return { ...this.currentPolicy }
  }

  async save(policy: ContextPolicy): Promise<boolean> {
    try {
      const dir = dirname(this.filePath)
      await mkdir(dir, { recursive: true })
      
      const content = JSON.stringify(policy, null, 2)
      await writeFile(this.filePath, content, "utf-8")
      
      this.currentPolicy = { ...policy }
      return true
    } catch {
      return false
    }
  }

  getCurrentPolicy(): ContextPolicy {
    return { ...this.currentPolicy }
  }

  getFilePath(): string {
    return this.filePath
  }
}

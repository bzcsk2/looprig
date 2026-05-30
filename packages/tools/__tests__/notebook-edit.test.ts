import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createNotebookEditTool } from "../src/notebook-edit.js"
import { writeFileSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const ctx = (cwd: string) => ({ cwd, signal: new AbortController().signal }) as any

function makeNotebook() {
  return {
    cells: [
      { cell_type: "code", source: ["print('hello')"], metadata: {}, outputs: [], execution_count: null },
      { cell_type: "markdown", source: ["# Title"], metadata: {} },
    ],
    metadata: { kernelspec: { display_name: "Python 3", language: "python", name: "python3" } },
    nbformat: 4,
    nbformat_minor: 5,
  }
}

describe("NotebookEdit", () => {
  let tmpDir: string
  let nbPath: string

  beforeEach(() => {
    tmpDir = join(tmpdir(), `deepicode-nb-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tmpDir, { recursive: true })
    nbPath = join(tmpDir, "test.ipynb")
  })

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  })

  it("should create a code cell at the end", async () => {
    writeFileSync(nbPath, JSON.stringify(makeNotebook()))
    const tool = createNotebookEditTool()
    const r = await tool.execute({ path: nbPath, action: "create_cell", cell_type: "code", source: "print('new')" }, ctx(tmpDir))
    expect(r.isError).toBe(false)
    const raw = JSON.parse(require("fs").readFileSync(nbPath, "utf-8"))
    expect(raw.cells).toHaveLength(3)
    expect(raw.cells[2].cell_type).toBe("code")
    expect(raw.cells[2].source[0]).toBe("print('new')")
  })

  it("should create a cell at specific index", async () => {
    writeFileSync(nbPath, JSON.stringify(makeNotebook()))
    const tool = createNotebookEditTool()
    await tool.execute({ path: nbPath, action: "create_cell", cell_type: "markdown", source: "inserted", index: 1 }, ctx(tmpDir))
    const raw = JSON.parse(require("fs").readFileSync(nbPath, "utf-8"))
    expect(raw.cells).toHaveLength(3)
    expect(raw.cells[1].source[0]).toBe("inserted")
  })

  it("should update a cell", async () => {
    writeFileSync(nbPath, JSON.stringify(makeNotebook()))
    const tool = createNotebookEditTool()
    const r = await tool.execute({ path: nbPath, action: "update_cell", source: "print('updated')", index: 0 }, ctx(tmpDir))
    expect(r.isError).toBe(false)
    const raw = JSON.parse(require("fs").readFileSync(nbPath, "utf-8"))
    expect(raw.cells[0].source[0]).toBe("print('updated')")
  })

  it("should delete a cell", async () => {
    writeFileSync(nbPath, JSON.stringify(makeNotebook()))
    const tool = createNotebookEditTool()
    const r = await tool.execute({ path: nbPath, action: "delete_cell", index: 0 }, ctx(tmpDir))
    expect(r.isError).toBe(false)
    const raw = JSON.parse(require("fs").readFileSync(nbPath, "utf-8"))
    expect(raw.cells).toHaveLength(1)
    expect(raw.cells[0].cell_type).toBe("markdown")
  })

  it("should return error for non-existent file", async () => {
    const tool = createNotebookEditTool()
    const r = await tool.execute({ path: "/nonexistent/nb.ipynb", action: "list_cells" as any }, ctx(tmpDir))
    expect(r.isError).toBe(true)
  })

  it("should return error for invalid JSON", async () => {
    writeFileSync(nbPath, "not valid json", "utf-8")
    const tool = createNotebookEditTool()
    const r = await tool.execute({ path: nbPath, action: "create_cell", cell_type: "code" }, ctx(tmpDir))
    expect(r.isError).toBe(true)
  })

  it("should error when cell_type missing for create", async () => {
    writeFileSync(nbPath, JSON.stringify(makeNotebook()))
    const tool = createNotebookEditTool()
    const r = await tool.execute({ path: nbPath, action: "create_cell" }, ctx(tmpDir))
    expect(r.isError).toBe(true)
  })

  it("should error on out-of-bounds index", async () => {
    writeFileSync(nbPath, JSON.stringify(makeNotebook()))
    const tool = createNotebookEditTool()
    const r = await tool.execute({ path: nbPath, action: "delete_cell", index: 999 }, ctx(tmpDir))
    expect(r.isError).toBe(true)
  })
})

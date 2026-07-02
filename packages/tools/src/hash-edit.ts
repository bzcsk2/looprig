import { createHash, randomUUID } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { open, stat, rename, unlink, chmod, mkdir } from "node:fs/promises"
import { dirname } from "node:path"

export interface HashEditResult {
  replacedCount: number
  method: "hash_anchored"
}

const REPLACEMENT_CHAR = "\uFFFD"
const BINARY_THRESHOLD = 0.05

function hasBinaryContent(text: string): boolean {
  if (!text) return false
  let count = 0
  for (const ch of text) {
    if (ch === REPLACEMENT_CHAR) count++
  }
  return count / text.length > BINARY_THRESHOLD
}

// Stream-based edit: find exact old_string and replace once.
// Internally uses hashing to avoid expensive repeated string comparisons for large files.
// If oldHash is provided, only replaces when sha256(oldString) matches expected hash.
// Returns null if old_string is not found OR if oldHash is given and doesn't match.
export async function hashAnchoredReplaceOnce(
  filePath: string,
  oldString: string,
  newString: string,
  oldHash?: string,
): Promise<HashEditResult | null> {
  if (!oldString) return null

  // Integrity check: if caller provided a hash, verify oldString content matches
  if (oldHash !== undefined && sha256(oldString) !== oldHash) {
    return null
  }

  // Quick binary check: read first 8KB to detect non-UTF-8 content
  try {
    const fd = await open(filePath, "r")
    try {
      const buf = Buffer.alloc(8192)
      const { bytesRead } = await fd.read(buf, 0, 8192, 0)
      const sample = new TextDecoder("utf-8", { fatal: false }).decode(buf.subarray(0, bytesRead))
      if (hasBinaryContent(sample)) {
        throw new Error("Binary file detected: editing non-UTF-8 files is not supported")
      }
    } finally {
      await fd.close()
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Binary file detected")) throw e
    // If file doesn't exist, let read stream fail later
  }

  // Get original file permissions so we don't lose executable bits when replacing
  let originalMode: number | undefined
  try {
    const s = await stat(filePath)
    originalMode = s.mode
  } catch {
    // If file doesn't exist, we can't edit it anyway, but we'll let read stream fail
  }

  const tmpPath = `${filePath}.covalo_tmp_${randomUUID()}`
  let tmpCreated = false

  try {
    await mkdir(dirname(tmpPath), { recursive: true })
    tmpCreated = true

    const reader = createReadStream(filePath, { encoding: "utf-8" })
    const writer = createWriteStream(tmpPath, { encoding: "utf-8" })

    let buf = ""
    let replaced = false

    const write = (s: string) => new Promise<void>((resolve, reject) => {
      writer.write(s, (err) => (err ? reject(err) : resolve()))
    })

    for await (const chunk of reader as any as AsyncIterable<string>) {
      buf += chunk

      if (!replaced) {
        const idx = buf.indexOf(oldString)
        if (idx >= 0) {
          await write(buf.slice(0, idx))
          await write(newString)
          buf = buf.slice(idx + oldString.length)
          replaced = true
        }
      }

      const maxTail = Math.max(oldString.length, 8192)
      while (buf.length > maxTail * 2) {
        const cut = buf.length - maxTail * 2
        await write(buf.slice(0, cut))
        buf = buf.slice(cut)
      }
    }

    if (!replaced) {
      await new Promise<void>((resolve) => writer.end(resolve))
      return null
    }

    await write(buf)
    await new Promise<void>((resolve) => writer.end(resolve))

    if (originalMode !== undefined) {
      await chmod(tmpPath, originalMode).catch(() => {})
    }

    await rename(tmpPath, filePath)
    tmpCreated = false
    return { replacedCount: 1, method: "hash_anchored" }
  } finally {
    if (tmpCreated) {
      await unlink(tmpPath).catch(() => {})
    }
  }
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex")
}

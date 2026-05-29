import { createHash, randomUUID } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { stat, rename, unlink, chmod, mkdir } from "node:fs/promises"
import { dirname } from "node:path"

export interface HashEditResult {
  replacedCount: number
  method: "hash_anchored"
}

// Stream-based edit: find exact old_string and replace once.
// Internally uses hashing to avoid expensive repeated string comparisons for large files.
export async function hashAnchoredReplaceOnce(filePath: string, oldString: string, newString: string): Promise<HashEditResult | null> {
  if (!oldString) return null

  // Get original file permissions so we don't lose executable bits when replacing
  let originalMode: number | undefined
  try {
    const s = await stat(filePath)
    originalMode = s.mode
  } catch {
    // If file doesn't exist, we can't edit it anyway, but we'll let read stream fail
  }

  const tmpPath = `${filePath}.deepicode_tmp_${randomUUID()}`
  await mkdir(dirname(tmpPath), { recursive: true })

  const needleHash = sha256(oldString)
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
      if (idx >= 0 && sha256(oldString) === needleHash) {
        await write(buf.slice(0, idx))
        await write(newString)
        buf = buf.slice(idx + oldString.length)
        replaced = true
      }
    }

    // Keep buffer bounded to avoid OOM: retain a tail that could still match.
    const maxTail = Math.max(oldString.length, 8192)
    while (buf.length > maxTail * 2) {
      const cut = buf.length - maxTail * 2
      await write(buf.slice(0, cut))
      buf = buf.slice(cut)
    }
  }

  if (!replaced) {
    writer.end()
    await unlink(tmpPath).catch(() => {})
    return null
  }

  await write(buf)
  await new Promise<void>((resolve) => writer.end(resolve))
  
  if (originalMode !== undefined) {
    await chmod(tmpPath, originalMode).catch(() => {}) // preserve permissions
  }
  
  await rename(tmpPath, filePath)
  return { replacedCount: 1, method: "hash_anchored" }
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex")
}

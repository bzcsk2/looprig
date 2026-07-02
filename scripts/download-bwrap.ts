/**
 * download-bwrap.ts
 *
 * Downloads a statically-linked bwrap binary and places it in the bundle directory.
 *
 * Strategy:
 *   1. Try Alpine Linux static build (fully static, most portable)
 *   2. Fall back to system bwrap copy (dynamic, but available)
 *   3. If all fail, print instructions (non-fatal — runtime falls back to soft-workspace)
 *
 * Usage: bun run scripts/download-bwrap.ts
 *   BWRAP_VERSION — bubblewrap version to fetch from Alpine (default: 0.11.2)
 */

import { existsSync, mkdirSync, chmodSync, writeFileSync, readFileSync, createWriteStream } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execSync } from "node:child_process";
import { get } from "node:https";

const BWRAP_VERSION = process.env.BWRAP_VERSION ?? "0.11.2";
const ALPINE_MIRROR = "https://dl-cdn.alpinelinux.org/alpine/edge/main";

type Arch = "x86_64" | "aarch64";

function detectArch(): Arch | null {
  const arch = process.arch;
  if (arch === "x64") return "x86_64";
  if (arch === "arm64") return "aarch64";
  return null;
}

function getScriptDir(): string {
  return import.meta.dirname ?? process.cwd();
}

function getTargetDir(arch: Arch): string {
  const dirName = arch === "x86_64" ? "linux-x64" : "linux-arm64";
  return resolve(getScriptDir(), "..", "resources", "bwrap", dirName);
}

function getDownloadUrl(arch: Arch): string {
  return `${ALPINE_MIRROR}/${arch}/bubblewrap-static-${BWRAP_VERSION}-r0.apk`;
}

async function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const file = createWriteStream(dest);
    const req = get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location;
        if (redirectUrl) {
          file.close();
          downloadFile(redirectUrl, dest).then(resolvePromise).catch(reject);
          return;
        }
      }
      if (response.statusCode !== 200) {
        file.close();
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }
      response.pipe(file);
      file.on("finish", () => {
        file.close();
        resolvePromise();
      });
    });
    req.on("error", (err) => {
      file.close();
      reject(err);
    });
    req.setTimeout(15000, () => {
      file.close();
      req.destroy();
      reject(new Error("Download timed out"));
    });
  });
}

function extractBwrapFromApk(apkPath: string, outputPath: string): void {
  const rootDir = resolve(getScriptDir(), "..");
  const tmpDir = join(rootDir, "tmp-bwrap-extract");
  mkdirSync(tmpDir, { recursive: true });

  try {
    execSync(
      `tar -xzf "${apkPath}" -C "${tmpDir}" 2>/dev/null || ` +
      `tar -xf "${apkPath}" -C "${tmpDir}" 2>/dev/null || true`,
      { stdio: "pipe", shell: true },
    );

    const candidates = [
      join(tmpDir, "usr", "bin", "bwrap.static"),
      join(tmpDir, "sbin", "bwrap.static"),
      join(tmpDir, "usr", "bin", "bwrap"),
      join(tmpDir, "bin", "bwrap"),
    ];

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        const data = readFileSync(candidate);
        writeFileSync(outputPath, data);
        chmodSync(outputPath, 0o755);
        return;
      }
    }

    const listing = execSync(`tar -tzf "${apkPath}" 2>/dev/null | head -30`, { encoding: "utf-8", stdio: "pipe" });
    throw new Error(`bwrap binary not found in APK. Contents:\n${listing}`);
  } finally {
    try {
      execSync(`rm -rf "${tmpDir}"`, { stdio: "pipe", shell: true });
    } catch {}
  }
}

async function downloadFromAlpine(arch: Arch, outputPath: string): Promise<boolean> {
  const url = getDownloadUrl(arch);
  const archDir = dirname(outputPath);
  const apkPath = join(archDir, "bubblewrap.apk");

  console.log(`Downloading Alpine static bwrap ${BWRAP_VERSION} for ${arch}...`);
  console.log(`  ${url}`);

  try {
    mkdirSync(archDir, { recursive: true });
    await downloadFile(url, apkPath);
    extractBwrapFromApk(apkPath, outputPath);
    const st = existsSync(outputPath) ? " (static)" : "";
    console.log(`bwrap installed at ${outputPath}${st}`);
    return true;
  } catch (err) {
    console.warn("Alpine download failed:", err instanceof Error ? err.message : String(err));
    return false;
  } finally {
    try {
      if (existsSync(apkPath)) execSync(`rm -f "${apkPath}"`, { stdio: "pipe", shell: true });
    } catch {}
  }
}

function copySystemBwrap(outputPath: string): boolean {
  try {
    const which = execSync("which bwrap 2>/dev/null", { encoding: "utf-8", stdio: "pipe" }).toString().trim();
    if (which && existsSync(which)) {
      console.log(`System bwrap found at ${which}, copying into bundle...`);
      mkdirSync(dirname(outputPath), { recursive: true });
      execSync(`cp "${which}" "${outputPath}"`, { stdio: "pipe", shell: true });
      chmodSync(outputPath, 0o755);
      console.log(`bwrap bundled at ${outputPath}`);
      return true;
    }
  } catch {}
  return false;
}

async function main(): Promise<void> {
  if (process.platform !== "linux") {
    console.log("Skipping bwrap download: not on Linux");
    return;
  }

  const arch = detectArch();
  if (!arch) {
    console.log(`Skipping bwrap download: unsupported arch ${process.arch}`);
    return;
  }

  const targetDir = getTargetDir(arch);
  const outputPath = join(targetDir, "bwrap");

  if (existsSync(outputPath)) {
    console.log(`bwrap already exists at ${outputPath}, skipping`);
    return;
  }

  if (await downloadFromAlpine(arch, outputPath)) return;
  if (copySystemBwrap(outputPath)) return;

  console.warn("Could not bundle bwrap. Users can install it via: sudo apt install bubblewrap");
  console.warn("Covalo will fall back to soft-workspace (diagnostic mode)");
}

await main();

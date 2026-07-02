import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname, join, isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { UnsafeEvalAssetPathError } from "../types";

const ASSETS_DIRNAME = "eval-assets";

function findPackageRoot(startDir: string): string | null {
  let current = resolve(startDir);
  for (let i = 0; i < 20; i++) {
    if (existsSync(join(current, "package.json"))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

function getScriptDir(): string {
  if (typeof __dirname !== "undefined") return __dirname;
  if (import.meta?.url) return dirname(fileURLToPath(import.meta.url));
  return process.cwd();
}

export function getEvalAssetsRoot(): string {
  if (process.env.COVALO_EVAL_ASSETS_DIR) {
    const envDir = resolve(process.env.COVALO_EVAL_ASSETS_DIR);
    if (existsSync(envDir)) return envDir;
  }

  const scriptDir = getScriptDir();
  const pkgRoot = findPackageRoot(scriptDir);
  if (pkgRoot) {
    const assetsDir = join(pkgRoot, "resources", ASSETS_DIRNAME);
    if (existsSync(assetsDir)) return assetsDir;
  }

  const cwdRoot = findPackageRoot(process.cwd());
  if (cwdRoot) {
    const assetsDir = join(cwdRoot, "resources", ASSETS_DIRNAME);
    if (existsSync(assetsDir)) return assetsDir;
  }

  const devFallback = resolve(scriptDir, "..", "..", "curated");
  if (existsSync(devFallback)) return devFallback;

  throw new Error(
    "Cannot locate eval assets root. Set COVALO_EVAL_ASSETS_DIR or run from within the package/repo.",
  );
}

export function assertSafeAssetRelativePath(relativePath: string): void {
  if (!relativePath || typeof relativePath !== "string") {
    throw new UnsafeEvalAssetPathError(`Asset path must be a non-empty string, got ${typeof relativePath}`);
  }
  if (relativePath.startsWith("/")) {
    throw new UnsafeEvalAssetPathError(`Asset path must not be absolute: ${relativePath}`);
  }
  if (relativePath.includes("..")) {
    throw new UnsafeEvalAssetPathError(`Asset path must not contain "..": ${relativePath}`);
  }
  if (/^[A-Za-z]:[/\\]/.test(relativePath)) {
    throw new UnsafeEvalAssetPathError(`Asset path must not contain Windows drive letter: ${relativePath}`);
  }
  if (isAbsolute(relativePath)) {
    throw new UnsafeEvalAssetPathError(`Asset path must not be absolute: ${relativePath}`);
  }
}

export function getEvalAssetPath(relativePath: string): string {
  assertSafeAssetRelativePath(relativePath);
  const root = getEvalAssetsRoot();
  const fullPath = join(root, relativePath);
  const rel = relative(root, fullPath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new UnsafeEvalAssetPathError(
      `Resolved asset path escapes assets root: ${relativePath} -> ${fullPath}`,
    );
  }
  if (!existsSync(fullPath)) {
    throw new Error(`Asset not found: ${relativePath} (resolved to ${fullPath})`);
  }
  return fullPath;
}

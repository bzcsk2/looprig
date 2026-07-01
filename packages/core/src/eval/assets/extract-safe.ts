import { existsSync } from "node:fs";
import { join, isAbsolute, normalize, sep } from "node:path";
import { execSync } from "node:child_process";
import { UnsafeEvalAssetPathError, EvalAssetExtractionError } from "../types";

export async function extractSafeTarGz(
  assetPath: string,
  workspaceDir: string,
): Promise<void> {
  if (!existsSync(assetPath)) {
    throw new Error(`Asset file not found: ${assetPath}`);
  }
  if (!existsSync(workspaceDir)) {
    throw new Error(`Workspace directory not found: ${workspaceDir}`);
  }

  const entries = listTarEntries(assetPath);
  for (const entry of entries) {
    validateTarEntry(entry, assetPath);
  }

  try {
    execSync(`tar -xzf "${assetPath}" -C "${workspaceDir}"`, {
      stdio: "pipe",
      timeout: 60000,
    });
  } catch (e) {
    throw new EvalAssetExtractionError(
      `Failed to extract ${assetPath} to ${workspaceDir}: ${e}`,
    );
  }
}

function listTarEntries(tarPath: string): string[] {
  try {
    const output = execSync(`tar -tzf "${tarPath}" 2>/dev/null`, {
      stdio: "pipe",
      timeout: 30000,
      encoding: "utf-8",
    });
    return output.split("\n").filter(Boolean);
  } catch (e) {
    throw new EvalAssetExtractionError(
      `Failed to list entries in tar archive ${tarPath}: ${e}`,
    );
  }
}

function validateTarEntry(entry: string, archivePath: string): void {
  const normalized = normalize(entry);

  if (isAbsolute(normalized)) {
    throw new UnsafeEvalAssetPathError(
      `Tar entry is absolute path in ${archivePath}: ${entry}`,
    );
  }

  if (normalized.includes("..")) {
    throw new UnsafeEvalAssetPathError(
      `Tar entry contains ".." in ${archivePath}: ${entry}`,
    );
  }

  if (/^[A-Za-z]:[/\\]/.test(normalized)) {
    throw new UnsafeEvalAssetPathError(
      `Tar entry contains Windows drive letter in ${archivePath}: ${entry}`,
    );
  }
}

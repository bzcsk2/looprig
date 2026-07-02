import { appendFile, readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { HarnessSurface } from "./patch-schema";
import type { HarnessValidationResult } from "./promotion-gate";

export const LINEAGE_SCHEMA_VERSION = "covalo.harness-lineage.v1";

export type LineageDecision = "accepted" | "rejected" | "blocked" | "manual_required";
export type PromotedBy = "self-harness" | "human";

export interface HarnessLineageEntry {
  schemaVersion: typeof LINEAGE_SCHEMA_VERSION;
  patchId: string;
  surface: HarnessSurface;
  decision: LineageDecision;
  weaknessIds: string[];
  beforeHash: string;
  afterHash?: string;
  validation: HarnessValidationResult;
  promotedBy: PromotedBy;
  acceptedAt?: string;
  rollbackId?: string;
}

export class LineageStore {
  private lineagePath: string;
  private patchesDir: string;

  constructor(baseDir: string) {
    const harnessDir = join(baseDir, ".covalo", "harness");
    this.lineagePath = join(harnessDir, "lineage.jsonl");
    this.patchesDir = join(harnessDir, "patches");
  }

  async init(): Promise<void> {
    await mkdir(this.patchesDir, { recursive: true });
  }

  async append(entry: HarnessLineageEntry): Promise<void> {
    const line = JSON.stringify(entry) + "\n";
    await appendFile(this.lineagePath, line, "utf-8");
    // Write patch JSON as artifact
    await writeFile(
      join(this.patchesDir, `${entry.patchId}.json`),
      JSON.stringify(entry, null, 2),
      "utf-8",
    );
  }

  async getAll(): Promise<HarnessLineageEntry[]> {
    if (!existsSync(this.lineagePath)) return [];
    const content = await readFile(this.lineagePath, "utf-8");
    return content.trim().split("\n").filter(Boolean).map(l => JSON.parse(l) as HarnessLineageEntry);
  }

  async getBySurface(surface: HarnessSurface): Promise<HarnessLineageEntry[]> {
    const all = await this.getAll();
    return all.filter(e => e.surface === surface);
  }

  async getAccepted(): Promise<HarnessLineageEntry[]> {
    const all = await this.getAll();
    return all.filter(e => e.decision === "accepted");
  }

  async getLatestForSurface(surface: HarnessSurface): Promise<HarnessLineageEntry | null> {
    const entries = await this.getBySurface(surface);
    if (entries.length === 0) return null;
    entries.sort((a, b) => new Date(b.acceptedAt ?? 0).getTime() - new Date(a.acceptedAt ?? 0).getTime());
    return entries[0];
  }
}

import { mkdir, appendFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HarnessPacket } from "./types";

export interface PacketStoreConfig {
  baseDir: string;
  runId: string;
  evalRunId?: string;
  caseId?: string;
}

export class PacketStore {
  private packetsDir: string;

  constructor(private config: PacketStoreConfig) {
    this.packetsDir = join(config.baseDir, ".covalo", "runs", config.runId);
  }

  private get jsonlPath(): string {
    return join(this.packetsDir, "packets.jsonl");
  }

  private get runJsonPath(): string {
    return join(this.packetsDir, "run.json");
  }

  private get eventsJsonlPath(): string {
    return join(this.packetsDir, "events.jsonl");
  }

  private get artifactsDir(): string {
    return join(this.packetsDir, "artifacts");
  }

  async init(): Promise<void> {
    await mkdir(this.packetsDir, { recursive: true });
    await mkdir(this.artifactsDir, { recursive: true });
    await writeFile(this.runJsonPath, JSON.stringify({
      runId: this.config.runId,
      evalRunId: this.config.evalRunId,
      caseId: this.config.caseId,
      createdAt: new Date().toISOString(),
    }, null, 2), "utf-8");
  }

  // Append packet to JSONL store. Returns the packetId.
  // Auto-emits a harness.packet.created event.
  async append(packet: HarnessPacket): Promise<string> {
    const line = JSON.stringify(packet) + "\n";
    await appendFile(this.jsonlPath, line, "utf-8");

    // Auto-emit harness.packet.created observability event
    await this.writeEvent("harness.packet.created", {
      packetId: packet.packetId,
      packetType: (packet as any).schemaVersion ?? "unknown",
      mode: (packet as any).mode,
      role: (packet as any).role,
      surface: (packet as any).surface,
      failureClass: (packet as any).failureClass,
    });

    return packet.packetId;
  }

  // Write packet as a standalone JSON artifact
  async writeArtifact(name: string, packet: HarnessPacket): Promise<void> {
    await writeFile(
      join(this.artifactsDir, name),
      JSON.stringify(packet, null, 2),
      "utf-8",
    );
  }

  // Write a JSONL event line (for observability correlation)
  async writeEvent(event: string, data: Record<string, unknown> = {}): Promise<void> {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      event,
      runId: this.config.runId,
      evalRunId: this.config.evalRunId,
      caseId: this.config.caseId,
      ...data,
    }) + "\n";
    await appendFile(this.eventsJsonlPath, line, "utf-8");
  }

  // Get the eval case packets path for mirroring
  getEvalCasePacketsPath(evalRunId: string, caseId: string): string {
    const base = this.config.baseDir;
    return join(base, ".covalo", "evals", evalRunId, "cases", caseId, "packets.jsonl");
  }

  // Mirror a packet into eval case artifacts
  async mirrorToEvalCase(evalRunId: string, caseId: string, packet: HarnessPacket): Promise<void> {
    const dir = join(this.config.baseDir, ".covalo", "evals", evalRunId, "cases", caseId);
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, "packets.jsonl"), JSON.stringify(packet) + "\n", "utf-8");
  }
}

import { appendFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import type { ModelOutcomeRecord, ModelOutcomeAggregate } from "./model-outcome";
import { aggregateByModel } from "./model-outcome";

export class OutcomeStore {
  private jsonlPath: string;

  constructor(baseDir: string) {
    this.jsonlPath = join(baseDir, ".covalo", "outcomes", "model-outcomes.jsonl");
  }

  async init(): Promise<void> {
    await mkdir(join(this.jsonlPath, ".."), { recursive: true });
  }

  async append(record: ModelOutcomeRecord): Promise<void> {
    const line = JSON.stringify(record) + "\n";
    await appendFile(this.jsonlPath, line, "utf-8");
  }

  async getAll(): Promise<ModelOutcomeRecord[]> {
    if (!existsSync(this.jsonlPath)) return [];
    const content = await readFile(this.jsonlPath, "utf-8");
    return content.trim().split("\n").filter(Boolean).map(l => JSON.parse(l) as ModelOutcomeRecord);
  }

  async getReport(): Promise<ModelOutcomeAggregate[]> {
    const records = await this.getAll();
    return aggregateByModel(records);
  }

  async getByModel(modelTarget: string): Promise<ModelOutcomeRecord[]> {
    const all = await this.getAll();
    return all.filter(r => r.modelTarget === modelTarget);
  }

  async count(): Promise<number> {
    if (!existsSync(this.jsonlPath)) return 0;
    const content = await readFile(this.jsonlPath, "utf-8");
    return content.trim().split("\n").filter(Boolean).length;
  }
}

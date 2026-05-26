import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { workspacePaths } from "../workspace/paths.ts";
import { RunRecordSchema, type RunRecord } from "./runRecord.ts";
import type { StateStore } from "./store.ts";

export class RunLedger {
  private runsDir: string;

  constructor(targetRepo: string, private store: StateStore) {
    this.runsDir = workspacePaths(targetRepo).runsDir;
    if (!existsSync(this.runsDir)) mkdirSync(this.runsDir, { recursive: true });
  }

  /** Validate, persist to disk (append-only), and index in the store. */
  write(record: RunRecord): void {
    const parsed = RunRecordSchema.parse(record);
    writeFileSync(join(this.runsDir, `${parsed.runId}.json`), JSON.stringify(parsed, null, 2) + "\n", "utf8");
    this.store.upsertRun({
      runId: parsed.runId, scenarioId: parsed.scenarioId,
      status: parsed.status, startedAt: parsed.startedAt, finishedAt: parsed.finishedAt,
    });
  }

  read(runId: string): RunRecord {
    const path = join(this.runsDir, `${runId}.json`);
    return RunRecordSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  }
}

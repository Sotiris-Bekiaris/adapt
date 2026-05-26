import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { StateStore } from "../../src/orchestrator/store.ts";
import { RunLedger } from "../../src/orchestrator/runLedger.ts";
import { newRunRecord, type RunRecord } from "../../src/orchestrator/runRecord.ts";
import { AdaptConfigSchema } from "../../src/config/schema.ts";
import { triageFailures } from "../../src/orchestrator/triage.ts";
import { LocalTracker } from "../../src/tracker/localTracker.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function failedRecord(runId: string, over: Partial<RunRecord> = {}): RunRecord {
  return { ...newRunRecord({ runId, scenarioId: "SCN-001", scenarioTitle: "Login", appBaseUrl: "http://x", startedAt: "t" }),
    status: "failed", finishedAt: "t", failureStep: 2, actualOutcome: "error toast", consoleErrors: ["TypeError"], ...over };
}

function ctx(over = {}) {
  dir = makeTmpDir();
  mkdirSync(join(dir, ".adapt", "scenario-runs"), { recursive: true });
  mkdirSync(join(dir, ".adapt", "work-items"), { recursive: true });
  const store = new StateStore(":memory:");
  const ledger = new RunLedger(dir, store);
  const config = AdaptConfigSchema.parse({ targetRepoPath: dir, appBaseUrl: "http://x", limits: { maxItemsPerRun: 10 }, ...over });
  return { dir: dir!, store, ledger, config };
}

function triageEngine(actionable = true) {
  return new StubEngine({ script: (spec) => {
    const m = spec.prompt.match(/RESULT_FILE=(.+)/);
    writeFileSync(m![1]!.trim(), JSON.stringify({ classification: "bug", severity: "high", title: "Login fails", isActionable: actionable, jiraKey: null, notes: "" }), "utf8");
    return [{ kind: "agent.exit", role: spec.role, at: "t", exitCode: 0 }];
  }});
}

describe("triageFailures", () => {
  it("creates a work-item for a new failure", async () => {
    const c = ctx();
    c.ledger.write(failedRecord("RUN-1"));
    const sum = await triageFailures({ engine: triageEngine(), store: c.store, config: c.config, targetRepo: c.dir, sink: () => {} });
    expect(sum.created.length).toBe(1);
    expect(sum.created[0]!.classification).toBe("bug");
    expect(new LocalTracker(c.dir).list().length).toBe(1);
  });

  it("dedupes a second identical failure onto the existing item (no agent, no new item)", async () => {
    const c = ctx();
    c.ledger.write(failedRecord("RUN-1"));
    await triageFailures({ engine: triageEngine(), store: c.store, config: c.config, targetRepo: c.dir, sink: () => {} });
    c.ledger.write(failedRecord("RUN-2")); // same dedupeKey
    const sum = await triageFailures({ engine: triageEngine(), store: c.store, config: c.config, targetRepo: c.dir, sink: () => {} });
    expect(sum.created.length).toBe(0);
    expect(sum.deduped.length).toBe(1);
    const items = new LocalTracker(c.dir).list();
    expect(items.length).toBe(1);
    expect(items[0]!.runIds.sort()).toEqual(["RUN-1", "RUN-2"]);
  });

  it("skips non-actionable failures (no work-item)", async () => {
    const c = ctx();
    c.ledger.write(failedRecord("RUN-1"));
    const sum = await triageFailures({ engine: triageEngine(false), store: c.store, config: c.config, targetRepo: c.dir, sink: () => {} });
    expect(sum.created.length).toBe(0);
    expect(sum.skipped.length).toBe(1);
    expect(new LocalTracker(c.dir).list().length).toBe(0);
  });

  it("caps new items at maxItemsPerRun", async () => {
    const c = ctx({ limits: { maxItemsPerRun: 1 } });
    c.ledger.write(failedRecord("RUN-1", { failureStep: 1, actualOutcome: "a" }));
    c.ledger.write(failedRecord("RUN-2", { failureStep: 2, actualOutcome: "b" })); // distinct key
    const sum = await triageFailures({ engine: triageEngine(), store: c.store, config: c.config, targetRepo: c.dir, sink: () => {} });
    expect(sum.created.length).toBe(1);
    expect(sum.skipped.length).toBe(1);
  });

  it("does not re-triage a run already linked to an item", async () => {
    const c = ctx();
    c.ledger.write(failedRecord("RUN-1"));
    await triageFailures({ engine: triageEngine(), store: c.store, config: c.config, targetRepo: c.dir, sink: () => {} });
    const sum = await triageFailures({ engine: triageEngine(), store: c.store, config: c.config, targetRepo: c.dir, sink: () => {} });
    expect(sum.created.length).toBe(0);
    expect(sum.deduped.length).toBe(0);
  });
});

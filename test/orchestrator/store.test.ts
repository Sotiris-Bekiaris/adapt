import { describe, it, expect, afterEach } from "vitest";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StateStore } from "../../src/orchestrator/store.ts";

function mem() { return new StateStore(":memory:"); }

describe("StateStore", () => {
  it("creates tables on open (idempotent migrate)", () => {
    const s = mem();
    expect(s.listRuns()).toEqual([]);
    s.close();
  });

  it("upserts and reads a run row", () => {
    const s = mem();
    s.upsertRun({ runId: "RUN-1", scenarioId: "SCN-001", status: "queued", startedAt: "t0", finishedAt: null });
    s.upsertRun({ runId: "RUN-1", scenarioId: "SCN-001", status: "running", startedAt: "t0", finishedAt: null });
    const r = s.getRun("RUN-1");
    expect(r?.status).toBe("running");
    expect(s.listRuns().length).toBe(1);
    s.close();
  });

  it("finds runs by status", () => {
    const s = mem();
    s.upsertRun({ runId: "RUN-1", scenarioId: "SCN-001", status: "running", startedAt: "t0", finishedAt: null });
    s.upsertRun({ runId: "RUN-2", scenarioId: "SCN-002", status: "passed", startedAt: "t0", finishedAt: "t1" });
    expect(s.findRunsByStatus("running").map((r) => r.runId)).toEqual(["RUN-1"]);
    s.close();
  });

  it("tracks scenario state with a default of 'ready'", () => {
    const s = mem();
    expect(s.getScenarioState("SCN-001")).toBe("ready");
    s.setScenarioState("SCN-001", "running");
    expect(s.getScenarioState("SCN-001")).toBe("running");
    s.close();
  });

  it("increments attempt counters per scenario and kind", () => {
    const s = mem();
    expect(s.incrementAttempt("SCN-001", "fix")).toBe(1);
    expect(s.incrementAttempt("SCN-001", "fix")).toBe(2);
    expect(s.incrementAttempt("SCN-001", "verification")).toBe(1);
    expect(s.getAttempts("SCN-001", "fix")).toBe(2);
    s.close();
  });

  it("reaps orphaned running runs and resets their scenarios", () => {
    const s = mem();
    s.upsertRun({ runId: "RUN-1", scenarioId: "SCN-001", status: "running", startedAt: "t0", finishedAt: null });
    s.upsertRun({ runId: "RUN-2", scenarioId: "SCN-002", status: "passed", startedAt: "t0", finishedAt: "t1" });
    s.setScenarioState("SCN-001", "running");

    const reaped = s.reapOrphanedRuns();

    expect(reaped).toEqual(["RUN-1"]);
    expect(s.getRun("RUN-1")?.status).toBe("inconclusive");
    expect(s.getRun("RUN-2")?.status).toBe("passed"); // untouched
    expect(s.getScenarioState("SCN-001")).toBe("ready");
    s.close();
  });

  it("tracks consecutive scenario passes", () => {
    const s = mem();
    expect(s.getScenarioPasses("SCN-001")).toBe(0);
    expect(s.incrementScenarioPasses("SCN-001")).toBe(1);
    expect(s.incrementScenarioPasses("SCN-001")).toBe(2);
    s.resetScenarioPasses("SCN-001");
    expect(s.getScenarioPasses("SCN-001")).toBe(0);
    s.close();
  });
});

// The tests above all run on ":memory:", where `journal_mode = WAL` is silently ignored.
// A real orchestrator run is on-disk and long-lived, so cover that path too — it is what
// actually breaks when the native better-sqlite3 binding is upgraded.
describe("StateStore on disk", () => {
  let dir: string | undefined;
  afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

  it("opens in WAL mode and survives being closed and reopened", () => {
    dir = makeTmpDir();
    const dbPath = join(dir, "state.db");

    const first = new StateStore(dbPath);
    first.upsertRun({ runId: "RUN-1", scenarioId: "SCN-001", status: "failed", startedAt: "t0", finishedAt: "t1" });
    first.setScenarioState("SCN-001", "failed");
    first.incrementAttempt("SCN-001", "fix");
    first.incrementScenarioPasses("SCN-001");
    first.close();

    const reopened = new StateStore(dbPath);
    expect(reopened.getRun("RUN-1")?.status).toBe("failed");
    expect(reopened.getScenarioState("SCN-001")).toBe("failed");
    expect(reopened.getAttempts("SCN-001", "fix")).toBe(1);
    expect(reopened.getScenarioPasses("SCN-001")).toBe(1);
    reopened.close();
  });
});

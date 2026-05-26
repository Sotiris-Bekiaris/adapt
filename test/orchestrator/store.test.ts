import { describe, it, expect } from "vitest";
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
});

import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { Orchestrator } from "../../src/orchestrator/orchestrator.ts";
import { StateStore } from "../../src/orchestrator/store.ts";
import { IllegalTransitionError } from "../../src/orchestrator/stateMachine.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function make(events: any[] = []) {
  dir = makeTmpDir();
  const store = new StateStore(":memory:");
  const orch = new Orchestrator({
    targetRepo: dir!, store, appBaseUrl: "http://localhost:3000",
    limits: { maxFixAttempts: 2, maxVerificationAttempts: 3, maxItemsPerRun: 10, maxCycleSeconds: 3600 },
    clock: () => "2026-05-25T10:15:00.000Z",
    now: () => new Date("2026-05-25T10:15:00.000Z"),
    emit: (e) => events.push(e),
  });
  return { orch, store, events, dir: dir! };
}

describe("Orchestrator", () => {
  it("createRun produces a queued run + emits an event", () => {
    const events: any[] = [];
    const { orch } = make(events);
    const run = orch.createRun("SCN-001", "Login");
    expect(run.runId).toBe("RUN-20260525T101500-1");
    expect(run.status).toBe("queued");
    expect(events.some((e) => e.type === "run.created")).toBe(true);
  });

  it("advanceRun validates transitions and persists", () => {
    const { orch, store } = make();
    const run = orch.createRun("SCN-001", "Login");
    orch.advanceRun(run.runId, "running");
    expect(store.getRun(run.runId)?.status).toBe("running");
  });

  it("advanceRun rejects an illegal transition", () => {
    const { orch } = make();
    const run = orch.createRun("SCN-001", "Login");
    expect(() => orch.advanceRun(run.runId, "passed")).toThrow(IllegalTransitionError);
  });

  it("recordResult finalizes the run and writes the ledger file", () => {
    const { orch, dir } = make();
    const run = orch.createRun("SCN-001", "Login");
    orch.advanceRun(run.runId, "running");
    const rec = orch.recordResult(run.runId, { status: "failed", actualOutcome: "blank page", failureStep: 3 });
    expect(rec.status).toBe("failed");
    expect(rec.finishedAt).toBe("2026-05-25T10:15:00.000Z");
    expect(existsSync(`${dir}/.adapt/scenario-runs/${run.runId}.json`)).toBe(true);
  });

  it("enforces fix attempt limits", () => {
    const { orch } = make();
    expect(orch.canAttempt("SCN-001", "fix")).toBe(true);
    orch.recordAttempt("SCN-001", "fix"); // 1
    orch.recordAttempt("SCN-001", "fix"); // 2 (== limit)
    expect(orch.canAttempt("SCN-001", "fix")).toBe(false);
  });

  it("recovers runs stranded in 'running' as inconclusive", () => {
    const { orch, store } = make();
    const run = orch.createRun("SCN-001", "Login");
    orch.advanceRun(run.runId, "running");
    const recovered = orch.recoverIncomplete();
    expect(recovered).toEqual([run.runId]);
    expect(store.getRun(run.runId)?.status).toBe("inconclusive");
  });
});

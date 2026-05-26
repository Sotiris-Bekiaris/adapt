import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { RunLedger } from "../../src/orchestrator/runLedger.ts";
import { StateStore } from "../../src/orchestrator/store.ts";
import { newRunRecord } from "../../src/orchestrator/runRecord.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function setup() {
  dir = makeTmpDir();
  const store = new StateStore(":memory:");
  const ledger = new RunLedger(dir, store);
  return { dir: dir!, store, ledger };
}

describe("RunLedger", () => {
  it("writes a run record file and indexes it in the store", () => {
    const { dir, store, ledger } = setup();
    const rec = newRunRecord({ runId: "RUN-1", scenarioId: "SCN-001", scenarioTitle: "Login", appBaseUrl: "http://x", startedAt: "t0" });
    ledger.write(rec);
    expect(existsSync(join(dir, ".adapt", "scenario-runs", "RUN-1.json"))).toBe(true);
    expect(store.getRun("RUN-1")?.scenarioId).toBe("SCN-001");
  });

  it("reads back a written record", () => {
    const { ledger } = setup();
    const rec = newRunRecord({ runId: "RUN-2", scenarioId: "SCN-002", scenarioTitle: "X", appBaseUrl: "http://x", startedAt: "t0" });
    ledger.write({ ...rec, status: "passed", finishedAt: "t1" });
    const back = ledger.read("RUN-2");
    expect(back.status).toBe("passed");
  });

  it("rejects an invalid record", () => {
    const { ledger } = setup();
    expect(() => ledger.write({ runId: "RUN-3" } as any)).toThrow();
  });
});

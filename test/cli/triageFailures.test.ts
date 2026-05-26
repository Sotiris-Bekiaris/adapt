import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { StateStore } from "../../src/orchestrator/store.ts";
import { RunLedger } from "../../src/orchestrator/runLedger.ts";
import { newRunRecord } from "../../src/orchestrator/runRecord.ts";
import { triageFailuresCmd } from "../../src/cli/commands/triageFailures.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

describe("triageFailuresCmd", () => {
  it("triages failed runs and reports a summary", async () => {
    dir = makeTmpDir();
    mkdirSync(join(dir, ".adapt", "scenario-runs"), { recursive: true });
    mkdirSync(join(dir, ".adapt", "work-items"), { recursive: true });
    writeFileSync(join(dir, ".adapt", "config.json"), JSON.stringify({ targetRepoPath: dir, appBaseUrl: "http://x" }), "utf8");
    const store = new StateStore(join(dir, ".adapt", "state.db"));
    const ledger = new RunLedger(dir, store);
    ledger.write({ ...newRunRecord({ runId: "RUN-1", scenarioId: "SCN-001", scenarioTitle: "Login", appBaseUrl: "http://x", startedAt: "t" }), status: "failed", finishedAt: "t", failureStep: 2, actualOutcome: "err" });
    store.close();

    const engine = new StubEngine({ script: (spec) => {
      const m = spec.prompt.match(/RESULT_FILE=(.+)/);
      writeFileSync(m![1]!.trim(), JSON.stringify({ classification: "bug", severity: "high", title: "t", isActionable: true, jiraKey: null, notes: "" }), "utf8");
      return [{ kind: "agent.exit", role: spec.role, at: "t", exitCode: 0 }];
    }});

    const res = await triageFailuresCmd({ targetRepo: dir, engine, log: () => {} });
    expect(res.code).toBe(0);
    expect(res.summary.created.length).toBe(1);
  });
});

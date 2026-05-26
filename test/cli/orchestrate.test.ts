import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { orchestrateCmd } from "../../src/cli/commands/orchestrate.ts";
import { DecisionLog } from "../../src/observability/decisionLog.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function passEngine() {
  return new StubEngine({ script: (s) => {
    const path = s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim();
    if (s.role === "runner") {
      const sid = s.prompt.match(/SCENARIO (SCN-\d+)/)![1];
      writeFileSync(path, JSON.stringify({ runId: "x", scenarioId: sid, scenarioTitle: sid, status: "passed", startedAt: "t", finishedAt: "t", appBaseUrl: "http://x", appVersion: null, environment: "local", stepsExecuted: 1, failureStep: null, expectedOutcome: "ok", actualOutcome: "ok", consoleErrors: [], networkErrors: [], screenshots: [], artifacts: [], linkedJiraIssue: null, runnerNotes: "" }));
    }
    return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
  }});
}

describe("orchestrateCmd", () => {
  it("runs one cycle and writes events to the decision log", async () => {
    dir = makeTmpDir();
    const scn = join(dir, ".adapt", "scenarios");
    mkdirSync(join(dir, ".adapt", "scenario-runs"), { recursive: true });
    mkdirSync(join(dir, ".adapt", "work-items"), { recursive: true });
    mkdirSync(scn, { recursive: true });
    writeFileSync(join(dir, ".adapt", "config.json"), JSON.stringify({ targetRepoPath: dir, appBaseUrl: "http://x" }), "utf8");
    writeFileSync(join(scn, "SCN-001.md"), `---\nid: SCN-001\ntitle: Login\nstatus: ready\npriority: high\npersona: User\ntags: [a]\nsource: human-seeded\n---\nLog in.`, "utf8");

    const res = await orchestrateCmd({ targetRepo: dir, engine: passEngine(), log: () => {} });
    expect(res.code).toBe(0);
    expect(res.summary.runs[0]!.status).toBe("passed");

    const today = new Date().toISOString().slice(0, 10);
    const events = new DecisionLog(dir!).readDay(today);
    expect(events.some((e) => e.channel === "orchestrator")).toBe(true);
  });
});

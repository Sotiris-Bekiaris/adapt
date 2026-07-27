import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { evolveCmd } from "../../src/cli/commands/evolve.ts";
import { DecisionLog } from "../../src/observability/decisionLog.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function organismEngine() {
  return new StubEngine({ script: (s) => {
    if (s.role === "dreamer") writeFileSync(s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim(), JSON.stringify({ ambition: "higher", demands: [{ title: "F", rationale: "r", proposedScenarios: ["x"] }] }));
    else if (s.role === "critic") writeFileSync(s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim(), JSON.stringify({ decision: "approved", critique: "ok" }));
    else if (s.role === "generator") { const d = s.prompt.match(/directory:\s*(\S+)/)![1]!; const id = s.prompt.match(/SCN-\d+/)![0]; writeFileSync(join(d, `${id}.md`), `---\nid: ${id}\ntitle: ${id}\nstatus: ready\npriority: medium\npersona: User\ntags: [g]\nsource: agent-discovered\n---\n# Scenario\nDo it.\n`); }
    else if (s.role === "runner") { const p = s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim(); const sid = s.prompt.match(/SCENARIO (SCN-\d+)/)![1]; writeFileSync(p, JSON.stringify({ runId: "x", scenarioId: sid, scenarioTitle: sid, status: "passed", startedAt: "t", finishedAt: "t", appBaseUrl: "http://x", appVersion: null, environment: "local", stepsExecuted: 1, failureStep: null, expectedOutcome: "x", actualOutcome: "x", consoleErrors: [], networkErrors: [], screenshots: [], artifacts: [], runnerNotes: "" })); }
    return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
  }});
}

describe("evolveCmd", () => {
  it("runs a full evolutionary pass and logs events", async () => {
    dir = makeTmpDir();
    for (const d of ["scenarios", "demands", "scenario-runs", "work-items"]) mkdirSync(join(dir, ".adapt", d), { recursive: true });
    writeFileSync(join(dir, ".adapt", "config.json"), JSON.stringify({ targetRepoPath: dir, appBaseUrl: "http://x" }), "utf8");
    writeFileSync(join(dir, ".adapt", "north-star.md"), "# North Star\nBe great.\n", "utf8");

    const res = await evolveCmd({ targetRepo: dir, engine: organismEngine(), log: () => {} });
    expect(res.code).toBe(0);
    expect(res.summary.stage.scenariosCreated.length).toBe(1);
    expect(res.summary.cycle.runs[0]!.status).toBe("passed");

    const today = new Date().toISOString().slice(0, 10);
    expect(new DecisionLog(dir!).readDay(today).some((e) => e.channel === "orchestrator")).toBe(true);
  });
});

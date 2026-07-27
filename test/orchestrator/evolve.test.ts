import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { StateStore } from "../../src/orchestrator/store.ts";
import { AdaptConfigSchema } from "../../src/config/schema.ts";
import { runEvolve } from "../../src/orchestrator/evolve.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function setup() {
  dir = makeTmpDir();
  mkdirSync(join(dir, ".adapt", "scenarios"), { recursive: true });
  mkdirSync(join(dir, ".adapt", "demands"), { recursive: true });
  mkdirSync(join(dir, ".adapt", "scenario-runs"), { recursive: true });
  mkdirSync(join(dir, ".adapt", "work-items"), { recursive: true });
  writeFileSync(join(dir, ".adapt", "north-star.md"), "# North Star\nBe great.\n", "utf8");
  const store = new StateStore(":memory:");
  const config = AdaptConfigSchema.parse({ targetRepoPath: dir, appBaseUrl: "http://x", limits: { maxDemandsPerCycle: 1, maxScenariosPerDemand: 1 } });
  return { dir: dir!, store, config };
}

function organismEngine() {
  return new StubEngine({ script: (s) => {
    if (s.role === "dreamer") {
      const path = s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim();
      writeFileSync(path, JSON.stringify({ ambition: null, demands: [{ title: "F", rationale: "r", proposedScenarios: ["x"] }] }));
    } else if (s.role === "critic") {
      const path = s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim();
      writeFileSync(path, JSON.stringify({ decision: "approved", critique: "ok" }));
    } else if (s.role === "generator") {
      const genDir = s.prompt.match(/directory:\s*(\S+)/)![1]!;
      const id = s.prompt.match(/SCN-\d+/)![0];
      writeFileSync(join(genDir, `${id}.md`), `---\nid: ${id}\ntitle: ${id}\nstatus: ready\npriority: medium\npersona: User\ntags: [gen]\nsource: agent-discovered\n---\n# Scenario\nDo a thing.\n`);
    } else if (s.role === "runner") {
      const path = s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim();
      const sid = s.prompt.match(/SCENARIO (SCN-\d+)/)![1];
      writeFileSync(path, JSON.stringify({ runId: "x", scenarioId: sid, scenarioTitle: sid, status: "passed", startedAt: "t", finishedAt: "t", appBaseUrl: "http://x", appVersion: null, environment: "local", stepsExecuted: 1, failureStep: null, expectedOutcome: "x", actualOutcome: "x", consoleErrors: [], networkErrors: [], screenshots: [], artifacts: [], runnerNotes: "" }));
    }
    return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
  }});
}

describe("runEvolve", () => {
  it("runs the demand stage then the cycle on the generated scenario", async () => {
    const c = setup();
    const orchEvents: any[] = [];
    const sum = await runEvolve({
      engine: organismEngine(), store: c.store, config: c.config, targetRepo: c.dir,
      sink: () => {}, emit: (e) => orchEvents.push(e),
    });
    expect(sum.stage.scenariosCreated.map((s) => s.id)).toEqual(["SCN-001"]);
    expect(sum.cycle.runs.length).toBe(1);
    expect(sum.cycle.runs[0]!.scenarioId).toBe("SCN-001");
    expect(sum.cycle.runs[0]!.status).toBe("passed");
    expect(orchEvents.some((e) => e.type === "run.created")).toBe(true);
  });
});

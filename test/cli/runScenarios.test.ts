import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { runReadyScenariosCmd } from "../../src/cli/commands/runScenarios.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function seed() {
  dir = makeTmpDir();
  const scn = join(dir, ".adapt", "scenarios");
  mkdirSync(join(dir, ".adapt", "scenario-runs"), { recursive: true });
  mkdirSync(scn, { recursive: true });
  writeFileSync(join(dir, ".adapt", "config.json"), JSON.stringify({ targetRepoPath: dir, appBaseUrl: "http://localhost:3000" }), "utf8");
  for (const id of ["SCN-001", "SCN-002"]) {
    writeFileSync(join(scn, `${id}.md`), `---\nid: ${id}\ntitle: ${id}\nstatus: ready\npriority: medium\npersona: User\ntags: [smoke]\nsource: human-seeded\n---\nbody`, "utf8");
  }
  return dir!;
}

function passEngine() {
  return new StubEngine({ script: (spec) => {
    const m = spec.prompt.match(/RESULT_FILE=(.+)/);
    const sid = spec.prompt.match(/SCENARIO (SCN-\d+)/)![1];
    writeFileSync(m![1]!.trim(), JSON.stringify({
      runId: "x", scenarioId: sid, scenarioTitle: sid, status: "passed", startedAt: "t", finishedAt: "t",
      appBaseUrl: "http://localhost:3000", appVersion: null, environment: "local", stepsExecuted: 1,
      failureStep: null, expectedOutcome: "x", actualOutcome: "x", consoleErrors: [], networkErrors: [],
      screenshots: [], artifacts: [], linkedJiraIssue: null, runnerNotes: "" }), "utf8");
    return [{ kind: "agent.exit", role: spec.role, at: "t", exitCode: 0 }];
  }});
}

describe("runReadyScenariosCmd", () => {
  it("runs all scenarios and returns a summary", async () => {
    const repo = seed();
    const res = await runReadyScenariosCmd({ targetRepo: repo, engine: passEngine(), log: () => {} });
    expect(res.code).toBe(0);
    expect(res.records.length).toBe(2);
    expect(res.records.every((r) => r.status === "passed")).toBe(true);
  });

  it("runs a single scenario when given an id", async () => {
    const repo = seed();
    const res = await runReadyScenariosCmd({ targetRepo: repo, scenarioId: "SCN-002", engine: passEngine(), log: () => {} });
    expect(res.records.length).toBe(1);
    expect(res.records[0]!.scenarioId).toBe("SCN-002");
  });

  it("skips non-runnable scenarios (e.g. draft) when no id is given", async () => {
    dir = makeTmpDir();
    const scn = join(dir, ".adapt", "scenarios");
    mkdirSync(join(dir, ".adapt", "scenario-runs"), { recursive: true });
    mkdirSync(scn, { recursive: true });
    writeFileSync(join(dir, ".adapt", "config.json"), JSON.stringify({ targetRepoPath: dir, appBaseUrl: "http://localhost:3000" }), "utf8");
    writeFileSync(join(scn, "SCN-001.md"), `---\nid: SCN-001\ntitle: ready one\nstatus: ready\npriority: medium\npersona: User\ntags: [s]\nsource: human-seeded\n---\nbody`, "utf8");
    writeFileSync(join(scn, "SCN-009.md"), `---\nid: SCN-009\ntitle: draft one\nstatus: draft\npriority: low\npersona: User\ntags: [s]\nsource: human-seeded\n---\nbody`, "utf8");
    const res = await runReadyScenariosCmd({ targetRepo: dir, engine: passEngine(), log: () => {} });
    expect(res.records.length).toBe(1);
    expect(res.records[0]!.scenarioId).toBe("SCN-001");
  });
});

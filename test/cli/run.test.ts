import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { runCmd } from "../../src/cli/commands/run.ts";
import { DecisionLog } from "../../src/observability/decisionLog.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function quietEngine() {
  return new StubEngine({ script: (s) => {
    if (s.role === "dreamer") writeFileSync(s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim(), JSON.stringify({ ambition: null, demands: [] }));
    return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
  }});
}

describe("runCmd", () => {
  it("runs a bounded continuous loop and reports why it stopped", async () => {
    dir = makeTmpDir();
    for (const d of ["scenarios", "demands", "scenario-runs", "work-items"]) mkdirSync(join(dir, ".adapt", d), { recursive: true });
    writeFileSync(join(dir, ".adapt", "north-star.md"), "# North Star\nBe great.\n", "utf8");
    writeFileSync(join(dir, ".adapt", "config.json"), JSON.stringify({ targetRepoPath: dir, appBaseUrl: "http://x", run: { maxCycles: 1, pauseSeconds: 0 } }), "utf8");

    const res = await runCmd({ targetRepo: dir, engine: quietEngine(), log: () => {} });
    expect(res.code).toBe(0);
    expect(res.summary.cycles).toBe(1);
    expect(res.summary.stoppedBy).toBe("maxCycles");

    const today = new Date().toISOString().slice(0, 10);
    expect(new DecisionLog(dir!).readDay(today).some((e) => e.kind === "cycle.start")).toBe(true);
  });
});

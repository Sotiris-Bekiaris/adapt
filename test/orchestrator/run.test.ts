import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { StateStore } from "../../src/orchestrator/store.ts";
import { AdaptConfigSchema } from "../../src/config/schema.ts";
import { runContinuous } from "../../src/orchestrator/run.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function setup(runOver = {}) {
  dir = makeTmpDir();
  for (const d of ["scenarios", "demands", "scenario-runs", "work-items"]) mkdirSync(join(dir, ".adapt", d), { recursive: true });
  writeFileSync(join(dir, ".adapt", "north-star.md"), "# North Star\nBe great.\n", "utf8");
  const store = new StateStore(":memory:");
  const config = AdaptConfigSchema.parse({ targetRepoPath: dir, appBaseUrl: "http://x", run: runOver });
  return { dir: dir!, store, config };
}

// Dreamer proposes nothing -> evolve succeeds trivially (no demands, no runs).
function quietEngine() {
  return new StubEngine({ script: (s) => {
    if (s.role === "dreamer") writeFileSync(s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim(), JSON.stringify({ ambition: null, demands: [] }));
    return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
  }});
}

// Throws inside the agent -> runEvolve rejects -> a cycle error.
function throwingEngine() {
  return new StubEngine({ script: () => { throw new Error("boom"); } });
}

const noSleep = () => Promise.resolve();

describe("runContinuous", () => {
  it("stops at maxCycles", async () => {
    const c = setup({ maxCycles: 2, pauseSeconds: 0 });
    const sum = await runContinuous({ engine: quietEngine(), store: c.store, config: c.config, targetRepo: c.dir, sink: () => {}, emit: () => {}, sleep: noSleep });
    expect(sum.stoppedBy).toBe("maxCycles");
    expect(sum.cycles).toBe(2);
    expect(sum.evolveSummaries.length).toBe(2);
  });

  it("stops after maxConsecutiveErrors", async () => {
    const c = setup({ maxConsecutiveErrors: 1, maxCycles: 10, pauseSeconds: 0 });
    const errs: string[] = [];
    const sum = await runContinuous({ engine: throwingEngine(), store: c.store, config: c.config, targetRepo: c.dir, sink: () => {}, emit: (e) => { if (e.type === "cycle.error") errs.push(String(e.message)); }, sleep: noSleep });
    expect(sum.stoppedBy).toBe("errors");
    expect(sum.cycles).toBe(1);
    expect(errs.length).toBe(1);
  });

  it("stops on the signal (Ctrl-C)", async () => {
    const c = setup({ maxCycles: 99, pauseSeconds: 0 });
    const signal = { stopped: false };
    // The sleep after cycle 1 flips the signal, so the next loop iteration stops.
    const sleep = () => { signal.stopped = true; return Promise.resolve(); };
    const sum = await runContinuous({ engine: quietEngine(), store: c.store, config: c.config, targetRepo: c.dir, sink: () => {}, emit: () => {}, sleep, signal });
    expect(sum.stoppedBy).toBe("signal");
    expect(sum.cycles).toBe(1);
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { StateStore } from "../../src/orchestrator/store.ts";
import { Orchestrator } from "../../src/orchestrator/orchestrator.ts";
import { AdaptConfigSchema } from "../../src/config/schema.ts";
import { parseScenario } from "../../src/scenarios/parse.ts";
import { runScenario } from "../../src/orchestrator/runScenario.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function scenario(hooks = "") {
  return parseScenario(`---
id: SCN-001
title: Login works
status: ready
priority: high
persona: User
tags: [auth]
source: human-seeded
${hooks}---
Log in and see the home page.
`, "auth.login.md");
}

function setup(opts: { engine: any }) {
  dir = makeTmpDir();
  mkdirSync(join(dir, ".adapt", "scenario-runs"), { recursive: true });
  const store = new StateStore(":memory:");
  const orchestrator = new Orchestrator({
    targetRepo: dir, store, appBaseUrl: "http://localhost:3000",
    limits: { maxFixAttempts: 2, maxVerificationAttempts: 3, maxItemsPerRun: 10, maxCycleSeconds: 3600 },
    clock: () => "2026-05-26T10:00:00.000Z", now: () => new Date("2026-05-26T10:00:00.000Z"),
  });
  const config = AdaptConfigSchema.parse({ targetRepoPath: dir, appBaseUrl: "http://localhost:3000" });
  return { dir: dir!, orchestrator, config, engine: opts.engine, store };
}

function runnerEngine(status: string | null) {
  return new StubEngine({
    script: (spec) => {
      if (status !== null) {
        const m = spec.prompt.match(/RESULT_FILE=(.+)/);
        writeFileSync(m![1]!.trim(), JSON.stringify({
          runId: "ignored", scenarioId: "SCN-001", scenarioTitle: "Login works", status,
          startedAt: "t", finishedAt: "t", appBaseUrl: "http://localhost:3000", appVersion: null,
          environment: "local", stepsExecuted: 3, failureStep: status === "failed" ? 2 : null,
          expectedOutcome: "home page", actualOutcome: status === "failed" ? "error toast" : "home page",
          consoleErrors: [], networkErrors: [], screenshots: [], artifacts: [], linkedJiraIssue: null, runnerNotes: "ok",
        }), "utf8");
      }
      return [{ kind: "agent.exit", role: spec.role, at: "t", exitCode: 0 }];
    },
  });
}

describe("runScenario", () => {
  it("records a passed verdict and writes the ledger file", async () => {
    const d = setup({ engine: runnerEngine("passed") });
    const rec = await runScenario({ ...d, targetRepo: d.dir, sink: () => {} }, scenario());
    expect(rec.status).toBe("passed");
    expect(rec.failureStep).toBeNull();
    expect(existsSync(join(d.dir, ".adapt", "scenario-runs", `${rec.runId}.json`))).toBe(true);
  });

  it("records a failed verdict with the failing step", async () => {
    const d = setup({ engine: runnerEngine("failed") });
    const rec = await runScenario({ ...d, targetRepo: d.dir, sink: () => {} }, scenario());
    expect(rec.status).toBe("failed");
    expect(rec.failureStep).toBe(2);
  });

  it("resolves to inconclusive when the agent writes no result", async () => {
    const d = setup({ engine: runnerEngine(null) });
    const rec = await runScenario({ ...d, targetRepo: d.dir, sink: () => {} }, scenario());
    expect(rec.status).toBe("inconclusive");
  });

  it("maps an out-of-vocabulary agent status to inconclusive instead of throwing", async () => {
    // "queued" is schema-valid (a RunStatus) but not a runner verdict; it must not crash the run.
    const d = setup({ engine: runnerEngine("queued") });
    const rec = await runScenario({ ...d, targetRepo: d.dir, sink: () => {} }, scenario());
    expect(rec.status).toBe("inconclusive");
  });

  it("blocks the run (agent never runs) when the setup hook fails", async () => {
    let invoked = false;
    const engine = new StubEngine({ script: () => { invoked = true; return [{ kind: "agent.exit", role: "runner", at: "t", exitCode: 0 }]; } });
    const d = setup({ engine });
    const rec = await runScenario({ ...d, targetRepo: d.dir, sink: () => {} }, scenario("hooks:\n  setup: exit 7\n"));
    expect(rec.status).toBe("blocked");
    expect(invoked).toBe(false);
    expect(rec.runnerNotes).toContain("setup hook");
  });

  it("blocks (agent never runs) when no setup hook resolves and requireSetupHook is on", async () => {
    let invoked = false;
    const engine = new StubEngine({ script: () => { invoked = true; return [{ kind: "agent.exit", role: "runner", at: "t", exitCode: 0 }]; } });
    const d = setup({ engine });
    const config = { ...d.config, hooks: { ...d.config.hooks, requireSetupHook: true } };
    const rec = await runScenario({ ...d, config, targetRepo: d.dir, sink: () => {} }, scenario());
    expect(rec.status).toBe("blocked");
    expect(invoked).toBe(false);
    expect(rec.runnerNotes.toLowerCase()).toContain("no setup hook");
  });

  it("warns but still runs when no setup hook resolves and requireSetupHook is off (default)", async () => {
    const events: { text?: string }[] = [];
    const d = setup({ engine: runnerEngine("passed") });
    const rec = await runScenario({ ...d, targetRepo: d.dir, sink: (e) => events.push(e) }, scenario());
    expect(rec.status).toBe("passed");
    expect(events.some((e) => (e.text ?? "").toLowerCase().includes("no setup hook"))).toBe(true);
  });
});

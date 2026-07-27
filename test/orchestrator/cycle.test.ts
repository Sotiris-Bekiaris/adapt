import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { StateStore } from "../../src/orchestrator/store.ts";
import { AdaptConfigSchema } from "../../src/config/schema.ts";
import { runCycle } from "../../src/orchestrator/cycle.ts";
import { LocalTracker } from "../../src/tracker/localTracker.ts";
import { newWorkItem } from "../../src/tracker/workItem.ts";
import { newRunRecord } from "../../src/orchestrator/runRecord.ts";
import { RunLedger } from "../../src/orchestrator/runLedger.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

// Multi-role stub: writes the right fixture per spec.role. Runner -> failed; triage -> actionable;
// implementation -> impl result; verification -> verified.
function spineEngine() {
  return new StubEngine({ script: (s) => {
    const path = s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim();
    if (s.role === "runner") {
      const sid = s.prompt.match(/SCENARIO (SCN-\d+)/)![1];
      writeFileSync(path, JSON.stringify({ runId: "x", scenarioId: sid, scenarioTitle: sid, status: "failed", startedAt: "t", finishedAt: "t", appBaseUrl: "http://x", appVersion: null, environment: "local", stepsExecuted: 2, failureStep: 1, expectedOutcome: "ok", actualOutcome: "broken", consoleErrors: ["Err"], networkErrors: [], screenshots: [], artifacts: [], runnerNotes: "" }));
    } else if (s.role === "triage") {
      writeFileSync(path, JSON.stringify({ classification: "bug", severity: "high", title: "Fix it", isActionable: true, jiraKey: null, notes: "" }));
    } else if (s.role === "implementation") {
      writeFileSync(path, JSON.stringify({ branch: "adapt/ITEM-001", summary: "fixed", testsPassed: true }));
    } else if (s.role === "verification") {
      writeFileSync(path, JSON.stringify({ verified: true, status: "passed", failureStep: null, actualOutcome: null, notes: "" }));
    }
    return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
  }});
}

function setup() {
  dir = makeTmpDir();
  const scn = join(dir, ".adapt", "scenarios");
  mkdirSync(join(dir, ".adapt", "scenario-runs"), { recursive: true });
  mkdirSync(join(dir, ".adapt", "work-items"), { recursive: true });
  mkdirSync(scn, { recursive: true });
  writeFileSync(join(scn, "SCN-001.md"), `---\nid: SCN-001\ntitle: Login\nstatus: ready\npriority: high\npersona: User\ntags: [a]\nsource: human-seeded\n---\nLog in.`, "utf8");
  const store = new StateStore(":memory:");
  const config = AdaptConfigSchema.parse({ targetRepoPath: dir, appBaseUrl: "http://x" });
  return { dir: dir!, store, config };
}

describe("runCycle", () => {
  it("runs a full validate->triage->repair->verify pass and streams orchestrator + agent events", async () => {
    const c = setup();
    const orchEvents: any[] = [];
    const agentEvents: any[] = [];
    const sum = await runCycle({
      engine: spineEngine(), store: c.store, config: c.config, targetRepo: c.dir,
      sink: (e) => agentEvents.push(e), emit: (e) => orchEvents.push(e),
    });
    expect(sum.runs.length).toBe(1);
    expect(sum.runs[0]!.status).toBe("failed");
    expect(sum.triage.created.length).toBe(1);
    expect(sum.repaired.length).toBe(1);
    expect(sum.repaired[0]!.verified).toBe(true);
    expect(new LocalTracker(c.dir).list()[0]!.status).toBe("done");
    expect(orchEvents.some((e) => e.type === "run.created")).toBe(true);
    expect(agentEvents.some((e) => e.kind === "agent.exit")).toBe(true);
  });
});

describe("runCycle robustness", () => {
  it("re-drives a pre-existing reopened work-item (implement -> verify)", async () => {
    const c = setup();
    const tracker = new LocalTracker(c.dir);
    tracker.create({ ...newWorkItem({ id: "ITEM-001", record: { ...newRunRecord({ runId: "RUN-0", scenarioId: "SCN-001", scenarioTitle: "Login", appBaseUrl: "http://x", startedAt: "t" }), status: "failed", finishedAt: "t" }, dedupeKey: "k", createdAt: "t", triage: { classification: "bug", severity: "high", title: "Login fails", isActionable: true, jiraKey: null, notes: "" } }), status: "reopened" });
    writeFileSync(join(c.dir, ".adapt", "scenarios", "SCN-001.md"), `---\nid: SCN-001\ntitle: Login\nstatus: ready\npriority: high\npersona: User\ntags: [a]\nsource: human-seeded\n---\nLog in.`, "utf8");
    const engine = new StubEngine({ script: (s) => {
      const path = (s.prompt.match(/RESULT_FILE=(.+)/) || [])[1]?.trim();
      if (s.role === "runner") writeFileSync(path!, JSON.stringify({ runId: "x", scenarioId: "SCN-001", scenarioTitle: "Login", status: "passed", startedAt: "t", finishedAt: "t", appBaseUrl: "http://x", appVersion: null, environment: "local", stepsExecuted: 1, failureStep: null, expectedOutcome: "x", actualOutcome: "x", consoleErrors: [], networkErrors: [], screenshots: [], artifacts: [], runnerNotes: "" }));
      else if (s.role === "implementation") writeFileSync(path!, JSON.stringify({ branch: "adapt/ITEM-001", summary: "fix", testsPassed: true }));
      else if (s.role === "verification") writeFileSync(path!, JSON.stringify({ verified: true, status: "passed", failureStep: null, actualOutcome: null, notes: "" }));
      return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
    }});
    const sum = await runCycle({ engine, store: c.store, config: c.config, targetRepo: c.dir, sink: () => {}, emit: () => {} });
    expect(sum.repaired.some((r) => r.itemId === "ITEM-001" && r.verified)).toBe(true);
    expect(new LocalTracker(c.dir).list().find((i) => i.id === "ITEM-001")!.status).toBe("done");
  });

  it("recovers a run stranded 'running' before the cycle", async () => {
    const c = setup();
    const ledger = new RunLedger(c.dir, c.store);
    ledger.write({ ...newRunRecord({ runId: "RUN-STALE", scenarioId: "SCN-001", scenarioTitle: "x", appBaseUrl: "http://x", startedAt: "t" }), status: "running" });
    const engine = new StubEngine({ script: (s) => [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }] });
    await runCycle({ engine, store: c.store, config: c.config, targetRepo: c.dir, sink: () => {}, emit: () => {} });
    expect(c.store.getRun("RUN-STALE")?.status).toBe("inconclusive");
  });

  it("graduates a scenario once it has passed the threshold consecutively, then skips it", async () => {
    const c = setup();
    writeFileSync(join(c.dir, ".adapt", "scenarios", "SCN-001.md"), `---\nid: SCN-001\ntitle: Login\nstatus: ready\npriority: high\npersona: User\ntags: [a]\nsource: human-seeded\n---\nLog in.`, "utf8");
    const engine = new StubEngine({ script: (s) => {
      if (s.role === "runner") { const p = s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim(); writeFileSync(p, JSON.stringify({ runId: "x", scenarioId: "SCN-001", scenarioTitle: "Login", status: "passed", startedAt: "t", finishedAt: "t", appBaseUrl: "http://x", appVersion: null, environment: "local", stepsExecuted: 1, failureStep: null, expectedOutcome: "x", actualOutcome: "x", consoleErrors: [], networkErrors: [], screenshots: [], artifacts: [], runnerNotes: "" })); }
      else if (s.role === "graduation") { const p = s.prompt.match(/SPEC_FILE=(.+)/)![1]!.trim(); writeFileSync(p, `import { test } from "@playwright/test";\ntest("x", async () => {});\n`); }
      return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
    }});
    const deps = { engine, store: c.store, config: { ...c.config, limits: { ...c.config.limits, gradPassThreshold: 2 } }, targetRepo: c.dir, sink: () => {}, emit: () => {} };
    await runCycle(deps);             // pass 1 -> not yet graduated
    const after1 = await runCycle(deps); // pass 2 -> graduates
    expect(after1.graduated).toEqual(["SCN-001"]);
    const { parseScenario } = await import("../../src/scenarios/parse.ts");
    const { readFileSync: rf } = await import("node:fs");
    expect(parseScenario(rf(join(c.dir, ".adapt", "scenarios", "SCN-001.md"), "utf8"), "SCN-001.md").meta.status).toBe("graduated");
    const after2 = await runCycle(deps); // graduated -> skipped, no runs
    expect(after2.runs.length).toBe(0);
  });
});

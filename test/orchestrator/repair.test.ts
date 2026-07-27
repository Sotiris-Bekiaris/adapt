import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { StateStore } from "../../src/orchestrator/store.ts";
import { Orchestrator } from "../../src/orchestrator/orchestrator.ts";
import { AdaptConfigSchema } from "../../src/config/schema.ts";
import { parseScenario } from "../../src/scenarios/parse.ts";
import { LocalTracker } from "../../src/tracker/localTracker.ts";
import type { WorkItem } from "../../src/tracker/workItem.ts";
import { implementWorkItem, verifyWorkItem } from "../../src/orchestrator/repair.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

const scenario = () => parseScenario(`---\nid: SCN-001\ntitle: Login\nstatus: ready\npriority: high\npersona: User\ntags: [a]\nsource: human-seeded\n---\nLog in.`, "a.md");

function deps(engine: any, over = {}) {
  dir = makeTmpDir();
  mkdirSync(join(dir, ".adapt", "work-items"), { recursive: true });
  mkdirSync(join(dir, ".adapt", "scenario-runs"), { recursive: true });
  const store = new StateStore(":memory:");
  const orchestrator = new Orchestrator({ targetRepo: dir, store, appBaseUrl: "http://x", limits: AdaptConfigSchema.parse({ targetRepoPath: dir, appBaseUrl: "http://x", limits: over }).limits });
  const config = AdaptConfigSchema.parse({ targetRepoPath: dir, appBaseUrl: "http://x" });
  return { engine, orchestrator, config, targetRepo: dir!, sink: () => {}, store };
}

function item(status: WorkItem["status"]): WorkItem {
  return { id: "ITEM-001", title: "Login fails", scenarioId: "SCN-001", runIds: ["RUN-1"], expected: "home", actual: "err", classification: "bug", severity: "high", dedupeKey: "k", status, jiraKey: null, labels: [], notes: "", createdAt: "t" };
}

function writeResult(spec: any, payload: unknown) {
  const m = spec.prompt.match(/RESULT_FILE=(.+)/);
  writeFileSync(m![1]!.trim(), JSON.stringify(payload), "utf8");
}

describe("implementWorkItem", () => {
  it("records a fix attempt and moves the item to ready-for-verification", async () => {
    const engine = new StubEngine({ script: (s) => { writeResult(s, { branch: "adapt/ITEM-001", summary: "fix", testsPassed: true }); return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }]; } });
    const d = deps(engine);
    const tracker = new LocalTracker(d.targetRepo);
    tracker.create(item("triaged"));
    const res = await implementWorkItem(d, tracker.list()[0]!, scenario());
    expect(res.ok).toBe(true);
    expect(tracker.list()[0]!.status).toBe("ready-for-verification");
    expect(d.orchestrator.canAttempt("SCN-001", "fix")).toBe(true); // 1 of 2 used
  });
});

describe("verifyWorkItem", () => {
  it("verified -> item done + scenario regression", async () => {
    const engine = new StubEngine({ script: (s) => { writeResult(s, { verified: true, status: "passed", failureStep: null, actualOutcome: null, notes: "" }); return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }]; } });
    const d = deps(engine);
    const tracker = new LocalTracker(d.targetRepo);
    tracker.create(item("ready-for-verification"));
    const res = await verifyWorkItem(d, tracker.list()[0]!, scenario());
    expect(res.verified).toBe(true);
    expect(tracker.list()[0]!.status).toBe("done");
    expect(d.store.getScenarioState("SCN-001")).toBe("regression");
  });

  it("still failing -> item reopened", async () => {
    const engine = new StubEngine({ script: (s) => { writeResult(s, { verified: false, status: "failed", failureStep: 2, actualOutcome: "still broken", notes: "" }); return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }]; } });
    const d = deps(engine);
    const tracker = new LocalTracker(d.targetRepo);
    tracker.create(item("ready-for-verification"));
    const res = await verifyWorkItem(d, tracker.list()[0]!, scenario());
    expect(res.verified).toBe(false);
    expect(tracker.list()[0]!.status).toBe("reopened");
  });

  it("parks in needs-attention when verification attempts are exhausted", async () => {
    const engine = new StubEngine({ script: (s) => { writeResult(s, { verified: false, status: "failed", failureStep: 1, actualOutcome: "x", notes: "" }); return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }]; } });
    const d = deps(engine, { maxVerificationAttempts: 1 });
    const tracker = new LocalTracker(d.targetRepo);
    tracker.create(item("ready-for-verification"));
    const res = await verifyWorkItem(d, tracker.list()[0]!, scenario());
    expect(res.verified).toBe(false);
    expect(tracker.list()[0]!.status).toBe("needs-attention");
  });

  it("treats a missing verification result as inconclusive (item stays ready-for-verification, no attempt consumed)", async () => {
    const engine = new StubEngine({ script: (s) => [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }] }); // writes no result
    const d = deps(engine);
    const tracker = new LocalTracker(d.targetRepo);
    tracker.create(item("ready-for-verification"));
    const res = await verifyWorkItem(d, tracker.list()[0]!, scenario());
    expect(res.verified).toBe(false);
    expect(res.inconclusive).toBe(true);
    expect(tracker.list()[0]!.status).toBe("ready-for-verification"); // unchanged
    expect(d.orchestrator.canAttempt("SCN-001", "verification")).toBe(true); // still 0 attempts used
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { StateStore } from "../../src/orchestrator/store.ts";
import { AdaptConfigSchema } from "../../src/config/schema.ts";
import { runCycle } from "../../src/orchestrator/cycle.ts";
import { LocalTracker } from "../../src/tracker/localTracker.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

// Multi-role stub: writes the right fixture per spec.role. Runner -> failed; triage -> actionable;
// implementation -> impl result; verification -> verified.
function spineEngine() {
  return new StubEngine({ script: (s) => {
    const path = s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim();
    if (s.role === "runner") {
      const sid = s.prompt.match(/SCENARIO (SCN-\d+)/)![1];
      writeFileSync(path, JSON.stringify({ runId: "x", scenarioId: sid, scenarioTitle: sid, status: "failed", startedAt: "t", finishedAt: "t", appBaseUrl: "http://x", appVersion: null, environment: "local", stepsExecuted: 2, failureStep: 1, expectedOutcome: "ok", actualOutcome: "broken", consoleErrors: ["Err"], networkErrors: [], screenshots: [], artifacts: [], linkedJiraIssue: null, runnerNotes: "" }));
    } else if (s.role === "triage") {
      writeFileSync(path, JSON.stringify({ classification: "bug", severity: "high", title: "Fix it", isActionable: true, jiraKey: null, notes: "" }));
    } else if (s.role === "implementation") {
      writeFileSync(path, JSON.stringify({ branch: "adapt/ITEM-001", summary: "fixed", testsPassed: true, jiraMovedTo: null }));
    } else if (s.role === "verification") {
      writeFileSync(path, JSON.stringify({ verified: true, status: "passed", failureStep: null, actualOutcome: null, notes: "", jiraMovedTo: null }));
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

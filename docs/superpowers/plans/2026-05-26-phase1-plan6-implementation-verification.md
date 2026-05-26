# Phase 1 · Plan 6 — Implementation, Verification & the orchestrate loop

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the autonomous spine: an Implementation agent fixes a tracked work-item on a branch (never closing it), an *independent* Verification agent reruns the exact scenario in a real browser and only then marks it done (or reopens it), and `adapt orchestrate` runs one bounded validate→triage→repair→verify pass with everything streamed to the console.

**Architecture:** Node owns the deterministic state transitions and attempt limits; the agents do the fixing and the black-box re-verification. The fixer and verifier are separate `runRole` invocations (different roles, different MCP sets) — the verifier never implements, the implementer never closes. Attempt-limit breaches park a work-item in `needs-attention` (surfaced in the console; the loop continues). Fully stub-tested with a multi-role stub engine that switches on `spec.role`.

**Tech Stack:** Builds on Phase 0 + Plans 4–5. No new npm deps.

**Depends on:** Plan 4 (`runRole`, `mcpServersFor`, `runReadyScenarios`), Plan 5 (`LocalTracker`, `WorkItem`, `triageFailures`). Reused: `Orchestrator` (`canAttempt`/`recordAttempt`/`emit`), `assertTransition`, `WORK_ITEM_TRANSITIONS`, `EventBus`/`fromAgentEvent`/`fromOrchestratorEvent`/`DecisionLog` (Phase 0).

---

## File Structure

```
src/types.ts                              # MODIFIED: add "needs-attention" work-item status
src/orchestrator/lifecycles.ts            # MODIFIED: work-item transitions to/around needs-attention
src/agents/prompts/implementation.ts      # implementationPrompt(ctx) + ImplResultSchema
src/agents/prompts/verification.ts        # verificationPrompt(ctx) + VerificationResultSchema
src/orchestrator/repair.ts                # implementWorkItem(), verifyWorkItem(), moveItem()
src/orchestrator/cycle.ts                 # runCycle(deps) -> CycleSummary
src/cli/commands/orchestrate.ts           # adapt orchestrate
docs/first-real-run.md                    # checklist to prove the oracle on a real app
test/orchestrator/repair.test.ts
test/orchestrator/cycle.test.ts
test/cli/orchestrate.test.ts
(+ modified lifecycle test)
```

---

## Task 1: Add the `needs-attention` work-item status

**Files:**
- Modify: `src/types.ts`, `src/orchestrator/lifecycles.ts`, `test/orchestrator/lifecycles.test.ts`

- [ ] **Step 1: Add failing assertions** — in `test/orchestrator/lifecycles.test.ts` add inside the existing describe:

```ts
  it("work-items can be parked in needs-attention from key states", () => {
    expect(WORK_ITEM_TRANSITIONS.triaged).toContain("needs-attention");
    expect(WORK_ITEM_TRANSITIONS["ready-for-verification"]).toContain("needs-attention");
    expect(WORK_ITEM_TRANSITIONS.reopened).toContain("needs-attention");
    expect(WORK_ITEM_TRANSITIONS["needs-attention"]).toEqual([]);
  });
```

- [ ] **Step 2: Run** — `npx vitest run test/orchestrator/lifecycles.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** —
  In `src/types.ts`, add `"needs-attention"` to `WORK_ITEM_STATUSES`:

```ts
export const WORK_ITEM_STATUSES = [
  "open", "triaged", "in-progress", "in-review",
  "ready-for-verification", "done", "reopened", "needs-attention",
] as const;
```

  In `src/orchestrator/lifecycles.ts`, update `WORK_ITEM_TRANSITIONS`:

```ts
export const WORK_ITEM_TRANSITIONS: Transitions<WorkItemStatus> = {
  open: ["triaged"],
  triaged: ["in-progress", "needs-attention"],
  "in-progress": ["in-review"],
  "in-review": ["ready-for-verification"],
  "ready-for-verification": ["done", "reopened", "needs-attention"],
  reopened: ["in-progress", "needs-attention"],
  done: [],
  "needs-attention": [],
};
```

- [ ] **Step 4: Run** — `npx vitest run test/orchestrator/lifecycles.test.ts` (PASS), then `npx vitest run` to confirm the new enum value didn't break the WorkItem schema tests (PASS).

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/orchestrator/lifecycles.ts test/orchestrator/lifecycles.test.ts
git commit -m "feat(orchestrator): add needs-attention work-item status + transitions"
```

---

## Task 2: Implementation result schema + prompt

**Files:**
- Create: `src/agents/prompts/implementation.ts`
- Test: `test/agents/implementationPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { implementationPrompt, ImplResultSchema } from "../../src/agents/prompts/implementation.ts";
import { parseScenario } from "../../src/scenarios/parse.ts";
import type { WorkItem } from "../../src/tracker/workItem.ts";

const scenario = parseScenario(`---
id: SCN-001
title: Login works
status: failed
priority: high
persona: User
tags: [auth]
source: human-seeded
---
Log in and see the home page.
`, "auth.login.md");

const item: WorkItem = { id: "ITEM-001", title: "Login fails on submit", scenarioId: "SCN-001", runIds: ["RUN-1"], expected: "home page", actual: "error toast", classification: "bug", severity: "high", dedupeKey: "k", status: "triaged", jiraKey: "ADAPT-7", labels: [], notes: "", createdAt: "t" };

describe("implementation", () => {
  it("ImplResultSchema validates and defaults jiraMovedTo", () => {
    const r = ImplResultSchema.parse({ branch: "adapt/ITEM-001", summary: "fixed null guard", testsPassed: true });
    expect(r.jiraMovedTo).toBeNull();
  });
  it("prompt names the work-item, scenario, branch, RESULT_FILE, and the do-not-close rule", () => {
    const p = implementationPrompt({ item, scenario, branch: "adapt/ITEM-001", resultPath: "/r/.adapt/work-items/impl-ITEM-001.json", jiraEnabled: true });
    expect(p).toContain("ITEM-001");
    expect(p).toContain("SCN-001");
    expect(p).toContain("adapt/ITEM-001");
    expect(p).toContain("RESULT_FILE=/r/.adapt/work-items/impl-ITEM-001.json");
    expect(p.toLowerCase()).toContain("do not close");
    expect(p).toContain("ADAPT-7");
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/agents/implementationPrompt.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — `src/agents/prompts/implementation.ts`:

```ts
import { z } from "zod";
import type { ParsedScenario } from "../../scenarios/parse.ts";
import type { WorkItem } from "../../tracker/workItem.ts";

export const ImplResultSchema = z.object({
  branch: z.string().min(1),
  summary: z.string(),
  testsPassed: z.boolean(),
  jiraMovedTo: z.string().nullable().default(null),
});
export type ImplResult = z.infer<typeof ImplResultSchema>;

export interface ImplPromptCtx {
  item: WorkItem;
  scenario: ParsedScenario;
  branch: string;
  resultPath: string;
  jiraEnabled: boolean;
}

export function implementationPrompt(ctx: ImplPromptCtx): string {
  const { item, scenario, branch, resultPath, jiraEnabled } = ctx;
  const jira = jiraEnabled && item.jiraKey
    ? `Move the Jira issue ${item.jiraKey} to "Ready for Verification" (or "In Review") via the Jira MCP. Do NOT move it to Done.`
    : `Jira is not in play for this item; skip Jira updates.`;
  return `You are a software engineer fixing a tracked defect. You have full source access and may use the
Chrome DevTools MCP to inspect the running app while debugging.

WORK ITEM ${item.id} [${item.severity}] — ${item.title}${item.jiraKey ? ` (Jira ${item.jiraKey})` : ""}
Scenario ${scenario.meta.id}: ${scenario.meta.title}
Expected: ${item.expected ?? ""}
Actual:   ${item.actual ?? ""}

Scenario detail:
${scenario.body}

Do this:
1. Create and work on a git branch named exactly: ${branch}
2. Make the SMALLEST safe change that makes the user's expected outcome achievable. Add or update an automated test where practical.
3. Run the project's checks/tests.
4. ${jira}

Hard rules:
- Do NOT close the work item or move Jira to Done — verification is a separate, independent step.
- Do NOT weaken or edit the scenario to make it pass. Do NOT delete scenarios.
- Commit your change on the branch.

Write your result as a single JSON object to this exact path:
RESULT_FILE=${resultPath}
Shape: { "branch": "${branch}", "summary": "<what you changed>", "testsPassed": true|false, "jiraMovedTo": "<status>"|null }`;
}
```

- [ ] **Step 4: Run** — `npx vitest run test/agents/implementationPrompt.test.ts`. Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agents/prompts/implementation.ts test/agents/implementationPrompt.test.ts
git commit -m "feat(agents): implementation result schema + prompt"
```

---

## Task 3: Verification result schema + prompt

**Files:**
- Create: `src/agents/prompts/verification.ts`
- Test: `test/agents/verificationPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { verificationPrompt, VerificationResultSchema } from "../../src/agents/prompts/verification.ts";
import { parseScenario } from "../../src/scenarios/parse.ts";
import type { WorkItem } from "../../src/tracker/workItem.ts";

const scenario = parseScenario(`---
id: SCN-001
title: Login works
status: ready-for-verification
priority: high
persona: User
tags: [auth]
source: human-seeded
---
Log in and see the home page.
`, "auth.login.md");

const item: WorkItem = { id: "ITEM-001", title: "Login fails", scenarioId: "SCN-001", runIds: ["RUN-1"], expected: "home page", actual: "error toast", classification: "bug", severity: "high", dedupeKey: "k", status: "ready-for-verification", jiraKey: "ADAPT-7", labels: [], notes: "", createdAt: "t" };

describe("verification", () => {
  it("VerificationResultSchema validates and defaults", () => {
    const r = VerificationResultSchema.parse({ verified: true, status: "passed" });
    expect(r.failureStep).toBeNull();
    expect(r.jiraMovedTo).toBeNull();
  });
  it("prompt is black-box, names the scenario + app URL + RESULT_FILE, and the independence rule", () => {
    const p = verificationPrompt({ item, scenario, appBaseUrl: "http://localhost:3000", resultPath: "/r/.adapt/work-items/verify-ITEM-001.json", jiraEnabled: true });
    expect(p).toContain("SCN-001");
    expect(p).toContain("http://localhost:3000");
    expect(p).toContain("RESULT_FILE=/r/.adapt/work-items/verify-ITEM-001.json");
    expect(p.toLowerCase()).toContain("do not read");   // independent / black-box
    expect(p).toContain("ADAPT-7");
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/agents/verificationPrompt.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — `src/agents/prompts/verification.ts`:

```ts
import { z } from "zod";
import { RUN_STATUSES } from "../../types.ts";
import type { ParsedScenario } from "../../scenarios/parse.ts";
import type { WorkItem } from "../../tracker/workItem.ts";

export const VerificationResultSchema = z.object({
  verified: z.boolean(),
  status: z.enum(RUN_STATUSES),
  failureStep: z.number().int().nullable().default(null),
  actualOutcome: z.string().nullable().default(null),
  notes: z.string().default(""),
  jiraMovedTo: z.string().nullable().default(null),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export interface VerificationPromptCtx {
  item: WorkItem;
  scenario: ParsedScenario;
  appBaseUrl: string;
  resultPath: string;
  jiraEnabled: boolean;
}

export function verificationPrompt(ctx: VerificationPromptCtx): string {
  const { item, scenario, appBaseUrl, resultPath, jiraEnabled } = ctx;
  const jira = jiraEnabled && item.jiraKey
    ? `If verified, move Jira issue ${item.jiraKey} to "Done" via the Jira MCP. If still failing, move it back to "In Progress". Report the status you set in "jiraMovedTo".`
    : `Jira is not in play; set jiraMovedTo: null.`;
  return `You are an INDEPENDENT verifier. A fix was just attempted for the work item below. Your job is to confirm,
black-box, whether the original user scenario now succeeds. Behave exactly like the user. Do NOT read the source code
or the fix diff — interact only through the browser (Playwright MCP) against the running app at ${appBaseUrl}.

WORK ITEM ${item.id} — ${item.title}${item.jiraKey ? ` (Jira ${item.jiraKey})` : ""}
SCENARIO ${scenario.meta.id}: ${scenario.meta.title}

${scenario.body}

Rerun the scenario faithfully. Decide:
- verified: true ONLY if the visible expected outcome is now genuinely achieved.
- status: the run verdict ("passed" when verified; otherwise "failed"/"blocked"/"flaky"/"inconclusive").
Capture the failing step + what you actually saw if it still fails.

${jira}

Write your result as a single JSON object to this exact path:
RESULT_FILE=${resultPath}
Shape: { "verified": true|false, "status": "passed|failed|...", "failureStep": <int|null>, "actualOutcome": "<text>|null", "notes": "<text>", "jiraMovedTo": "<status>"|null }`;
}
```

- [ ] **Step 4: Run** — `npx vitest run test/agents/verificationPrompt.test.ts`. Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agents/prompts/verification.ts test/agents/verificationPrompt.test.ts
git commit -m "feat(agents): verification result schema + prompt"
```

---

## Task 4: `implementWorkItem` + `verifyWorkItem`

**Files:**
- Create: `src/orchestrator/repair.ts`
- Test: `test/orchestrator/repair.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
  return { engine, orchestrator, config, targetRepo: dir!, sink: () => {} };
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
    const engine = new StubEngine({ script: (s) => { writeResult(s, { branch: "adapt/ITEM-001", summary: "fix", testsPassed: true, jiraMovedTo: null }); return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }]; } });
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
    const engine = new StubEngine({ script: (s) => { writeResult(s, { verified: true, status: "passed", failureStep: null, actualOutcome: null, notes: "", jiraMovedTo: null }); return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }]; } });
    const d = deps(engine);
    const tracker = new LocalTracker(d.targetRepo);
    tracker.create(item("ready-for-verification"));
    const res = await verifyWorkItem(d, tracker.list()[0]!, scenario());
    expect(res.verified).toBe(true);
    expect(tracker.list()[0]!.status).toBe("done");
    expect(d.orchestrator["store"].getScenarioState("SCN-001")).toBe("regression");
  });

  it("still failing -> item reopened", async () => {
    const engine = new StubEngine({ script: (s) => { writeResult(s, { verified: false, status: "failed", failureStep: 2, actualOutcome: "still broken", notes: "", jiraMovedTo: null }); return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }]; } });
    const d = deps(engine);
    const tracker = new LocalTracker(d.targetRepo);
    tracker.create(item("ready-for-verification"));
    const res = await verifyWorkItem(d, tracker.list()[0]!, scenario());
    expect(res.verified).toBe(false);
    expect(tracker.list()[0]!.status).toBe("reopened");
  });

  it("parks in needs-attention when verification attempts are exhausted", async () => {
    const engine = new StubEngine({ script: (s) => { writeResult(s, { verified: false, status: "failed", failureStep: 1, actualOutcome: "x", notes: "", jiraMovedTo: null }); return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }]; } });
    const d = deps(engine, { maxVerificationAttempts: 1 });
    const tracker = new LocalTracker(d.targetRepo);
    tracker.create(item("ready-for-verification"));
    const res = await verifyWorkItem(d, tracker.list()[0]!, scenario());
    expect(res.verified).toBe(false);
    expect(tracker.list()[0]!.status).toBe("needs-attention");
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/orchestrator/repair.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/orchestrator/repair.ts`:

```ts
import { join } from "node:path";
import type { AgentEngine, AgentEvent } from "../engine/types.ts";
import type { AdaptConfig } from "../config/schema.ts";
import type { Orchestrator } from "./orchestrator.ts";
import type { WorkItemStatus } from "../types.ts";
import { assertTransition } from "./stateMachine.ts";
import { WORK_ITEM_TRANSITIONS } from "./lifecycles.ts";
import { workspacePaths } from "../workspace/paths.ts";
import { runRole } from "../agents/runRole.ts";
import { mcpServersFor } from "../engine/mcp.ts";
import { LocalTracker } from "../tracker/localTracker.ts";
import type { WorkItem } from "../tracker/workItem.ts";
import type { ParsedScenario } from "../scenarios/parse.ts";
import { implementationPrompt, ImplResultSchema, type ImplResult } from "../agents/prompts/implementation.ts";
import { verificationPrompt, VerificationResultSchema } from "../agents/prompts/verification.ts";

export interface RepairDeps {
  engine: AgentEngine;
  orchestrator: Orchestrator;
  config: AdaptConfig;
  targetRepo: string;
  sink: (e: AgentEvent) => void;
}

/** Move a work-item to `to`, validating the transition, and persist it. Returns the updated item. */
function moveItem(tracker: LocalTracker, item: WorkItem, to: WorkItemStatus): WorkItem {
  assertTransition(WORK_ITEM_TRANSITIONS, item.status, to);
  const updated = { ...item, status: to };
  tracker.update(updated);
  return updated;
}

/** Implement a fix for a work-item on a branch. Never closes the item. */
export async function implementWorkItem(
  deps: RepairDeps, item: WorkItem, scenario: ParsedScenario,
): Promise<{ ok: boolean; item: WorkItem; result?: ImplResult }> {
  const { engine, orchestrator, config, targetRepo, sink } = deps;
  const ws = workspacePaths(targetRepo);
  const tracker = new LocalTracker(targetRepo);

  orchestrator.recordAttempt(item.scenarioId, "fix");
  let current = moveItem(tracker, item, "in-progress");

  const branch = `adapt/${item.id}`;
  const resultPath = join(ws.workItemsDir, `impl-${item.id}.json`);
  const outcome = await runRole(
    engine,
    {
      role: "implementation",
      prompt: implementationPrompt({ item: current, scenario, branch, resultPath, jiraEnabled: config.mcp.jira.enabled }),
      cwd: targetRepo,
      mcpServers: mcpServersFor("implementation", config),
    },
    resultPath, ImplResultSchema, sink,
  );

  if (outcome.status !== "ok" || !outcome.value) {
    return { ok: false, item: current };
  }

  current = moveItem(tracker, current, "in-review");
  current = moveItem(tracker, current, "ready-for-verification");
  return { ok: true, item: current, result: outcome.value };
}

/** Independently verify a fix by rerunning the scenario black-box. Owns the done/reopen decision. */
export async function verifyWorkItem(
  deps: RepairDeps, item: WorkItem, scenario: ParsedScenario,
): Promise<{ verified: boolean; item: WorkItem; parked: boolean }> {
  const { engine, orchestrator, config, targetRepo, sink } = deps;
  const ws = workspacePaths(targetRepo);
  const tracker = new LocalTracker(targetRepo);

  if (!orchestrator.canAttempt(item.scenarioId, "verification")) {
    return { verified: false, item: moveItem(tracker, item, "needs-attention"), parked: true };
  }
  orchestrator.recordAttempt(item.scenarioId, "verification");

  const resultPath = join(ws.workItemsDir, `verify-${item.id}.json`);
  const outcome = await runRole(
    engine,
    {
      role: "verification",
      prompt: verificationPrompt({ item, scenario, appBaseUrl: config.appBaseUrl, resultPath, jiraEnabled: config.mcp.jira.enabled }),
      cwd: targetRepo,
      mcpServers: mcpServersFor("verification", config),
    },
    resultPath, VerificationResultSchema, sink,
  );

  if (outcome.status === "ok" && outcome.value?.verified) {
    const done = moveItem(tracker, item, "done");
    orchestrator["store"].setScenarioState(item.scenarioId, "regression");
    return { verified: true, item: done, parked: false };
  }

  // Still failing (or no valid result): reopen, then park if attempts are now exhausted.
  let current = moveItem(tracker, item, "reopened");
  if (!orchestrator.canAttempt(item.scenarioId, "verification")) {
    current = moveItem(tracker, current, "needs-attention");
    return { verified: false, item: current, parked: true };
  }
  return { verified: false, item: current, parked: false };
}
```

Note: `orchestrator["store"]` accesses the store the orchestrator was built with to set scenario regression state. (The store is a private field; bracket access keeps the public surface small for Phase 1. A `setScenarioState` passthrough on Orchestrator is a reasonable later refinement.)

- [ ] **Step 4: Run** — `npx vitest run test/orchestrator/repair.test.ts`. Expected: PASS (4 tests). If TypeScript objects to `orchestrator["store"]`, add a `getScenarioState`/`setScenarioState` passthrough on `Orchestrator` instead and use that; report it as a deviation.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/repair.ts test/orchestrator/repair.test.ts
git commit -m "feat(orchestrator): implement + verify work-items with attempt limits"
```

---

## Task 5: `runCycle` — the bounded orchestrate pass

**Files:**
- Create: `src/orchestrator/cycle.ts`
- Test: `test/orchestrator/cycle.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run** — `npx vitest run test/orchestrator/cycle.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/orchestrator/cycle.ts`:

```ts
import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { AgentEngine, AgentEvent } from "../engine/types.ts";
import type { AdaptConfig } from "../config/schema.ts";
import { StateStore } from "./store.ts";
import { Orchestrator, type OrchestratorEvent } from "./orchestrator.ts";
import { workspacePaths } from "../workspace/paths.ts";
import { rebuildRegistry } from "../scenarios/registry.ts";
import { parseScenario, type ParsedScenario } from "../scenarios/parse.ts";
import { runReadyScenarios } from "./runScenario.ts";
import { triageFailures, type TriageSummary } from "./triage.ts";
import { implementWorkItem, verifyWorkItem } from "./repair.ts";
import { LocalTracker } from "../tracker/localTracker.ts";
import { moveItemToNeedsAttention } from "./repair.ts";
import type { RunRecord } from "./runRecord.ts";

export interface CycleDeps {
  engine: AgentEngine;
  store: StateStore;
  config: AdaptConfig;
  targetRepo: string;
  sink: (e: AgentEvent) => void;
  emit: (e: OrchestratorEvent) => void;
  now?: () => string;
  nowDate?: () => Date;
}

export interface CycleSummary {
  runs: RunRecord[];
  triage: TriageSummary;
  repaired: { itemId: string; verified: boolean; parked: boolean }[];
}

function loadScenario(targetRepo: string, id: string): ParsedScenario | undefined {
  const ws = workspacePaths(targetRepo);
  const entry = rebuildRegistry(targetRepo).find((e) => e.id === id);
  if (!entry) return undefined;
  return parseScenario(readFileSync(join(ws.scenariosDir, entry.filename), "utf8"), entry.filename);
}

/** Run one bounded autonomous pass: validate -> triage -> repair -> verify. No infinite loop. */
export async function runCycle(deps: CycleDeps): Promise<CycleSummary> {
  const { engine, store, config, targetRepo, sink, emit } = deps;
  const orchestrator = new Orchestrator({
    targetRepo, store, appBaseUrl: config.appBaseUrl, limits: config.limits,
    emit, clock: deps.now, now: deps.nowDate,
  });

  const runs = await runReadyScenarios({ engine, orchestrator, config, targetRepo, sink });
  const triage = await triageFailures({ engine, store, config, targetRepo, sink, now: deps.now });

  const repaired: CycleSummary["repaired"] = [];
  const repairDeps = { engine, orchestrator, config, targetRepo, sink };
  const tracker = new LocalTracker(targetRepo);

  for (const created of triage.created) {
    const scenario = loadScenario(targetRepo, created.scenarioId);
    if (!scenario) continue;

    if (!orchestrator.canAttempt(created.scenarioId, "fix")) {
      const parked = moveItemToNeedsAttention(tracker, created);
      repaired.push({ itemId: parked.id, verified: false, parked: true });
      continue;
    }

    const impl = await implementWorkItem(repairDeps, created, scenario);
    if (!impl.ok) {
      repaired.push({ itemId: created.id, verified: false, parked: false });
      continue;
    }
    const ver = await verifyWorkItem(repairDeps, impl.item, scenario);
    repaired.push({ itemId: created.id, verified: ver.verified, parked: ver.parked });
  }

  return { runs, triage, repaired };
}
```

Add the small helper to `src/orchestrator/repair.ts` (export it; reuses the same validated transition):

```ts
import type { LocalTracker as LocalTrackerType } from "../tracker/localTracker.ts";
// ... at the bottom of repair.ts:
export function moveItemToNeedsAttention(tracker: LocalTrackerType, item: WorkItem): WorkItem {
  return moveItem(tracker, item, "needs-attention");
}
```

(`triaged → needs-attention` is a valid transition added in Task 1.)

- [ ] **Step 4: Run** — `npx vitest run test/orchestrator/cycle.test.ts`. Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/cycle.ts src/orchestrator/repair.ts test/orchestrator/cycle.test.ts
git commit -m "feat(orchestrator): runCycle — bounded validate/triage/repair/verify pass"
```

---

## Task 6: `adapt orchestrate` CLI + full verification

**Files:**
- Create: `src/cli/commands/orchestrate.ts`
- Modify: `src/cli/index.ts`
- Test: `test/cli/orchestrate.test.ts`

The CLI wires a single `EventBus` to the decision log and feeds it both orchestrator events (`emit`) and agent events (`sink`) — closing the Phase 0 carryover where only agent events were wired.

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run** — `npx vitest run test/cli/orchestrate.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/cli/commands/orchestrate.ts`:

```ts
import type { AgentEngine } from "../../engine/types.ts";
import { StubEngine } from "../../engine/stubEngine.ts";
import { ClaudeCodeEngine } from "../../engine/claudeCode.ts";
import { StateStore } from "../../orchestrator/store.ts";
import { loadConfig } from "../../config/load.ts";
import { workspacePaths } from "../../workspace/paths.ts";
import { runCycle, type CycleSummary } from "../../orchestrator/cycle.ts";
import { EventBus } from "../../observability/eventBus.ts";
import { DecisionLog } from "../../observability/decisionLog.ts";
import { fromAgentEvent, fromOrchestratorEvent, type ConsoleEvent } from "../../observability/events.ts";

export interface OrchestrateCmdOptions {
  targetRepo: string;
  engine?: AgentEngine;
  log?: (msg: string) => void;
}

export interface OrchestrateCmdResult { code: number; summary: CycleSummary; }

/** Core of `adapt orchestrate`: one bounded cycle, with all events mirrored to the decision log. */
export async function orchestrateCmd(opts: OrchestrateCmdOptions): Promise<OrchestrateCmdResult> {
  const log = opts.log ?? console.log;
  const config = loadConfig(opts.targetRepo);
  const ws = workspacePaths(opts.targetRepo);
  const engine = opts.engine ?? (config.engine.type === "stub" ? new StubEngine() : new ClaudeCodeEngine({ command: config.engine.command }));
  const store = new StateStore(`${ws.root}/state.db`);

  const bus = new EventBus<ConsoleEvent>();
  const decisionLog = new DecisionLog(opts.targetRepo);
  bus.subscribe((e) => decisionLog.append(e));

  const summary = await runCycle({
    engine, store, config, targetRepo: opts.targetRepo,
    sink: (e) => bus.publish(fromAgentEvent(e)),
    emit: (e) => bus.publish(fromOrchestratorEvent(e)),
  });

  store.close();
  log(`cycle: ${summary.runs.length} run(s), ${summary.triage.created.length} new item(s), ` +
      `${summary.repaired.filter((r) => r.verified).length} verified, ${summary.repaired.filter((r) => r.parked).length} parked`);
  return { code: 0, summary };
}
```

- [ ] **Step 4: Register the command — modify `src/cli/index.ts`** — add immediately before the final `program.parseAsync(process.argv);`:

```ts
program
  .command("orchestrate")
  .description("Run one bounded autonomous pass: validate -> triage -> repair -> verify")
  .argument("<targetRepo>", "path to the target product repository")
  .action(async (targetRepo: string) => {
    const { orchestrateCmd } = await import("./commands/orchestrate.ts");
    const res = await orchestrateCmd({ targetRepo });
    process.exit(res.code);
  });
```

- [ ] **Step 5: Run + full suite + typecheck** — `npx vitest run test/cli/orchestrate.test.ts` (PASS, 1 test), then `npx vitest run` (ALL Phase 0 + Phase 1 tests pass) and `npm run typecheck` (exit 0). Report all. If typecheck errors, report BLOCKED with exact text.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/orchestrate.ts src/cli/index.ts test/cli/orchestrate.test.ts
git commit -m "feat(cli): adapt orchestrate — one bounded autonomous pass"
```

---

## Task 7: "First real run" checklist

**Files:**
- Create: `docs/first-real-run.md`

This is the documented procedure where the oracle gets proven on real hardware (no automated test — it's a human runbook).

- [ ] **Step 1: Create `docs/first-real-run.md`**

```markdown
# adapt — First Real Run

Phase 1 is fully stub-tested. This runbook is how you prove the loop against a *real* full-stack app
with real Claude Code + Playwright + Jira. Do this on a throwaway branch of a real product.

## Prerequisites
- `claude` CLI installed and authenticated (the headless engine).
- Playwright MCP (`@playwright/mcp`) and (optional) Jira MCP available to your `claude` setup.
- The target app runnable locally; note its base URL and start command.

## Steps
1. Plug in: `adapt init /path/to/app --app-base-url http://localhost:3000`
2. Copy `/path/to/app/.adapt/config.example.json` → `config.json`; set:
   - `engine.type: "claude-code"`
   - `appBaseUrl`, `startCommand`
   - `hooks.setup` / `hooks.teardown` pointing at an **isolated test database** reset/seed
   - `mcp.playwright.enabled: true`; for Jira: `mcp.jira.enabled: true`, `jira.projectKey`, transitions
3. Add `/.adapt/state.db*` to the app repo's `.gitignore`.
4. Seed 1–3 real scenarios in `.adapt/scenarios/` (delete the example).
5. Start the app. In another terminal: `adapt run-scenarios /path/to/app` — confirm the RunRecords in
   `.adapt/scenario-runs/` reflect reality (a real pass passes; introduce a known bug and confirm it fails).
6. `adapt triage-failures /path/to/app` — confirm a sensible, deduplicated work-item (and Jira issue if enabled).
7. `adapt orchestrate /path/to/app` — watch one full pass; open `adapt console` alongside to watch live.
8. Inspect: the fix branch `adapt/ITEM-xxx`, the work-item status, the decision log, and (if enabled) the Jira issue.

## What success looks like (blueprint §17)
The system discovers a real user-visible breakage, files a clear work-item, an agent fixes it on a branch,
and an *independent* agent confirms the original scenario now passes — with a decision log clear enough to
reconstruct every step.

## If the oracle is unreliable
This is the expected place to discover it. Tighten scenario "expected outcome" wording, add API-level
assertions to scenarios where the UI can't reveal truth, and prefer gross-failure detection over subtle
correctness — exactly as the blueprint (§5) warns.
```

- [ ] **Step 2: Commit**

```bash
git add docs/first-real-run.md
git commit -m "docs: first-real-run checklist for proving the oracle"
```

---

## Self-Review (completed during authoring)

- **Spec coverage (Plan 6):** Implementation agent fixes on a branch, never closes, moves Jira to ready-for-verification → Tasks 2, 4; independent Verification reruns black-box and owns done/reopen → Tasks 3, 4; fixer ≠ verifier (separate `runRole` calls, different roles/MCP) → Task 4; attempt limits + `needs-attention` parking → Tasks 1, 4; bounded `orchestrate` pass wiring orchestrator + agent events to the console/decision-log → Tasks 5–6 (closes the Phase 0 carryover); "first real run" → Task 7.
- **Type consistency:** `RepairDeps` (engine/orchestrator/config/targetRepo/sink) is shared by `implementWorkItem`/`verifyWorkItem`; `CycleDeps` adds `emit`. `ImplResult`/`VerificationResult` schemas match their prompts' documented shapes. `moveItem`/`moveItemToNeedsAttention` validate via `WORK_ITEM_TRANSITIONS`. `mcpServersFor`, `runRole`, `runReadyScenarios`, `triageFailures`, `LocalTracker`, `WorkItem` reused unchanged from Plans 4–5.
- **Known seam:** `verifyWorkItem` reaches `orchestrator["store"]` to set the scenario's `regression` state; Task 4 Step 4 notes the clean alternative (a passthrough method) if TS/readability prefers it.
- **Bounded by design:** the cycle processes each newly-created work-item once (impl→verify); re-driving `reopened` items across passes is deferred (Phase 3 continuous mode), so `orchestrate` always terminates.

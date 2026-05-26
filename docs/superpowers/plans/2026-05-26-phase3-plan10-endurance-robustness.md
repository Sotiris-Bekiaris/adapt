# Phase 3 · Plan 10 — Endurance Robustness

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a single `evolve`/`cycle` safe to repeat indefinitely: the verifier never mistakes an infra failure for a real failure, in-flight work-items get re-driven across cycles, the Dreamer can't spam duplicate demands, and stranded runs are recovered at the start of each cycle.

**Architecture:** Surgical modifications to existing Phase 1/2 code — `verifyWorkItem` (inconclusive semantics), `runCycle` (re-drive `reopened`/`ready-for-verification` items + `recoverIncomplete` at start), and `runDream` (demand dedup). One small new helper (`demandTitleKey`). Fully stub-tested; existing tests must keep passing.

**Tech Stack:** Builds on Phases 0–2. No new npm deps.

**Depends on:** Phase 2 merged. Modifies `src/orchestrator/repair.ts`, `src/orchestrator/cycle.ts`, `src/demand/dream.ts`. Reuses `runRole`, `LocalTracker`, `LocalDemandStore`, `Orchestrator`.

---

## File Structure

```
src/orchestrator/repair.ts     # MODIFY: verifyWorkItem -> inconclusive on infra failure; add `inconclusive` to result
src/orchestrator/cycle.ts      # MODIFY: driveItem helper; re-drive reopened/ready-for-verification; recoverIncomplete at start
src/demand/dedupeDemand.ts     # NEW: demandTitleKey(title)
src/demand/dream.ts            # MODIFY: dedup demands against existing non-rejected demands
test/orchestrator/repair.test.ts   # MODIFY: add inconclusive test
test/orchestrator/cycle.test.ts    # MODIFY: add re-drive + recover tests
test/demand/dedupeDemand.test.ts   # NEW
test/demand/dream.test.ts          # MODIFY: add dedup test
```

---

## Task 1: Verifier inconclusive semantics

**Files:** Modify `src/orchestrator/repair.ts`, `test/orchestrator/repair.test.ts`

A missing/invalid/crashed verification result must be `inconclusive` — leave the work-item at `ready-for-verification` for a later retry, and do NOT consume a verification attempt. Only a genuine `verified:false` reopens.

- [ ] **Step 1: Add a failing test** — in `test/orchestrator/repair.test.ts`, inside `describe("verifyWorkItem", ...)`, add:

```ts
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
```

- [ ] **Step 2: Run** — `npx vitest run test/orchestrator/repair.test.ts`. Expected: FAIL (no `inconclusive` field; current code would reopen).

- [ ] **Step 3: Implement** — in `src/orchestrator/repair.ts`, replace the entire `verifyWorkItem` function with:

```ts
/** Independently verify a fix by rerunning the scenario black-box. Owns the done/reopen decision.
 *  A missing/invalid result is inconclusive: the item is left at ready-for-verification for a later
 *  retry and no verification attempt is consumed (never a false "still-failing"). */
export async function verifyWorkItem(
  deps: RepairDeps, item: WorkItem, scenario: ParsedScenario,
): Promise<{ verified: boolean; item: WorkItem; parked: boolean; inconclusive: boolean }> {
  const { engine, orchestrator, config, targetRepo, sink } = deps;
  const ws = workspacePaths(targetRepo);
  const tracker = new LocalTracker(targetRepo);

  if (!orchestrator.canAttempt(item.scenarioId, "verification")) {
    return { verified: false, item: moveItem(tracker, item, "needs-attention"), parked: true, inconclusive: false };
  }

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

  // Infra failure (no valid verdict): inconclusive — retry next cycle, don't consume an attempt or reopen.
  if (outcome.status !== "ok" || !outcome.value) {
    return { verified: false, item, parked: false, inconclusive: true };
  }

  orchestrator.recordAttempt(item.scenarioId, "verification");

  if (outcome.value.verified) {
    const done = moveItem(tracker, item, "done");
    orchestrator["store"].setScenarioState(item.scenarioId, "regression");
    return { verified: true, item: done, parked: false, inconclusive: false };
  }

  let current = moveItem(tracker, item, "reopened");
  if (!orchestrator.canAttempt(item.scenarioId, "verification")) {
    current = moveItem(tracker, current, "needs-attention");
    return { verified: false, item: current, parked: true, inconclusive: false };
  }
  return { verified: false, item: current, parked: false, inconclusive: false };
}
```

- [ ] **Step 4: Run** — `npx vitest run test/orchestrator/repair.test.ts` (PASS — the new test plus the existing verified/reopened/exhausted tests, which still hold since a valid verdict still records an attempt). Then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/repair.ts test/orchestrator/repair.test.ts
git commit -m "fix(orchestrator): verifier infra-failure -> inconclusive (no false still-failing)"
```

---

## Task 2: Cycle re-drives in-flight items + recovers stranded runs

**Files:** Modify `src/orchestrator/cycle.ts`, `test/orchestrator/cycle.test.ts`

Across cycles, a `reopened` item must get another fix and a `ready-for-verification` item (left inconclusive) must get another verify. And each cycle recovers any run stranded `running` by a crash.

- [ ] **Step 1: Add failing tests** — in `test/orchestrator/cycle.test.ts`, add these imports at the top (if not present): `import { LocalTracker } from "../../src/tracker/localTracker.ts";` (already imported) and add a new describe:

```ts
import { newWorkItem } from "../../src/tracker/workItem.ts";
import { newRunRecord } from "../../src/orchestrator/runRecord.ts";
import { RunLedger } from "../../src/orchestrator/runLedger.ts";

describe("runCycle robustness", () => {
  it("re-drives a pre-existing reopened work-item (implement -> verify)", async () => {
    const c = setup(); // no scenarios on disk -> no new runs/triage
    // Seed a reopened work-item from a "prior cycle" for SCN-001.
    const tracker = new LocalTracker(c.dir);
    tracker.create({ ...newWorkItem({ id: "ITEM-001", record: { ...newRunRecord({ runId: "RUN-0", scenarioId: "SCN-001", scenarioTitle: "Login", appBaseUrl: "http://x", startedAt: "t" }), status: "failed", finishedAt: "t" }, dedupeKey: "k", createdAt: "t", triage: { classification: "bug", severity: "high", title: "Login fails", isActionable: true, jiraKey: null, notes: "" } }), status: "reopened" });
    // Seed the scenario file so loadScenario finds it.
    writeFileSync(join(c.dir, ".adapt", "scenarios", "SCN-001.md"), `---\nid: SCN-001\ntitle: Login\nstatus: ready\npriority: high\npersona: User\ntags: [a]\nsource: human-seeded\n---\nLog in.`, "utf8");

    // Engine: implementation + verification both succeed (verified) for the reopened item.
    const engine = new StubEngine({ script: (s) => {
      const path = (s.prompt.match(/RESULT_FILE=(.+)/) || [])[1]?.trim();
      if (s.role === "runner") writeFileSync(path!, JSON.stringify({ runId: "x", scenarioId: "SCN-001", scenarioTitle: "Login", status: "passed", startedAt: "t", finishedAt: "t", appBaseUrl: "http://x", appVersion: null, environment: "local", stepsExecuted: 1, failureStep: null, expectedOutcome: "x", actualOutcome: "x", consoleErrors: [], networkErrors: [], screenshots: [], artifacts: [], linkedJiraIssue: null, runnerNotes: "" }));
      else if (s.role === "implementation") writeFileSync(path!, JSON.stringify({ branch: "adapt/ITEM-001", summary: "fix", testsPassed: true, jiraMovedTo: null }));
      else if (s.role === "verification") writeFileSync(path!, JSON.stringify({ verified: true, status: "passed", failureStep: null, actualOutcome: null, notes: "", jiraMovedTo: null }));
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
});
```

Note: `setup()` already exists in this test file and creates the `.adapt` dirs + a `:memory:` store + config (no scenario files unless added). Ensure `writeFileSync`, `join` are imported (they are at the top of the file).

- [ ] **Step 2: Run** — `npx vitest run test/orchestrator/cycle.test.ts`. Expected: FAIL (reopened item not re-driven; stranded run not recovered).

- [ ] **Step 3: Implement** — replace the entire `runCycle` function in `src/orchestrator/cycle.ts` with:

```ts
/** Run one bounded autonomous pass: recover -> validate -> triage -> repair (new + in-flight). No infinite loop. */
export async function runCycle(deps: CycleDeps): Promise<CycleSummary> {
  const { engine, store, config, targetRepo, sink, emit } = deps;
  const orchestrator = new Orchestrator({
    targetRepo, store, appBaseUrl: config.appBaseUrl, limits: config.limits,
    emit, clock: deps.now, now: deps.nowDate,
  });

  orchestrator.recoverIncomplete(); // clean up runs stranded by a crashed prior cycle

  const runs = await runReadyScenarios({ engine, orchestrator, config, targetRepo, sink });
  const triage = await triageFailures({ engine, store, config, targetRepo, sink, now: deps.now });

  const repaired: CycleSummary["repaired"] = [];
  const repairDeps = { engine, orchestrator, config, targetRepo, sink };
  const tracker = new LocalTracker(targetRepo);

  const createdIds = new Set(triage.created.map((c) => c.id));

  // 1. Drive the newly-created work-items.
  for (const created of triage.created) {
    const scenario = loadScenario(targetRepo, created.scenarioId);
    if (!scenario) continue;
    repaired.push(await driveItem(repairDeps, orchestrator, tracker, created, scenario));
  }

  // 2. Re-drive pre-existing in-flight items from earlier cycles (reopened -> re-implement,
  //    ready-for-verification -> re-verify after a prior inconclusive).
  for (const item of tracker.list()) {
    if (createdIds.has(item.id)) continue;
    if (item.status !== "reopened" && item.status !== "ready-for-verification") continue;
    const scenario = loadScenario(targetRepo, item.scenarioId);
    if (!scenario) continue;
    repaired.push(await driveItem(repairDeps, orchestrator, tracker, item, scenario));
  }

  return { runs, triage, repaired };
}

/** Drive a single work-item to its next state. ready-for-verification -> verify only;
 *  triaged/reopened -> implement (within fix attempts) then verify. */
async function driveItem(
  repairDeps: RepairDeps, orchestrator: Orchestrator, tracker: LocalTracker, item: WorkItem, scenario: ParsedScenario,
): Promise<{ itemId: string; verified: boolean; parked: boolean }> {
  if (item.status === "ready-for-verification") {
    const ver = await verifyWorkItem(repairDeps, item, scenario);
    return { itemId: item.id, verified: ver.verified, parked: ver.parked };
  }
  if (!orchestrator.canAttempt(item.scenarioId, "fix")) {
    const parked = moveItemToNeedsAttention(tracker, item);
    return { itemId: parked.id, verified: false, parked: true };
  }
  const impl = await implementWorkItem(repairDeps, item, scenario);
  if (!impl.ok) return { itemId: item.id, verified: false, parked: false };
  const ver = await verifyWorkItem(repairDeps, impl.item, scenario);
  return { itemId: item.id, verified: ver.verified, parked: ver.parked };
}
```

And add these imports at the top of `src/orchestrator/cycle.ts` (they're needed by `driveItem`'s types and `verifyWorkItem`; some may already be imported — verify and add only the missing ones):

```ts
import { implementWorkItem, verifyWorkItem, moveItemToNeedsAttention, type RepairDeps } from "./repair.ts";
import { LocalTracker } from "../tracker/localTracker.ts";
import type { WorkItem } from "../tracker/workItem.ts";
```

(`implementWorkItem`, `verifyWorkItem`, `moveItemToNeedsAttention`, `LocalTracker` were already imported by the Phase 1 cycle; ADD `type RepairDeps` to the repair import and `type WorkItem` from the tracker. Export `RepairDeps` from `src/orchestrator/repair.ts` if it isn't already — it is exported.)

- [ ] **Step 4: Run** — `npx vitest run test/orchestrator/cycle.test.ts` (PASS — the two new tests plus the original full-pass test). Then `npx vitest run` (the Phase 1/2 cycle + evolve tests must still pass) and `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/cycle.ts test/orchestrator/cycle.test.ts
git commit -m "feat(orchestrator): cycle re-drives in-flight items + recovers stranded runs"
```

---

## Task 3: Demand dedupe key

**Files:** Create `src/demand/dedupeDemand.ts`; Test `test/demand/dedupeDemand.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { demandTitleKey } from "../../src/demand/dedupeDemand.ts";

describe("demandTitleKey", () => {
  it("normalizes case and whitespace", () => {
    expect(demandTitleKey("  Add   CSV  Export ")).toBe(demandTitleKey("add csv export"));
  });
  it("differs for different titles", () => {
    expect(demandTitleKey("Add CSV export")).not.toBe(demandTitleKey("Add PDF export"));
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/demand/dedupeDemand.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — `src/demand/dedupeDemand.ts`:

```ts
/** Normalized key for deduping demands by title (case- and whitespace-insensitive). */
export function demandTitleKey(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}
```

- [ ] **Step 4: Run** — `npx vitest run test/demand/dedupeDemand.test.ts`. Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/demand/dedupeDemand.ts test/demand/dedupeDemand.test.ts
git commit -m "feat(demand): demandTitleKey for dedup"
```

---

## Task 4: Dedup demands in `runDream` + full verification

**Files:** Modify `src/demand/dream.ts`, `test/demand/dream.test.ts`

- [ ] **Step 1: Add a failing test** — in `test/demand/dream.test.ts`, add inside `describe("runDream", ...)`:

```ts
  it("skips demands whose title duplicates an existing non-rejected demand", async () => {
    const c = ctx();
    // Pre-seed an existing demand.
    const { LocalDemandStore } = await import("../../src/demand/demandStore.ts");
    const { newDemand } = await import("../../src/demand/demand.ts");
    new LocalDemandStore(c.dir).create(newDemand({ id: "DMD-001", title: "Demand 1", rationale: "r", proposedScenarios: [], createdAt: "t" }));
    // Dreamer proposes "Demand 1" (dup, different case/space) + "Demand 2" (new).
    const engine = new StubEngine({ script: (s) => {
      const path = s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim();
      writeFileSync(path, JSON.stringify({ ambition: null, demands: [
        { title: "  demand   1 ", rationale: "r", proposedScenarios: [] },
        { title: "Demand 2", rationale: "r", proposedScenarios: [] },
      ] }), "utf8");
      return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
    }});
    const res = await runDream({ engine, config: c.config, targetRepo: c.dir, sink: () => {}, now: () => "t" });
    expect(res.demands.map((d) => d.title)).toEqual(["Demand 2"]); // dup dropped
    expect(new LocalDemandStore(c.dir).list().length).toBe(2); // existing + the one new
  });
```

- [ ] **Step 2: Run** — `npx vitest run test/demand/dream.test.ts`. Expected: FAIL (dup currently created).

- [ ] **Step 3: Implement** — in `src/demand/dream.ts`, add the import near the top:

```ts
import { demandTitleKey } from "./dedupeDemand.ts";
```

Then replace the demand-creation block (the `const created: Demand[] = [];` loop) with:

```ts
  const created: Demand[] = [];
  const seen = new Set(store.list().filter((d) => d.status !== "rejected").map((d) => demandTitleKey(d.title)));
  for (const d of outcome.value.demands) {
    if (created.length >= config.limits.maxDemandsPerCycle) break;
    const key = demandTitleKey(d.title);
    if (seen.has(key)) continue; // dedup against existing + already-created-this-pass
    seen.add(key);
    const demand = newDemand({ id: store.nextId(), title: d.title, rationale: d.rationale, proposedScenarios: d.proposedScenarios, createdAt: now() });
    store.create(demand);
    created.push(demand);
  }
```

- [ ] **Step 4: Run** — `npx vitest run test/demand/dream.test.ts` (PASS — incl. the existing cap/ambition/no-result tests), then `npx vitest run` (ALL pass) and `npx tsc --noEmit` (exit 0). Report all.

- [ ] **Step 5: Commit**

```bash
git add src/demand/dream.ts test/demand/dream.test.ts
git commit -m "feat(demand): dedup proposed demands against existing non-rejected demands"
```

---

## Self-Review (completed during authoring)

- **Spec coverage (Plan 10 / spec §4):** verifier inconclusive → Task 1; re-drive reopened + ready-for-verification → Task 2; `recoverIncomplete` at cycle start → Task 2; demand dedup → Tasks 3–4.
- **Type consistency:** `verifyWorkItem` now returns `{ verified, item, parked, inconclusive }` — the cycle's `driveItem` only reads `verified`/`parked`, so adding `inconclusive` is backward-compatible. `driveItem(repairDeps, orchestrator, tracker, item, scenario)` is the shared per-item driver. `demandTitleKey` is reused by `runDream`. `RepairDeps`/`WorkItem` imported into `cycle.ts`.
- **Existing tests preserved:** the original cycle/evolve full-pass tests still hold (a created item drives implement→verify→done exactly as before; the re-drive loop skips this-cycle's created items, and tracker has no pre-existing in-flight items in those tests). The verifyWorkItem verified/reopened/exhausted tests still pass (a valid verdict still records an attempt).
- **Deferred to Plan 11/12:** consecutive-pass tracking, the `graduated` status, the Grad agent (Plan 11); the `adapt run` continuous loop (Plan 12).

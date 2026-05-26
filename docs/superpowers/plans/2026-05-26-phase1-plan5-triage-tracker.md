# Phase 1 · Plan 5 — Failure Triage + Work Tracker

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn failed runs into deduplicated, classified, tracked work-items — one per root failure, never spam. Node owns deterministic dedup and the canonical local work-item JSON; a Triage agent supplies judgment (classification, severity, title) and creates the Jira issue via MCP when enabled.

**Architecture:** `triageFailures` gathers `failed` runs that aren't yet linked to any work-item, computes a deterministic `dedupeKey` for each, and: appends the run to an existing item if the key matches (no agent call), otherwise — up to `maxItemsPerRun` — invokes the Triage agent to classify the new failure group and persists a canonical `WorkItem` via the `LocalTracker`. Deterministic dedup is Node's; judgment + Jira are the agent's. Fully stub-tested.

**Tech Stack:** Builds on Phase 0 + Plan 4 (`runRole`, `mcpServersFor`, `RunLedger`, `StateStore`, `RunRecord`). No new npm deps.

**Depends on:** Plan 4 (`src/agents/runRole.ts`, `src/engine/mcp.ts`). Reused: `RunRecord`/`RunRecordSchema`, `RunLedger`, `StateStore.findRunsByStatus`, `workspacePaths`, `AdaptConfig`, `WORK_ITEM_STATUSES`, `StubEngine`.

---

## File Structure

```
src/tracker/workItem.ts          # zod WorkItem schema + type + newWorkItem()
src/tracker/dedupe.ts            # dedupeKey(run) — deterministic root-failure key
src/tracker/localTracker.ts      # LocalTracker: list/find/create/appendRun/nextId/allLinkedRunIds
src/agents/prompts/triage.ts     # triagePrompt(ctx) + TriageResultSchema
src/orchestrator/triage.ts       # triageFailures(deps) -> TriageSummary
src/cli/commands/triageFailures.ts  # adapt triage-failures
test/tracker/workItem.test.ts
test/tracker/dedupe.test.ts
test/tracker/localTracker.test.ts
test/agents/triagePrompt.test.ts
test/orchestrator/triage.test.ts
test/cli/triageFailures.test.ts
```

---

## Task 1: WorkItem schema + factory

**Files:**
- Create: `src/tracker/workItem.ts`
- Test: `test/tracker/workItem.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { WorkItemSchema, newWorkItem } from "../../src/tracker/workItem.ts";

const record = {
  runId: "RUN-1", scenarioId: "SCN-001", scenarioTitle: "Login works", status: "failed",
  startedAt: "t", finishedAt: "t", appBaseUrl: "http://x", appVersion: null, environment: "local",
  stepsExecuted: 3, failureStep: 2, expectedOutcome: "home page", actualOutcome: "error toast",
  consoleErrors: ["TypeError x"], networkErrors: [], screenshots: [], artifacts: [], linkedJiraIssue: null, runnerNotes: "",
} as const;

describe("WorkItem", () => {
  it("newWorkItem builds a valid triaged item from a run + triage verdict", () => {
    const item = newWorkItem({
      id: "ITEM-001", record, dedupeKey: "k", createdAt: "2026-05-26T10:00:00.000Z",
      triage: { classification: "bug", severity: "high", title: "Login fails on submit", isActionable: true, jiraKey: "ADAPT-12", notes: "" },
    });
    expect(WorkItemSchema.safeParse(item).success).toBe(true);
    expect(item.runIds).toEqual(["RUN-1"]);
    expect(item.status).toBe("triaged");
    expect(item.jiraKey).toBe("ADAPT-12");
    expect(item.expected).toBe("home page");
    expect(item.actual).toBe("error toast");
  });

  it("rejects an unknown classification", () => {
    expect(WorkItemSchema.safeParse({ id: "ITEM-001", title: "x", scenarioId: "SCN-001", runIds: ["RUN-1"], expected: null, actual: null, classification: "weird", severity: "low", dedupeKey: "k", status: "open", jiraKey: null, labels: [], notes: "", createdAt: "t" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/tracker/workItem.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/tracker/workItem.ts`:

```ts
import { z } from "zod";
import { WORK_ITEM_STATUSES } from "../types.ts";
import type { RunRecord } from "../orchestrator/runRecord.ts";

export const CLASSIFICATIONS = ["bug", "environment", "test-data", "invalid-scenario", "flaky", "needs-human"] as const;
export const SEVERITIES = ["low", "medium", "high", "critical"] as const;

export const WorkItemSchema = z.object({
  id: z.string().regex(/^ITEM-\d+$/, "id must look like ITEM-001"),
  title: z.string().min(1),
  scenarioId: z.string(),
  runIds: z.array(z.string()).min(1),
  expected: z.string().nullable(),
  actual: z.string().nullable(),
  classification: z.enum(CLASSIFICATIONS),
  severity: z.enum(SEVERITIES),
  dedupeKey: z.string(),
  status: z.enum(WORK_ITEM_STATUSES),
  jiraKey: z.string().nullable(),
  labels: z.array(z.string()),
  notes: z.string(),
  createdAt: z.string(),
});

export type WorkItem = z.infer<typeof WorkItemSchema>;

export interface TriageVerdict {
  classification: (typeof CLASSIFICATIONS)[number];
  severity: (typeof SEVERITIES)[number];
  title: string;
  isActionable: boolean;
  jiraKey: string | null;
  notes: string;
}

export function newWorkItem(args: {
  id: string; record: RunRecord; dedupeKey: string; createdAt: string; triage: TriageVerdict;
}): WorkItem {
  const { id, record, dedupeKey, createdAt, triage } = args;
  return {
    id,
    title: triage.title,
    scenarioId: record.scenarioId,
    runIds: [record.runId],
    expected: record.expectedOutcome,
    actual: record.actualOutcome,
    classification: triage.classification,
    severity: triage.severity,
    dedupeKey,
    status: "triaged",
    jiraKey: triage.jiraKey,
    labels: [],
    notes: triage.notes,
    createdAt,
  };
}
```

- [ ] **Step 4: Run** — `npx vitest run test/tracker/workItem.test.ts`. Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tracker/workItem.ts test/tracker/workItem.test.ts
git commit -m "feat(tracker): WorkItem schema + factory"
```

---

## Task 2: Deterministic dedupe key

**Files:**
- Create: `src/tracker/dedupe.ts`
- Test: `test/tracker/dedupe.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { dedupeKey } from "../../src/tracker/dedupe.ts";

const base = {
  runId: "RUN-1", scenarioId: "SCN-001", scenarioTitle: "x", status: "failed", startedAt: "t", finishedAt: "t",
  appBaseUrl: "http://x", appVersion: null, environment: "local", stepsExecuted: 3, failureStep: 2,
  expectedOutcome: "home", actualOutcome: "Error TOAST  shown", consoleErrors: ["TypeError: x is undefined"],
  networkErrors: [], screenshots: [], artifacts: [], linkedJiraIssue: null, runnerNotes: "",
} as any;

describe("dedupeKey", () => {
  it("is identical for the same failure regardless of whitespace/case in actualOutcome", () => {
    const a = dedupeKey(base);
    const b = dedupeKey({ ...base, runId: "RUN-2", actualOutcome: "error toast shown" });
    expect(a).toBe(b);
  });
  it("differs when the failing step differs", () => {
    expect(dedupeKey(base)).not.toBe(dedupeKey({ ...base, failureStep: 3 }));
  });
  it("differs when the first console error differs", () => {
    expect(dedupeKey(base)).not.toBe(dedupeKey({ ...base, consoleErrors: ["ReferenceError: y"] }));
  });
  it("incorporates the scenario id", () => {
    expect(dedupeKey(base)).not.toBe(dedupeKey({ ...base, scenarioId: "SCN-002" }));
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/tracker/dedupe.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/tracker/dedupe.ts`:

```ts
import type { RunRecord } from "../orchestrator/runRecord.ts";

function norm(s: string | null | undefined, max = 120): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, max);
}

/** Deterministic key identifying a root failure: scenario + failing step + normalized
 *  actual outcome + first console & network error signatures. Same root → same key. */
export function dedupeKey(run: RunRecord): string {
  return [
    run.scenarioId,
    String(run.failureStep ?? "-"),
    norm(run.actualOutcome),
    norm(run.consoleErrors[0], 80),
    norm(run.networkErrors[0], 80),
  ].join(" | ");
}
```

- [ ] **Step 4: Run** — `npx vitest run test/tracker/dedupe.test.ts`. Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tracker/dedupe.ts test/tracker/dedupe.test.ts
git commit -m "feat(tracker): deterministic dedupe key"
```

---

## Task 3: LocalTracker (canonical work-item store)

**Files:**
- Create: `src/tracker/localTracker.ts`
- Test: `test/tracker/localTracker.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { LocalTracker } from "../../src/tracker/localTracker.ts";
import type { WorkItem } from "../../src/tracker/workItem.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function item(id: string, key: string, runIds: string[]): WorkItem {
  return { id, title: id, scenarioId: "SCN-001", runIds, expected: null, actual: null, classification: "bug", severity: "high", dedupeKey: key, status: "triaged", jiraKey: null, labels: [], notes: "", createdAt: "t" };
}

describe("LocalTracker", () => {
  it("creates, lists, and finds by dedupe key", () => {
    dir = makeTmpDir();
    const t = new LocalTracker(dir);
    t.create(item("ITEM-001", "k1", ["RUN-1"]));
    expect(t.list().length).toBe(1);
    expect(t.findByDedupeKey("k1")?.id).toBe("ITEM-001");
    expect(t.findByDedupeKey("nope")).toBeUndefined();
  });

  it("appendRun adds a runId once (idempotent) without duplicating the item", () => {
    dir = makeTmpDir();
    const t = new LocalTracker(dir);
    t.create(item("ITEM-001", "k1", ["RUN-1"]));
    t.appendRun("ITEM-001", "RUN-2");
    t.appendRun("ITEM-001", "RUN-2"); // again
    expect(t.list().length).toBe(1);
    expect(t.list()[0]!.runIds).toEqual(["RUN-1", "RUN-2"]);
  });

  it("allLinkedRunIds collects every linked run", () => {
    dir = makeTmpDir();
    const t = new LocalTracker(dir);
    t.create(item("ITEM-001", "k1", ["RUN-1", "RUN-2"]));
    t.create(item("ITEM-002", "k2", ["RUN-3"]));
    expect([...t.allLinkedRunIds()].sort()).toEqual(["RUN-1", "RUN-2", "RUN-3"]);
  });

  it("nextId increments based on existing items", () => {
    dir = makeTmpDir();
    const t = new LocalTracker(dir);
    expect(t.nextId()).toBe("ITEM-001");
    t.create(item("ITEM-001", "k1", ["RUN-1"]));
    expect(t.nextId()).toBe("ITEM-002");
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/tracker/localTracker.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/tracker/localTracker.ts`:

```ts
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { workspacePaths } from "../workspace/paths.ts";
import { WorkItemSchema, type WorkItem } from "./workItem.ts";

/** Canonical local store of work-items: one JSON file per item in .adapt/work-items/. */
export class LocalTracker {
  private dir: string;

  constructor(targetRepo: string) {
    this.dir = workspacePaths(targetRepo).workItemsDir;
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  private fileFor(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  list(): WorkItem[] {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json") && f.startsWith("ITEM-"))
      .map((f) => WorkItemSchema.parse(JSON.parse(readFileSync(join(this.dir, f), "utf8"))))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  findByDedupeKey(key: string): WorkItem | undefined {
    return this.list().find((i) => i.dedupeKey === key);
  }

  allLinkedRunIds(): Set<string> {
    return new Set(this.list().flatMap((i) => i.runIds));
  }

  nextId(): string {
    return `ITEM-${String(this.list().length + 1).padStart(3, "0")}`;
  }

  create(item: WorkItem): void {
    writeFileSync(this.fileFor(item.id), JSON.stringify(WorkItemSchema.parse(item), null, 2) + "\n", "utf8");
  }

  appendRun(itemId: string, runId: string): void {
    const item = WorkItemSchema.parse(JSON.parse(readFileSync(this.fileFor(itemId), "utf8")));
    if (!item.runIds.includes(runId)) item.runIds.push(runId);
    writeFileSync(this.fileFor(itemId), JSON.stringify(item, null, 2) + "\n", "utf8");
  }

  update(item: WorkItem): void {
    writeFileSync(this.fileFor(item.id), JSON.stringify(WorkItemSchema.parse(item), null, 2) + "\n", "utf8");
  }
}
```

- [ ] **Step 4: Run** — `npx vitest run test/tracker/localTracker.test.ts`. Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/tracker/localTracker.ts test/tracker/localTracker.test.ts
git commit -m "feat(tracker): LocalTracker work-item store"
```

---

## Task 4: Triage result schema + prompt

**Files:**
- Create: `src/agents/prompts/triage.ts`
- Test: `test/agents/triagePrompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { triagePrompt, TriageResultSchema } from "../../src/agents/prompts/triage.ts";

const record = {
  runId: "RUN-1", scenarioId: "SCN-001", scenarioTitle: "Login works", status: "failed", startedAt: "t", finishedAt: "t",
  appBaseUrl: "http://x", appVersion: null, environment: "local", stepsExecuted: 3, failureStep: 2,
  expectedOutcome: "home page", actualOutcome: "error toast", consoleErrors: ["TypeError"], networkErrors: [],
  screenshots: [], artifacts: [], linkedJiraIssue: null, runnerNotes: "",
} as any;

describe("triage", () => {
  it("TriageResultSchema validates a verdict and defaults jiraKey/notes", () => {
    const v = TriageResultSchema.parse({ classification: "bug", severity: "high", title: "Login fails", isActionable: true });
    expect(v.jiraKey).toBeNull();
    expect(v.notes).toBe("");
  });
  it("prompt includes the evidence, the RESULT_FILE contract, and a Jira instruction when enabled", () => {
    const p = triagePrompt({ record, resultPath: "/r/.adapt/work-items/triage-RUN-1.json", jiraEnabled: true, projectKey: "ADAPT" });
    expect(p).toContain("SCN-001");
    expect(p).toContain("error toast");
    expect(p).toContain("RESULT_FILE=/r/.adapt/work-items/triage-RUN-1.json");
    expect(p.toLowerCase()).toContain("jira");
    expect(p).toContain("ADAPT");
  });
  it("prompt omits Jira creation when disabled", () => {
    const p = triagePrompt({ record, resultPath: "/x.json", jiraEnabled: false, projectKey: "" });
    expect(p).toContain("jiraKey: null");
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/agents/triagePrompt.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/agents/prompts/triage.ts`:

```ts
import { z } from "zod";
import { CLASSIFICATIONS, SEVERITIES } from "../../tracker/workItem.ts";
import type { RunRecord } from "../../orchestrator/runRecord.ts";

export const TriageResultSchema = z.object({
  classification: z.enum(CLASSIFICATIONS),
  severity: z.enum(SEVERITIES),
  title: z.string().min(1),
  isActionable: z.boolean(),
  jiraKey: z.string().nullable().default(null),
  notes: z.string().default(""),
});
export type TriageResult = z.infer<typeof TriageResultSchema>;

export interface TriagePromptCtx {
  record: RunRecord;
  resultPath: string;
  jiraEnabled: boolean;
  projectKey: string;
}

export function triagePrompt(ctx: TriagePromptCtx): string {
  const { record, resultPath, jiraEnabled, projectKey } = ctx;
  const jiraInstruction = jiraEnabled
    ? `Because Jira is enabled, create a Jira issue in project ${projectKey} (type Bug) using the Jira MCP, with the title, the expected vs actual, reproduction = the scenario steps, and the evidence below. Put the created issue key in "jiraKey".`
    : `Jira is disabled. Set jiraKey: null. Do not attempt to create a Jira issue.`;
  return `You are a failure-triage analyst. A black-box run of a scenario FAILED. Decide whether this is a real,
actionable product bug, and classify it. You may use the Chrome DevTools MCP to inspect the failing page if helpful.
Do NOT modify any code.

FAILED RUN ${record.runId} — scenario ${record.scenarioId} "${record.scenarioTitle}"
Failing step: ${record.failureStep ?? "?"}
Expected: ${record.expectedOutcome ?? ""}
Actual:   ${record.actualOutcome ?? ""}
Console errors: ${JSON.stringify(record.consoleErrors)}
Network errors: ${JSON.stringify(record.networkErrors)}
Runner notes: ${record.runnerNotes ?? ""}

Classify it:
- classification: one of ${CLASSIFICATIONS.join(", ")}.
- severity: one of ${SEVERITIES.join(", ")}.
- isActionable: true only if this is a real product defect worth fixing (not a test-data/environment/flaky/invalid-scenario artifact).
- title: a concise issue title.

${jiraInstruction}

Write your verdict as a single JSON object to this exact path:
RESULT_FILE=${resultPath}
Shape: { "classification": "...", "severity": "...", "title": "...", "isActionable": true|false, "jiraKey": "KEY-123"|null, "notes": "..." }`;
}
```

- [ ] **Step 4: Run** — `npx vitest run test/agents/triagePrompt.test.ts`. Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agents/prompts/triage.ts test/agents/triagePrompt.test.ts
git commit -m "feat(agents): triage result schema + prompt"
```

---

## Task 5: `triageFailures`

**Files:**
- Create: `src/orchestrator/triage.ts`
- Test: `test/orchestrator/triage.test.ts`

Node does deterministic dedup + cap; the agent classifies each NEW failure group.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { StateStore } from "../../src/orchestrator/store.ts";
import { RunLedger } from "../../src/orchestrator/runLedger.ts";
import { newRunRecord, type RunRecord } from "../../src/orchestrator/runRecord.ts";
import { AdaptConfigSchema } from "../../src/config/schema.ts";
import { triageFailures } from "../../src/orchestrator/triage.ts";
import { LocalTracker } from "../../src/tracker/localTracker.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function failedRecord(runId: string, over: Partial<RunRecord> = {}): RunRecord {
  return { ...newRunRecord({ runId, scenarioId: "SCN-001", scenarioTitle: "Login", appBaseUrl: "http://x", startedAt: "t" }),
    status: "failed", finishedAt: "t", failureStep: 2, actualOutcome: "error toast", consoleErrors: ["TypeError"], ...over };
}

function ctx(over = {}) {
  dir = makeTmpDir();
  mkdirSync(join(dir, ".adapt", "scenario-runs"), { recursive: true });
  mkdirSync(join(dir, ".adapt", "work-items"), { recursive: true });
  const store = new StateStore(":memory:");
  const ledger = new RunLedger(dir, store);
  const config = AdaptConfigSchema.parse({ targetRepoPath: dir, appBaseUrl: "http://x", limits: { maxItemsPerRun: 10 }, ...over });
  return { dir: dir!, store, ledger, config };
}

// Triage agent: writes a verdict to RESULT_FILE. `actionable` toggles isActionable.
function triageEngine(actionable = true) {
  return new StubEngine({ script: (spec) => {
    const m = spec.prompt.match(/RESULT_FILE=(.+)/);
    writeFileSync(m![1]!.trim(), JSON.stringify({ classification: "bug", severity: "high", title: "Login fails", isActionable: actionable, jiraKey: null, notes: "" }), "utf8");
    return [{ kind: "agent.exit", role: spec.role, at: "t", exitCode: 0 }];
  }});
}

describe("triageFailures", () => {
  it("creates a work-item for a new failure", async () => {
    const c = ctx();
    c.ledger.write(failedRecord("RUN-1"));
    const sum = await triageFailures({ engine: triageEngine(), store: c.store, config: c.config, targetRepo: c.dir, sink: () => {} });
    expect(sum.created.length).toBe(1);
    expect(sum.created[0]!.classification).toBe("bug");
    expect(new LocalTracker(c.dir).list().length).toBe(1);
  });

  it("dedupes a second identical failure onto the existing item (no agent, no new item)", async () => {
    const c = ctx();
    c.ledger.write(failedRecord("RUN-1"));
    await triageFailures({ engine: triageEngine(), store: c.store, config: c.config, targetRepo: c.dir, sink: () => {} });
    c.ledger.write(failedRecord("RUN-2")); // same dedupeKey
    const sum = await triageFailures({ engine: triageEngine(), store: c.store, config: c.config, targetRepo: c.dir, sink: () => {} });
    expect(sum.created.length).toBe(0);
    expect(sum.deduped.length).toBe(1);
    const items = new LocalTracker(c.dir).list();
    expect(items.length).toBe(1);
    expect(items[0]!.runIds.sort()).toEqual(["RUN-1", "RUN-2"]);
  });

  it("skips non-actionable failures (no work-item)", async () => {
    const c = ctx();
    c.ledger.write(failedRecord("RUN-1"));
    const sum = await triageFailures({ engine: triageEngine(false), store: c.store, config: c.config, targetRepo: c.dir, sink: () => {} });
    expect(sum.created.length).toBe(0);
    expect(sum.skipped.length).toBe(1);
    expect(new LocalTracker(c.dir).list().length).toBe(0);
  });

  it("caps new items at maxItemsPerRun", async () => {
    const c = ctx({ limits: { maxItemsPerRun: 1 } });
    c.ledger.write(failedRecord("RUN-1", { failureStep: 1, actualOutcome: "a" }));
    c.ledger.write(failedRecord("RUN-2", { failureStep: 2, actualOutcome: "b" })); // distinct key
    const sum = await triageFailures({ engine: triageEngine(), store: c.store, config: c.config, targetRepo: c.dir, sink: () => {} });
    expect(sum.created.length).toBe(1);
    expect(sum.skipped.length).toBe(1);
  });

  it("does not re-triage a run already linked to an item", async () => {
    const c = ctx();
    c.ledger.write(failedRecord("RUN-1"));
    await triageFailures({ engine: triageEngine(), store: c.store, config: c.config, targetRepo: c.dir, sink: () => {} });
    const sum = await triageFailures({ engine: triageEngine(), store: c.store, config: c.config, targetRepo: c.dir, sink: () => {} });
    expect(sum.created.length).toBe(0);
    expect(sum.deduped.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/orchestrator/triage.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/orchestrator/triage.ts`:

```ts
import { join } from "node:path";
import type { AgentEngine, AgentEvent } from "../engine/types.ts";
import type { AdaptConfig } from "../config/schema.ts";
import { workspacePaths } from "../workspace/paths.ts";
import { StateStore } from "./store.ts";
import { RunLedger } from "./runLedger.ts";
import { runRole } from "../agents/runRole.ts";
import { mcpServersFor } from "../engine/mcp.ts";
import { dedupeKey } from "../tracker/dedupe.ts";
import { LocalTracker } from "../tracker/localTracker.ts";
import { newWorkItem, type WorkItem } from "../tracker/workItem.ts";
import { triagePrompt, TriageResultSchema } from "../agents/prompts/triage.ts";

export interface TriageDeps {
  engine: AgentEngine;
  store: StateStore;
  config: AdaptConfig;
  targetRepo: string;
  sink: (e: AgentEvent) => void;
  now?: () => string;
}

export interface TriageSummary {
  created: WorkItem[];
  deduped: { itemId: string; runId: string }[];
  skipped: string[];
}

/** Convert un-triaged failed runs into deduped, classified work-items. */
export async function triageFailures(deps: TriageDeps): Promise<TriageSummary> {
  const { engine, store, config, targetRepo, sink } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const ws = workspacePaths(targetRepo);
  const tracker = new LocalTracker(targetRepo);
  const ledger = new RunLedger(targetRepo, store);

  const summary: TriageSummary = { created: [], deduped: [], skipped: [] };
  const linked = tracker.allLinkedRunIds();
  const candidates = store.findRunsByStatus("failed").filter((r) => !linked.has(r.runId));
  let createdCount = 0;

  for (const row of candidates) {
    const record = ledger.read(row.runId);
    const key = dedupeKey(record);

    const existing = tracker.findByDedupeKey(key);
    if (existing) {
      tracker.appendRun(existing.id, record.runId);
      summary.deduped.push({ itemId: existing.id, runId: record.runId });
      continue;
    }

    if (createdCount >= config.limits.maxItemsPerRun) {
      summary.skipped.push(record.runId);
      continue;
    }

    const resultPath = join(ws.workItemsDir, `triage-${record.runId}.json`);
    const outcome = await runRole(
      engine,
      {
        role: "triage",
        prompt: triagePrompt({ record, resultPath, jiraEnabled: config.mcp.jira.enabled, projectKey: config.jira.projectKey }),
        cwd: targetRepo,
        mcpServers: mcpServersFor("triage", config),
      },
      resultPath,
      TriageResultSchema,
      sink,
    );

    if (outcome.status !== "ok" || !outcome.value || !outcome.value.isActionable) {
      summary.skipped.push(record.runId);
      continue;
    }

    const item = newWorkItem({ id: tracker.nextId(), record, dedupeKey: key, createdAt: now(), triage: outcome.value });
    tracker.create(item);
    summary.created.push(item);
    createdCount++;
  }

  return summary;
}
```

- [ ] **Step 4: Run** — `npx vitest run test/orchestrator/triage.test.ts`. Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/triage.ts test/orchestrator/triage.test.ts
git commit -m "feat(orchestrator): triageFailures — dedup + classify into work-items"
```

---

## Task 6: `adapt triage-failures` CLI + full verification

**Files:**
- Create: `src/cli/commands/triageFailures.ts`
- Modify: `src/cli/index.ts`
- Test: `test/cli/triageFailures.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { StateStore } from "../../src/orchestrator/store.ts";
import { RunLedger } from "../../src/orchestrator/runLedger.ts";
import { newRunRecord } from "../../src/orchestrator/runRecord.ts";
import { triageFailuresCmd } from "../../src/cli/commands/triageFailures.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

describe("triageFailuresCmd", () => {
  it("triages failed runs and reports a summary", async () => {
    dir = makeTmpDir();
    mkdirSync(join(dir, ".adapt", "scenario-runs"), { recursive: true });
    mkdirSync(join(dir, ".adapt", "work-items"), { recursive: true });
    writeFileSync(join(dir, ".adapt", "config.json"), JSON.stringify({ targetRepoPath: dir, appBaseUrl: "http://x" }), "utf8");
    const store = new StateStore(join(dir, ".adapt", "state.db"));
    const ledger = new RunLedger(dir, store);
    ledger.write({ ...newRunRecord({ runId: "RUN-1", scenarioId: "SCN-001", scenarioTitle: "Login", appBaseUrl: "http://x", startedAt: "t" }), status: "failed", finishedAt: "t", failureStep: 2, actualOutcome: "err" });
    store.close();

    const engine = new StubEngine({ script: (spec) => {
      const m = spec.prompt.match(/RESULT_FILE=(.+)/);
      writeFileSync(m![1]!.trim(), JSON.stringify({ classification: "bug", severity: "high", title: "t", isActionable: true, jiraKey: null, notes: "" }), "utf8");
      return [{ kind: "agent.exit", role: spec.role, at: "t", exitCode: 0 }];
    }});

    const res = await triageFailuresCmd({ targetRepo: dir, engine, log: () => {} });
    expect(res.code).toBe(0);
    expect(res.summary.created.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/cli/triageFailures.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/cli/commands/triageFailures.ts`:

```ts
import type { AgentEngine } from "../../engine/types.ts";
import { StubEngine } from "../../engine/stubEngine.ts";
import { ClaudeCodeEngine } from "../../engine/claudeCode.ts";
import { StateStore } from "../../orchestrator/store.ts";
import { loadConfig } from "../../config/load.ts";
import { workspacePaths } from "../../workspace/paths.ts";
import { triageFailures, type TriageSummary } from "../../orchestrator/triage.ts";

export interface TriageCmdOptions {
  targetRepo: string;
  engine?: AgentEngine;
  log?: (msg: string) => void;
}

export interface TriageCmdResult { code: number; summary: TriageSummary; }

/** Core of `adapt triage-failures`. */
export async function triageFailuresCmd(opts: TriageCmdOptions): Promise<TriageCmdResult> {
  const log = opts.log ?? console.log;
  const config = loadConfig(opts.targetRepo);
  const ws = workspacePaths(opts.targetRepo);
  const engine = opts.engine ?? (config.engine.type === "stub" ? new StubEngine() : new ClaudeCodeEngine({ command: config.engine.command }));
  const store = new StateStore(`${ws.root}/state.db`);
  const summary = await triageFailures({ engine, store, config, targetRepo: opts.targetRepo, sink: () => {} });
  store.close();
  log(`triaged: ${summary.created.length} new, ${summary.deduped.length} deduped, ${summary.skipped.length} skipped`);
  for (const i of summary.created) log(`  ${i.id}  [${i.severity}] ${i.title}${i.jiraKey ? `  (${i.jiraKey})` : ""}`);
  return { code: 0, summary };
}
```

- [ ] **Step 4: Register the command — modify `src/cli/index.ts`** — add immediately before the final `program.parseAsync(process.argv);`:

```ts
program
  .command("triage-failures")
  .description("Triage failed runs into deduplicated, classified work-items")
  .argument("<targetRepo>", "path to the target product repository")
  .action(async (targetRepo: string) => {
    const { triageFailuresCmd } = await import("./commands/triageFailures.ts");
    const res = await triageFailuresCmd({ targetRepo });
    process.exit(res.code);
  });
```

- [ ] **Step 5: Run + full suite + typecheck** — `npx vitest run test/cli/triageFailures.test.ts` (PASS, 1 test), then `npx vitest run` (ALL pass) and `npm run typecheck` (exit 0). Report all. If typecheck errors, report BLOCKED with exact text.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/triageFailures.ts src/cli/index.ts test/cli/triageFailures.test.ts
git commit -m "feat(cli): adapt triage-failures"
```

---

## Self-Review (completed during authoring)

- **Spec coverage (Plan 5):** WorkItem artifact → Task 1; deterministic dedupeKey (scenario+step+actual+error sigs) → Task 2; LocalTracker canonical store + dedup + append → Task 3; Triage agent classification + Jira-via-MCP-when-enabled → Tasks 4–5 (`jiraKey` passthrough); one-item-per-root + maxItemsPerRun cap + no items for non-actionable → Task 5; no re-triage of linked runs → Task 5. Node owns dedup; agent owns judgment + Jira.
- **Type consistency:** `WorkItem`/`WorkItemSchema`, `TriageVerdict` (factory input) ≡ `TriageResult` (agent output) shape, `dedupeKey(run)`, `LocalTracker`, `TriageDeps`/`TriageSummary`. The triage agent's result file is `triage-<runId>.json` (distinct from the work-item file `ITEM-xxx.json`). `runRole`, `mcpServersFor`, `RunLedger`, `RunRecord` reused from Phase 0 / Plan 4 unchanged.
- **Decision recorded:** dedup is deterministic Node logic (not the agent's), refining the spec's wording ("agent dedups") for testability and reliability — the agent supplies classification/severity/title/Jira only. Captured here intentionally.
- **Deferred to Plan 6:** work-item status transitions (created here as `triaged`); the agent only triages `failed` runs by default (blocked/invalid/inconclusive excluded per safeguard).

# Phase 0 · Plan 2 — Orchestrator State Machine & Run Ledger

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deterministic, persistent orchestrator: validated lifecycle transitions for scenarios / runs / work-items, a SQLite-backed state store with idempotency and crash recovery, attempt limits, and an append-only run ledger.

**Architecture:** Pure transition tables (`lifecycles.ts`) checked by a generic validator (`stateMachine.ts`). State persists in a single SQLite database (`<target>/.adapt/state.db`, gitignored) via `better-sqlite3` — synchronous, simple, transactional. Run results are written append-only as JSON files in `scenario-runs/` (the ledger) and indexed in SQLite. The `Orchestrator` facade ties these together and is the only thing Plan 3 / Phase 1 call. No agents, no network — fully testable in isolation with `:memory:` databases.

**Tech Stack:** Builds on Plan 1. Adds `better-sqlite3` + `@types/better-sqlite3`. Continues Node + TS + Vitest + Zod.

**Depends on:** Plan 1 (`src/types.ts` enums, `workspacePaths`).

---

## File Structure

```
src/orchestrator/
  lifecycles.ts        # allowed-transition tables for scenario / run / work-item
  stateMachine.ts      # generic canTransition / assertTransition
  runRecord.ts         # zod RunRecord schema + type (the ledger payload)
  store.ts             # SQLite open/migrate + CRUD (runs, scenario_state, attempts)
  runLedger.ts         # append-only run JSON files + store index row
  orchestrator.ts      # facade: createRun, advanceRun, recordResult, attempts, recover
  ids.ts               # id + clock helpers (injectable for tests)
test/orchestrator/
  lifecycles.test.ts
  stateMachine.test.ts
  runRecord.test.ts
  store.test.ts
  runLedger.test.ts
  orchestrator.test.ts
```

---

## Task 0: Add SQLite dependency

**Files:**
- Modify: `package.json` (dependencies)

- [ ] **Step 1: Install better-sqlite3 and its types**

Run: `npm install better-sqlite3@^11.3.0 && npm install -D @types/better-sqlite3@^7.6.11`
Expected: installs cleanly (better-sqlite3 compiles a native binary; on macOS this needs Xcode CLT — already present).

- [ ] **Step 2: Verify it loads**

Run: `npx tsx -e "import Database from 'better-sqlite3'; const d=new Database(':memory:'); console.log(d.prepare('select 1 as x').get())"`
Expected: prints `{ x: 1 }`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add better-sqlite3 for orchestrator state"
```

---

## Task 1: Lifecycle transition tables

**Files:**
- Create: `src/orchestrator/lifecycles.ts`
- Test: `test/orchestrator/lifecycles.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { RUN_TRANSITIONS, WORK_ITEM_TRANSITIONS, SCENARIO_TRANSITIONS } from "../../src/orchestrator/lifecycles.ts";

describe("lifecycle transition tables", () => {
  it("runs go queued -> running -> failed, and failed -> archived", () => {
    expect(RUN_TRANSITIONS.queued).toContain("running");
    expect(RUN_TRANSITIONS.running).toContain("failed");
    expect(RUN_TRANSITIONS.failed).toContain("archived");
  });

  it("inconclusive runs may retry back to queued", () => {
    expect(RUN_TRANSITIONS.inconclusive).toContain("queued");
  });

  it("work-items support the reopen path", () => {
    expect(WORK_ITEM_TRANSITIONS["ready-for-verification"]).toContain("done");
    expect(WORK_ITEM_TRANSITIONS["ready-for-verification"]).toContain("reopened");
    expect(WORK_ITEM_TRANSITIONS.reopened).toContain("in-progress");
  });

  it("scenarios can pass into the regression pool and fail into item-created", () => {
    expect(SCENARIO_TRANSITIONS.passed).toContain("regression");
    expect(SCENARIO_TRANSITIONS.failed).toContain("item-created");
  });

  it("terminal-ish states exist with no required onward transition", () => {
    expect(RUN_TRANSITIONS.archived).toEqual([]);
    expect(WORK_ITEM_TRANSITIONS.done).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/orchestrator/lifecycles.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { RunStatus, WorkItemStatus, ScenarioStatus } from "../types.ts";

type Transitions<S extends string> = Record<S, S[]>;

// Run lifecycle (blueprint §14)
export const RUN_TRANSITIONS: Transitions<RunStatus> = {
  queued: ["running"],
  running: ["passed", "failed", "blocked", "flaky", "invalid", "inconclusive"],
  passed: ["archived"],
  failed: ["archived"],
  blocked: ["archived"],
  flaky: ["archived", "queued"],
  invalid: ["archived"],
  inconclusive: ["queued", "archived"],
  archived: [],
};

// Work-item lifecycle (blueprint §14)
export const WORK_ITEM_TRANSITIONS: Transitions<WorkItemStatus> = {
  open: ["triaged"],
  triaged: ["in-progress"],
  "in-progress": ["in-review"],
  "in-review": ["ready-for-verification"],
  "ready-for-verification": ["done", "reopened"],
  reopened: ["in-progress"],
  done: [],
};

// Scenario lifecycle (blueprint §14)
export const SCENARIO_TRANSITIONS: Transitions<ScenarioStatus> = {
  draft: ["ready"],
  ready: ["active", "running"],
  active: ["running"],
  running: ["passed", "failed", "blocked", "invalid"],
  passed: ["regression", "ready"],
  regression: ["ready", "running"],
  failed: ["item-created"],
  "item-created": ["awaiting-fix"],
  "awaiting-fix": ["ready-for-verification"],
  "ready-for-verification": ["verified", "failed"],
  verified: ["regression"],
  blocked: ["needs-product-review", "ready"],
  invalid: ["needs-product-review"],
  "needs-product-review": ["ready", "deprecated"],
  deprecated: [],
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/orchestrator/lifecycles.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/lifecycles.ts test/orchestrator/lifecycles.test.ts
git commit -m "feat(orchestrator): lifecycle transition tables"
```

---

## Task 2: Generic state-machine validator

**Files:**
- Create: `src/orchestrator/stateMachine.ts`
- Test: `test/orchestrator/stateMachine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { canTransition, assertTransition, IllegalTransitionError } from "../../src/orchestrator/stateMachine.ts";
import { RUN_TRANSITIONS } from "../../src/orchestrator/lifecycles.ts";

describe("state machine", () => {
  it("allows a legal transition", () => {
    expect(canTransition(RUN_TRANSITIONS, "queued", "running")).toBe(true);
  });

  it("rejects an illegal transition", () => {
    expect(canTransition(RUN_TRANSITIONS, "queued", "passed")).toBe(false);
  });

  it("assertTransition throws IllegalTransitionError with both states named", () => {
    expect(() => assertTransition(RUN_TRANSITIONS, "queued", "passed")).toThrow(IllegalTransitionError);
    expect(() => assertTransition(RUN_TRANSITIONS, "queued", "passed")).toThrow(/queued.*passed/);
  });

  it("treats an unknown from-state as no legal transitions", () => {
    expect(canTransition(RUN_TRANSITIONS, "bogus" as any, "running")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/orchestrator/stateMachine.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
export class IllegalTransitionError extends Error {}

/** True if `to` is a declared successor of `from` in the given table. */
export function canTransition<S extends string>(
  table: Record<S, S[]>,
  from: S,
  to: S,
): boolean {
  const allowed = table[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

/** Throw IllegalTransitionError unless the transition is legal. */
export function assertTransition<S extends string>(
  table: Record<S, S[]>,
  from: S,
  to: S,
): void {
  if (!canTransition(table, from, to)) {
    throw new IllegalTransitionError(`Illegal transition: ${from} -> ${to}`);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/orchestrator/stateMachine.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/stateMachine.ts test/orchestrator/stateMachine.test.ts
git commit -m "feat(orchestrator): generic transition validator"
```

---

## Task 3: Run record schema

**Files:**
- Create: `src/orchestrator/runRecord.ts`
- Test: `test/orchestrator/runRecord.test.ts`

The ledger payload (blueprint §"scenario run result"). The Runner (Phase 1) produces these; we define and validate the shape now.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { RunRecordSchema, newRunRecord } from "../../src/orchestrator/runRecord.ts";

describe("RunRecord", () => {
  it("newRunRecord builds a valid queued record with sensible defaults", () => {
    const r = newRunRecord({
      runId: "RUN-1", scenarioId: "SCN-001", scenarioTitle: "Login",
      appBaseUrl: "http://localhost:3000", startedAt: "2026-05-25T10:00:00.000Z",
    });
    expect(RunRecordSchema.safeParse(r).success).toBe(true);
    expect(r.status).toBe("queued");
    expect(r.consoleErrors).toEqual([]);
    expect(r.finishedAt).toBeNull();
  });

  it("rejects an invalid status", () => {
    const r = { ...newRunRecord({ runId: "RUN-1", scenarioId: "SCN-001", scenarioTitle: "x", appBaseUrl: "http://localhost:3000", startedAt: "2026-05-25T10:00:00.000Z" }), status: "weird" };
    expect(RunRecordSchema.safeParse(r).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/orchestrator/runRecord.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { z } from "zod";
import { RUN_STATUSES } from "../types.ts";

export const RunRecordSchema = z.object({
  runId: z.string(),
  scenarioId: z.string(),
  scenarioTitle: z.string(),
  status: z.enum(RUN_STATUSES),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  appBaseUrl: z.string(),
  appVersion: z.string().nullable(),     // target commit SHA when known
  environment: z.string(),
  stepsExecuted: z.number().int().nonnegative(),
  failureStep: z.number().int().nullable(),
  expectedOutcome: z.string().nullable(),
  actualOutcome: z.string().nullable(),
  consoleErrors: z.array(z.string()),
  networkErrors: z.array(z.string()),
  screenshots: z.array(z.string()),
  artifacts: z.array(z.string()),
  linkedJiraIssue: z.string().nullable(),
  runnerNotes: z.string().nullable(),
});

export type RunRecord = z.infer<typeof RunRecordSchema>;

export function newRunRecord(init: {
  runId: string; scenarioId: string; scenarioTitle: string;
  appBaseUrl: string; startedAt: string; appVersion?: string | null; environment?: string;
}): RunRecord {
  return {
    runId: init.runId,
    scenarioId: init.scenarioId,
    scenarioTitle: init.scenarioTitle,
    status: "queued",
    startedAt: init.startedAt,
    finishedAt: null,
    appBaseUrl: init.appBaseUrl,
    appVersion: init.appVersion ?? null,
    environment: init.environment ?? "local",
    stepsExecuted: 0,
    failureStep: null,
    expectedOutcome: null,
    actualOutcome: null,
    consoleErrors: [],
    networkErrors: [],
    screenshots: [],
    artifacts: [],
    linkedJiraIssue: null,
    runnerNotes: null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/orchestrator/runRecord.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/runRecord.ts test/orchestrator/runRecord.test.ts
git commit -m "feat(orchestrator): RunRecord schema + factory"
```

---

## Task 4: id + clock helpers

**Files:**
- Create: `src/orchestrator/ids.ts`
- Test: `test/orchestrator/ids.test.ts`

Injectable clock + id generator keep the orchestrator deterministic in tests.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { makeRunId, defaultClock } from "../../src/orchestrator/ids.ts";

describe("ids", () => {
  it("makeRunId embeds a compact timestamp and a sequence", () => {
    const id = makeRunId(new Date("2026-05-25T10:15:00.000Z"), 1);
    expect(id).toBe("RUN-20260525T101500-1");
  });

  it("defaultClock returns an ISO string", () => {
    expect(defaultClock()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/orchestrator/ids.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
/** ISO timestamp now. Override in tests for determinism. */
export function defaultClock(): string {
  return new Date().toISOString();
}

/** RUN-YYYYMMDDThhmmss-<seq>. */
export function makeRunId(date: Date, seq: number): string {
  const z = (n: number, w = 2) => String(n).padStart(w, "0");
  const stamp =
    `${date.getUTCFullYear()}${z(date.getUTCMonth() + 1)}${z(date.getUTCDate())}` +
    `T${z(date.getUTCHours())}${z(date.getUTCMinutes())}${z(date.getUTCSeconds())}`;
  return `RUN-${stamp}-${seq}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/orchestrator/ids.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/ids.ts test/orchestrator/ids.test.ts
git commit -m "feat(orchestrator): injectable id + clock helpers"
```

---

## Task 5: SQLite state store

**Files:**
- Create: `src/orchestrator/store.ts`
- Test: `test/orchestrator/store.test.ts`

The store owns persistence. Tables: `runs` (index of run records + status), `scenario_state` (current lifecycle state per scenario), `attempts` (counter per scenario+kind for limits). All writes are synchronous and transactional.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { StateStore } from "../../src/orchestrator/store.ts";

function mem() { return new StateStore(":memory:"); }

describe("StateStore", () => {
  it("creates tables on open (idempotent migrate)", () => {
    const s = mem();
    expect(s.listRuns()).toEqual([]);
    s.close();
  });

  it("upserts and reads a run row", () => {
    const s = mem();
    s.upsertRun({ runId: "RUN-1", scenarioId: "SCN-001", status: "queued", startedAt: "t0", finishedAt: null });
    s.upsertRun({ runId: "RUN-1", scenarioId: "SCN-001", status: "running", startedAt: "t0", finishedAt: null });
    const r = s.getRun("RUN-1");
    expect(r?.status).toBe("running");
    expect(s.listRuns().length).toBe(1);
    s.close();
  });

  it("finds runs by status", () => {
    const s = mem();
    s.upsertRun({ runId: "RUN-1", scenarioId: "SCN-001", status: "running", startedAt: "t0", finishedAt: null });
    s.upsertRun({ runId: "RUN-2", scenarioId: "SCN-002", status: "passed", startedAt: "t0", finishedAt: "t1" });
    expect(s.findRunsByStatus("running").map((r) => r.runId)).toEqual(["RUN-1"]);
    s.close();
  });

  it("tracks scenario state with a default of 'ready'", () => {
    const s = mem();
    expect(s.getScenarioState("SCN-001")).toBe("ready");
    s.setScenarioState("SCN-001", "running");
    expect(s.getScenarioState("SCN-001")).toBe("running");
    s.close();
  });

  it("increments attempt counters per scenario and kind", () => {
    const s = mem();
    expect(s.incrementAttempt("SCN-001", "fix")).toBe(1);
    expect(s.incrementAttempt("SCN-001", "fix")).toBe(2);
    expect(s.incrementAttempt("SCN-001", "verification")).toBe(1);
    expect(s.getAttempts("SCN-001", "fix")).toBe(2);
    s.close();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/orchestrator/store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import Database from "better-sqlite3";
import type { RunStatus, ScenarioStatus } from "../types.ts";

export interface RunRow {
  runId: string;
  scenarioId: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
}

export type AttemptKind = "fix" | "verification";

export class StateStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        runId TEXT PRIMARY KEY,
        scenarioId TEXT NOT NULL,
        status TEXT NOT NULL,
        startedAt TEXT NOT NULL,
        finishedAt TEXT
      );
      CREATE TABLE IF NOT EXISTS scenario_state (
        scenarioId TEXT PRIMARY KEY,
        state TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attempts (
        scenarioId TEXT NOT NULL,
        kind TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (scenarioId, kind)
      );
    `);
  }

  upsertRun(row: RunRow): void {
    this.db.prepare(`
      INSERT INTO runs (runId, scenarioId, status, startedAt, finishedAt)
      VALUES (@runId, @scenarioId, @status, @startedAt, @finishedAt)
      ON CONFLICT(runId) DO UPDATE SET
        status=excluded.status, finishedAt=excluded.finishedAt
    `).run(row);
  }

  getRun(runId: string): RunRow | undefined {
    return this.db.prepare(`SELECT * FROM runs WHERE runId = ?`).get(runId) as RunRow | undefined;
  }

  listRuns(): RunRow[] {
    return this.db.prepare(`SELECT * FROM runs ORDER BY startedAt`).all() as RunRow[];
  }

  findRunsByStatus(status: RunStatus): RunRow[] {
    return this.db.prepare(`SELECT * FROM runs WHERE status = ? ORDER BY startedAt`).all(status) as RunRow[];
  }

  getScenarioState(scenarioId: string): ScenarioStatus {
    const row = this.db.prepare(`SELECT state FROM scenario_state WHERE scenarioId = ?`).get(scenarioId) as
      | { state: ScenarioStatus } | undefined;
    return row?.state ?? "ready";
  }

  setScenarioState(scenarioId: string, state: ScenarioStatus): void {
    this.db.prepare(`
      INSERT INTO scenario_state (scenarioId, state) VALUES (?, ?)
      ON CONFLICT(scenarioId) DO UPDATE SET state = excluded.state
    `).run(scenarioId, state);
  }

  incrementAttempt(scenarioId: string, kind: AttemptKind): number {
    this.db.prepare(`
      INSERT INTO attempts (scenarioId, kind, count) VALUES (?, ?, 1)
      ON CONFLICT(scenarioId, kind) DO UPDATE SET count = count + 1
    `).run(scenarioId, kind);
    return this.getAttempts(scenarioId, kind);
  }

  getAttempts(scenarioId: string, kind: AttemptKind): number {
    const row = this.db.prepare(`SELECT count FROM attempts WHERE scenarioId = ? AND kind = ?`)
      .get(scenarioId, kind) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/orchestrator/store.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/store.ts test/orchestrator/store.test.ts
git commit -m "feat(orchestrator): SQLite state store (runs, scenario state, attempts)"
```

---

## Task 6: Run ledger

**Files:**
- Create: `src/orchestrator/runLedger.ts`
- Test: `test/orchestrator/runLedger.test.ts`

Append-only: each run is one JSON file in `scenario-runs/`. The ledger validates against `RunRecordSchema` before writing and indexes the row in the store.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { RunLedger } from "../../src/orchestrator/runLedger.ts";
import { StateStore } from "../../src/orchestrator/store.ts";
import { newRunRecord } from "../../src/orchestrator/runRecord.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function setup() {
  dir = makeTmpDir();
  const store = new StateStore(":memory:");
  const ledger = new RunLedger(dir, store);
  return { dir: dir!, store, ledger };
}

describe("RunLedger", () => {
  it("writes a run record file and indexes it in the store", () => {
    const { dir, store, ledger } = setup();
    const rec = newRunRecord({ runId: "RUN-1", scenarioId: "SCN-001", scenarioTitle: "Login", appBaseUrl: "http://x", startedAt: "t0" });
    ledger.write(rec);
    expect(existsSync(join(dir, ".adapt", "scenario-runs", "RUN-1.json"))).toBe(true);
    expect(store.getRun("RUN-1")?.scenarioId).toBe("SCN-001");
  });

  it("reads back a written record", () => {
    const { ledger } = setup();
    const rec = newRunRecord({ runId: "RUN-2", scenarioId: "SCN-002", scenarioTitle: "X", appBaseUrl: "http://x", startedAt: "t0" });
    ledger.write({ ...rec, status: "passed", finishedAt: "t1" });
    const back = ledger.read("RUN-2");
    expect(back.status).toBe("passed");
  });

  it("rejects an invalid record", () => {
    const { ledger } = setup();
    expect(() => ledger.write({ runId: "RUN-3" } as any)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/orchestrator/runLedger.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { workspacePaths } from "../workspace/paths.ts";
import { RunRecordSchema, type RunRecord } from "./runRecord.ts";
import type { StateStore } from "./store.ts";

export class RunLedger {
  private runsDir: string;

  constructor(targetRepo: string, private store: StateStore) {
    this.runsDir = workspacePaths(targetRepo).runsDir;
    if (!existsSync(this.runsDir)) mkdirSync(this.runsDir, { recursive: true });
  }

  /** Validate, persist to disk (append-only), and index in the store. */
  write(record: RunRecord): void {
    const parsed = RunRecordSchema.parse(record);
    writeFileSync(join(this.runsDir, `${parsed.runId}.json`), JSON.stringify(parsed, null, 2) + "\n", "utf8");
    this.store.upsertRun({
      runId: parsed.runId, scenarioId: parsed.scenarioId,
      status: parsed.status, startedAt: parsed.startedAt, finishedAt: parsed.finishedAt,
    });
  }

  read(runId: string): RunRecord {
    const path = join(this.runsDir, `${runId}.json`);
    return RunRecordSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/orchestrator/runLedger.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/runLedger.ts test/orchestrator/runLedger.test.ts
git commit -m "feat(orchestrator): append-only run ledger backed by store"
```

---

## Task 7: Orchestrator facade

**Files:**
- Create: `src/orchestrator/orchestrator.ts`
- Test: `test/orchestrator/orchestrator.test.ts`

Ties the pieces together. Validates every state change, enforces attempt limits, emits events via an injected callback (Plan 3 wires the console + decision log to this), and recovers runs left `running` by a crashed process.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { existsSync } from "node:fs";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { Orchestrator } from "../../src/orchestrator/orchestrator.ts";
import { StateStore } from "../../src/orchestrator/store.ts";
import { IllegalTransitionError } from "../../src/orchestrator/stateMachine.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function make(events: any[] = []) {
  dir = makeTmpDir();
  const store = new StateStore(":memory:");
  const orch = new Orchestrator({
    targetRepo: dir!, store, appBaseUrl: "http://localhost:3000",
    limits: { maxFixAttempts: 2, maxVerificationAttempts: 3, maxItemsPerRun: 10, maxCycleSeconds: 3600 },
    clock: () => "2026-05-25T10:15:00.000Z",
    now: () => new Date("2026-05-25T10:15:00.000Z"),
    emit: (e) => events.push(e),
  });
  return { orch, store, events, dir: dir! };
}

describe("Orchestrator", () => {
  it("createRun produces a queued run + emits an event", () => {
    const events: any[] = [];
    const { orch } = make(events);
    const run = orch.createRun("SCN-001", "Login");
    expect(run.runId).toBe("RUN-20260525T101500-1");
    expect(run.status).toBe("queued");
    expect(events.some((e) => e.type === "run.created")).toBe(true);
  });

  it("advanceRun validates transitions and persists", () => {
    const { orch, store } = make();
    const run = orch.createRun("SCN-001", "Login");
    orch.advanceRun(run.runId, "running");
    expect(store.getRun(run.runId)?.status).toBe("running");
  });

  it("advanceRun rejects an illegal transition", () => {
    const { orch } = make();
    const run = orch.createRun("SCN-001", "Login");
    expect(() => orch.advanceRun(run.runId, "passed")).toThrow(IllegalTransitionError);
  });

  it("recordResult finalizes the run and writes the ledger file", () => {
    const { orch, dir } = make();
    const run = orch.createRun("SCN-001", "Login");
    orch.advanceRun(run.runId, "running");
    const rec = orch.recordResult(run.runId, { status: "failed", actualOutcome: "blank page", failureStep: 3 });
    expect(rec.status).toBe("failed");
    expect(rec.finishedAt).toBe("2026-05-25T10:15:00.000Z");
    expect(existsSync(`${dir}/.adapt/scenario-runs/${run.runId}.json`)).toBe(true);
  });

  it("enforces fix attempt limits", () => {
    const { orch } = make();
    expect(orch.canAttempt("SCN-001", "fix")).toBe(true);
    orch.recordAttempt("SCN-001", "fix"); // 1
    orch.recordAttempt("SCN-001", "fix"); // 2 (== limit)
    expect(orch.canAttempt("SCN-001", "fix")).toBe(false);
  });

  it("recovers runs stranded in 'running' as inconclusive", () => {
    const { orch, store } = make();
    const run = orch.createRun("SCN-001", "Login");
    orch.advanceRun(run.runId, "running");
    const recovered = orch.recoverIncomplete();
    expect(recovered).toEqual([run.runId]);
    expect(store.getRun(run.runId)?.status).toBe("inconclusive");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/orchestrator/orchestrator.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { assertTransition } from "./stateMachine.ts";
import { RUN_TRANSITIONS } from "./lifecycles.ts";
import { newRunRecord, type RunRecord } from "./runRecord.ts";
import { RunLedger } from "./runLedger.ts";
import { makeRunId } from "./ids.ts";
import { StateStore, type AttemptKind } from "./store.ts";
import type { RunStatus } from "../types.ts";

export interface OrchestratorLimits {
  maxFixAttempts: number;
  maxVerificationAttempts: number;
  maxItemsPerRun: number;
  maxCycleSeconds: number;
}

export interface OrchestratorEvent {
  type: string;
  at: string;
  [k: string]: unknown;
}

export interface OrchestratorOptions {
  targetRepo: string;
  store: StateStore;
  appBaseUrl: string;
  limits: OrchestratorLimits;
  clock?: () => string;
  now?: () => Date;
  emit?: (e: OrchestratorEvent) => void;
}

export class Orchestrator {
  private store: StateStore;
  private ledger: RunLedger;
  private appBaseUrl: string;
  private limits: OrchestratorLimits;
  private clock: () => string;
  private now: () => Date;
  private emitFn: (e: OrchestratorEvent) => void;
  private seq = 0;
  private records = new Map<string, RunRecord>();

  constructor(opts: OrchestratorOptions) {
    this.store = opts.store;
    this.ledger = new RunLedger(opts.targetRepo, opts.store);
    this.appBaseUrl = opts.appBaseUrl;
    this.limits = opts.limits;
    this.clock = opts.clock ?? (() => new Date().toISOString());
    this.now = opts.now ?? (() => new Date());
    this.emitFn = opts.emit ?? (() => {});
  }

  private emit(type: string, extra: Record<string, unknown> = {}): void {
    this.emitFn({ type, at: this.clock(), ...extra });
  }

  createRun(scenarioId: string, scenarioTitle: string): RunRecord {
    const runId = makeRunId(this.now(), ++this.seq);
    const rec = newRunRecord({ runId, scenarioId, scenarioTitle, appBaseUrl: this.appBaseUrl, startedAt: this.clock() });
    this.records.set(runId, rec);
    this.ledger.write(rec);
    this.emit("run.created", { runId, scenarioId });
    return rec;
  }

  advanceRun(runId: string, to: RunStatus): RunRecord {
    const rec = this.requireRecord(runId);
    assertTransition(RUN_TRANSITIONS, rec.status, to);
    const next = { ...rec, status: to };
    this.records.set(runId, next);
    this.ledger.write(next);
    this.emit("run.transition", { runId, from: rec.status, to });
    return next;
  }

  recordResult(runId: string, result: Partial<RunRecord> & { status: RunStatus }): RunRecord {
    const rec = this.requireRecord(runId);
    assertTransition(RUN_TRANSITIONS, rec.status, result.status);
    const next: RunRecord = { ...rec, ...result, finishedAt: this.clock() };
    this.records.set(runId, next);
    this.ledger.write(next);
    this.emit("run.result", { runId, status: next.status });
    return next;
  }

  canAttempt(scenarioId: string, kind: AttemptKind): boolean {
    const limit = kind === "fix" ? this.limits.maxFixAttempts : this.limits.maxVerificationAttempts;
    return this.store.getAttempts(scenarioId, kind) < limit;
  }

  recordAttempt(scenarioId: string, kind: AttemptKind): number {
    const n = this.store.incrementAttempt(scenarioId, kind);
    this.emit("attempt.recorded", { scenarioId, kind, count: n });
    return n;
  }

  /** Runs left in 'running' by a crashed process become 'inconclusive'. Returns recovered run ids. */
  recoverIncomplete(): string[] {
    const stranded = this.store.findRunsByStatus("running");
    const ids: string[] = [];
    for (const row of stranded) {
      this.store.upsertRun({ ...row, status: "inconclusive", finishedAt: this.clock() });
      this.emit("run.recovered", { runId: row.runId });
      ids.push(row.runId);
    }
    return ids;
  }

  private requireRecord(runId: string): RunRecord {
    const rec = this.records.get(runId);
    if (!rec) throw new Error(`Unknown run ${runId}`);
    return rec;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/orchestrator/orchestrator.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Full-suite + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all PASS; `tsc --noEmit` clean.

- [ ] **Step 6: Commit**

```bash
git add src/orchestrator/orchestrator.ts test/orchestrator/orchestrator.test.ts
git commit -m "feat(orchestrator): facade with transitions, limits, crash recovery"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** deterministic state machine (§12) → Tasks 1–2; scenario/run/work-item lifecycles (§14) → Task 1; SQLite persistence + idempotency + crash recovery (§12) → Tasks 5, 7 (`recoverIncomplete`); attempt limits (§14) → Tasks 5, 7 (`canAttempt`); append-only run ledger, never mutate scenario files (§10) → Task 6; run-result fields (§"scenario run result") → Task 3. Event emission via `emit` is the seam Plan 3 connects to the console + decision log.
- **Type consistency:** `RunStatus`/`ScenarioStatus`/`WorkItemStatus` come from `src/types.ts` (Plan 1). `RunRecord` (Task 3) is the single ledger payload type; `RunRow` (Task 5) is its store-index projection. `Orchestrator` exports `OrchestratorEvent`, `OrchestratorLimits`, `OrchestratorOptions` for Plan 3.
- **Note for executor:** add `/.adapt/state.db*` to the *target repo's* `.gitignore` when first plugging in (WAL creates `-wal`/`-shm` files). The adapt repo never contains a `state.db`.
- **Out of scope (deferred):** work-item rows/Jira sync (Phase 1 Plan 5 — the work-item lifecycle table is defined now but not yet driven); agent invocation + events fan-out (Plan 3).

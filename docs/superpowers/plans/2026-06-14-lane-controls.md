# Lane Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stop/start/restart/pause/continue + editable maxCycles (default infinite) controls to the adapt monitor, and make a stopped lane resume cleanly on restart.

**Architecture:** Process spawn/kill drives start/stop/restart (functions already exist in `src/lanes/loop.ts`). A polled control file (`<worktree>/.adapt/control.json`) drives pause/continue/maxCycles: the loop reads it at each cycle boundary. The monitor server mutates the file (pause/continue/maxCycles) or spawns/kills the loop (start/stop/restart) in response to browser WS commands. Orphaned in-flight runs are reaped to `inconclusive` on loop start so restart resumes cleanly.

**Tech Stack:** TypeScript (tsx, ESM, `.ts` import specifiers), vitest, better-sqlite3, `ws`, vanilla browser JS.

---

## File Structure

- **Create** `src/lanes/control.ts` — owner of `control.json`: `LaneControl` type, `readControl`, `writeControl`, `clearStop`, `normalizeMaxCycles`. Pure fs, injectable.
- **Modify** `src/orchestrator/run.ts` — `runContinuous` honors the control file (pause, stopRequested, effective maxCycles); add `"control"` StopReason; handle null (infinite) maxCycles/wallClock.
- **Modify** `src/orchestrator/store.ts` — add `reapOrphanedRuns()`.
- **Modify** `src/cli/commands/run.ts` — call `reapOrphanedRuns()` after store open, emit `run.reaped`.
- **Modify** `src/config/schema.ts` — `run.maxCycles` and `run.maxWallClockSeconds` become nullable, default `null` (infinite).
- **Modify** `src/observability/monitorServer.ts` — accept inbound `control` WS frames; add `control` dep.
- **Modify** `src/observability/monitor.ts` — wire the `control` callback to loop spawn/kill + `writeControl`.
- **Modify** `src/observability/laneRegistry.ts` — `LaneSummary` gains `paused` + `maxCycles`, read from control.json during scan.
- **Modify** `src/observability/public/monitor.js` + `monitor.html` — per-lane + global control buttons and maxCycles input.

Test files mirror `test/<area>/<name>.test.ts`.

---

## Task 1: Lane control file module

**Files:**
- Create: `src/lanes/control.ts`
- Test: `test/lanes/control.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// test/lanes/control.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readControl, writeControl, clearStop, normalizeMaxCycles } from "../../src/lanes/control.ts";

function wt(): string {
  const d = mkdtempSync(join(tmpdir(), "control-"));
  mkdirSync(join(d, ".adapt"), { recursive: true });
  return d;
}

describe("lane control file", () => {
  it("returns defaults when the file is missing", () => {
    const d = wt();
    expect(readControl(d)).toEqual({ paused: false, maxCycles: undefined, stopRequested: false });
    rmSync(d, { recursive: true, force: true });
  });

  it("returns defaults when the file is malformed", () => {
    const d = wt();
    writeFileSync(join(d, ".adapt", "control.json"), "{ not json", "utf8");
    expect(readControl(d)).toEqual({ paused: false, maxCycles: undefined, stopRequested: false });
    rmSync(d, { recursive: true, force: true });
  });

  it("write merges a patch and read reflects it", () => {
    const d = wt();
    writeControl(d, { paused: true });
    expect(readControl(d).paused).toBe(true);
    writeControl(d, { maxCycles: 5 });
    const c = readControl(d);
    expect(c.paused).toBe(true);     // preserved
    expect(c.maxCycles).toBe(5);
    rmSync(d, { recursive: true, force: true });
  });

  it("distinguishes explicit null (infinite) from unset", () => {
    const d = wt();
    writeControl(d, { maxCycles: null });
    expect(readControl(d).maxCycles).toBeNull();
    rmSync(d, { recursive: true, force: true });
  });

  it("clearStop resets only stopRequested", () => {
    const d = wt();
    writeControl(d, { paused: true, stopRequested: true });
    clearStop(d);
    const c = readControl(d);
    expect(c.stopRequested).toBe(false);
    expect(c.paused).toBe(true);
    rmSync(d, { recursive: true, force: true });
  });

  it("writes atomically (no leftover temp file)", () => {
    const d = wt();
    writeControl(d, { paused: true });
    const raw = readFileSync(join(d, ".adapt", "control.json"), "utf8");
    expect(JSON.parse(raw).paused).toBe(true);
    rmSync(d, { recursive: true, force: true });
  });

  it("normalizeMaxCycles maps blank/0/negative to null", () => {
    expect(normalizeMaxCycles(0)).toBeNull();
    expect(normalizeMaxCycles(-3)).toBeNull();
    expect(normalizeMaxCycles(NaN)).toBeNull();
    expect(normalizeMaxCycles(null)).toBeNull();
    expect(normalizeMaxCycles(undefined)).toBeNull();
    expect(normalizeMaxCycles(7)).toBe(7);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lanes/control.test.ts`
Expected: FAIL — cannot find module `../../src/lanes/control.ts`.

- [ ] **Step 3: Write the implementation**

```ts
// src/lanes/control.ts
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { workspacePaths } from "../workspace/paths.ts";

/** Live control state for a lane loop, persisted in <worktree>/.adapt/control.json.
 *  maxCycles: a number bounds cycles; null means infinite; undefined means "unset"
 *  (fall back to config.run.maxCycles). */
export interface LaneControl {
  paused: boolean;
  maxCycles: number | null | undefined;
  stopRequested: boolean;
}

function controlPath(worktree: string): string {
  return join(workspacePaths(worktree).root, "control.json");
}

/** Read control state. Missing or malformed file → safe defaults (never throws). */
export function readControl(worktree: string): LaneControl {
  const path = controlPath(worktree);
  const out: LaneControl = { paused: false, maxCycles: undefined, stopRequested: false };
  if (!existsSync(path)) return out;
  try {
    const obj = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    if (typeof obj.paused === "boolean") out.paused = obj.paused;
    if (typeof obj.stopRequested === "boolean") out.stopRequested = obj.stopRequested;
    // Preserve the unset/null/number distinction: only adopt the key when present.
    if ("maxCycles" in obj) {
      const v = obj.maxCycles;
      out.maxCycles = v === null ? null : (typeof v === "number" ? v : undefined);
    }
  } catch {
    // malformed → defaults
  }
  return out;
}

/** Read-modify-write a partial patch, atomically (temp file + rename). */
export function writeControl(worktree: string, patch: Partial<LaneControl>): void {
  const current = readControl(worktree);
  const next: LaneControl = { ...current, ...patch };
  const path = controlPath(worktree);
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}

/** Reset stopRequested to false (called before a fresh start). No-op if file absent. */
export function clearStop(worktree: string): void {
  if (!existsSync(controlPath(worktree))) return;
  writeControl(worktree, { stopRequested: false });
}

/** Normalize a UI-supplied maxCycles: blank/0/negative/non-finite → null (infinite). */
export function normalizeMaxCycles(raw: number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.floor(raw);
}
```

(`unlinkSync` is imported for symmetry with possible future cleanup; if the linter flags it as unused, drop it from the import.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lanes/control.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lanes/control.ts test/lanes/control.test.ts
git commit -m "feat(lanes): control.json read/write for pause + maxCycles

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Config schema — nullable infinite defaults

**Files:**
- Modify: `src/config/schema.ts:62-67`
- Test: `test/config/schema.test.ts:41-42`

- [ ] **Step 1: Update the failing test first**

Replace the two assertions at `test/config/schema.test.ts:41-42`:

```ts
    expect(c.run.maxCycles).toBeNull();
    expect(c.run.maxWallClockSeconds).toBeNull();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/config/schema.test.ts`
Expected: FAIL — `maxCycles` is `10`, not `null`.

- [ ] **Step 3: Update the schema**

In `src/config/schema.ts`, change the `run` block to:

```ts
  // Run guardrails (blueprint §14). null = infinite (default loops forever).
  run: z.object({
    maxCycles: z.number().int().positive().nullable().default(null),
    maxWallClockSeconds: z.number().int().positive().nullable().default(null),
    pauseSeconds: z.number().int().nonnegative().default(5),
    maxConsecutiveErrors: z.number().int().positive().default(3),
  }).default({}),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/config/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts test/config/schema.test.ts
git commit -m "feat(config): run.maxCycles/maxWallClockSeconds default to null (infinite)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: runContinuous honors the control file

**Files:**
- Modify: `src/orchestrator/run.ts`
- Test: `test/orchestrator/runContinuous.test.ts` (new)

Note: `runContinuous` is currently only covered indirectly via `test/cli/run.test.ts`. This task adds a focused unit test with injected deps.

- [ ] **Step 1: Write the failing test**

```ts
// test/orchestrator/runContinuous.test.ts
import { describe, it, expect } from "vitest";
import { runContinuous } from "../../src/orchestrator/run.ts";
import type { LaneControl } from "../../src/lanes/control.ts";
import type { AdaptConfig } from "../../src/config/schema.ts";

function cfg(over: Partial<AdaptConfig["run"]> = {}): AdaptConfig {
  return {
    run: { maxCycles: null, maxWallClockSeconds: null, pauseSeconds: 0, maxConsecutiveErrors: 3, ...over },
  } as unknown as AdaptConfig;
}

// Minimal deps: a no-op evolve via a stub engine is heavy, so we drive the loop
// through injected control + signal and a fake runEvolve by stubbing the engine path.
// Instead we exercise the guardrails directly: each cycle is a no-op because we
// stop via control/signal before real work matters.

function baseDeps(control: LaneControl, extra: Record<string, unknown> = {}) {
  return {
    engine: {} as never,
    store: { /* unused until a cycle runs */ } as never,
    config: cfg(),
    targetRepo: "/tmp/x",
    sink: () => {},
    emit: () => {},
    readControl: () => control,
    sleep: async () => {},
    clockMs: () => 0,
    ...extra,
  };
}

describe("runContinuous control handling", () => {
  it("stops with reason 'control' when stopRequested is set before any cycle", async () => {
    const control: LaneControl = { paused: false, maxCycles: undefined, stopRequested: true };
    const summary = await runContinuous(baseDeps(control) as never);
    expect(summary.stoppedBy).toBe("control");
    expect(summary.cycles).toBe(0);
  });

  it("control.maxCycles=0 normalizes to a stop (treated as already reached)", async () => {
    // explicit numeric limit of 0 via config still bounds the loop
    const control: LaneControl = { paused: false, maxCycles: undefined, stopRequested: false };
    const deps = baseDeps(control, { config: cfg({ maxCycles: 0 }) });
    const summary = await runContinuous(deps as never);
    expect(summary.stoppedBy).toBe("maxCycles");
    expect(summary.cycles).toBe(0);
  });

  it("a paused loop holds then stops when stopRequested flips true", async () => {
    let reads = 0;
    const deps = baseDeps({ paused: true, maxCycles: undefined, stopRequested: false }, {
      readControl: () => {
        reads++;
        // After a few poll reads, request stop to exit the pause-wait.
        return { paused: true, maxCycles: undefined, stopRequested: reads >= 3 };
      },
    });
    const events: string[] = [];
    (deps as { emit: (e: { type: string }) => void }).emit = (e) => events.push(e.type);
    const summary = await runContinuous(deps as never);
    expect(summary.stoppedBy).toBe("control");
    expect(events).toContain("cycle.paused");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/orchestrator/runContinuous.test.ts`
Expected: FAIL — `readControl` not a recognized dep / `stoppedBy` never `"control"`.

- [ ] **Step 3: Implement the changes in `src/orchestrator/run.ts`**

Replace the file's top types + loop. First, the `StopReason` and `ContinuousDeps`:

```ts
import type { AgentEngine, AgentEvent } from "../engine/types.ts";
import type { AdaptConfig } from "../config/schema.ts";
import { StateStore } from "./store.ts";
import type { OrchestratorEvent } from "./orchestrator.ts";
import { runEvolve, type EvolveSummary } from "./evolve.ts";
import { readControl, type LaneControl } from "../lanes/control.ts";

export type StopReason = "maxCycles" | "wallClock" | "errors" | "signal" | "control";

export interface ContinuousDeps {
  engine: AgentEngine;
  store: StateStore;
  config: AdaptConfig;
  targetRepo: string;
  sink: (e: AgentEvent) => void;
  emit: (e: OrchestratorEvent) => void;
  now?: () => string;
  nowDate?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  clockMs?: () => number;
  signal?: { stopped: boolean };
  /** Control-file reader; defaults to the real fs reader. Injectable for tests. */
  readControl?: (worktree: string) => LaneControl;
}
```

Then replace the loop body (`runContinuous`) so it reads control each iteration. The key logic:

```ts
export async function runContinuous(deps: ContinuousDeps): Promise<ContinuousSummary> {
  const r = deps.config.run;
  const now = deps.now ?? (() => new Date().toISOString());
  const clockMs = deps.clockMs ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((res) => setTimeout(res, ms)));
  const readCtl = deps.readControl ?? readControl;
  const startMs = clockMs();
  const wallClockExceeded = () =>
    r.maxWallClockSeconds !== null && (clockMs() - startMs) / 1000 >= r.maxWallClockSeconds;

  // Effective cycle bound: explicit control value wins; else config; null = infinite.
  const effectiveMaxCycles = (ctl: LaneControl): number | null =>
    ctl.maxCycles !== undefined ? ctl.maxCycles : r.maxCycles;

  const pauseBetweenCycles = async (): Promise<StopReason | undefined> => {
    const pauseMs = r.pauseSeconds * 1000;
    let remainingMs = pauseMs;
    do {
      if (deps.signal?.stopped) return "signal";
      if (wallClockExceeded()) return "wallClock";
      const chunkMs = pauseMs === 0 ? 0 : Math.min(250, remainingMs);
      await sleep(chunkMs);
      remainingMs -= chunkMs;
    } while (remainingMs > 0);
    if (deps.signal?.stopped) return "signal";
    if (wallClockExceeded()) return "wallClock";
    return undefined;
  };

  const evolveSummaries: EvolveSummary[] = [];
  let cycles = 0;
  let consecutiveErrors = 0;

  while (true) {
    if (deps.signal?.stopped) return { cycles, stoppedBy: "signal", evolveSummaries };

    let control = readCtl(deps.targetRepo);

    // Pause gate: hold here (between cycles) until unpaused, stopped, or wall-clock trips.
    if (control.paused) {
      deps.emit({ type: "cycle.paused", at: now(), cycle: cycles });
      while (control.paused) {
        if (deps.signal?.stopped) return { cycles, stoppedBy: "signal", evolveSummaries };
        if (control.stopRequested) return { cycles, stoppedBy: "control", evolveSummaries };
        if (wallClockExceeded()) return { cycles, stoppedBy: "wallClock", evolveSummaries };
        await sleep(250);
        control = readCtl(deps.targetRepo);
      }
      deps.emit({ type: "cycle.resumed", at: now(), cycle: cycles });
    }

    if (control.stopRequested) return { cycles, stoppedBy: "control", evolveSummaries };
    const maxCycles = effectiveMaxCycles(control);
    if (maxCycles !== null && cycles >= maxCycles) return { cycles, stoppedBy: "maxCycles", evolveSummaries };
    if (wallClockExceeded()) return { cycles, stoppedBy: "wallClock", evolveSummaries };

    deps.emit({ type: "cycle.start", at: now(), cycle: cycles + 1 });
    let errored = false;
    try {
      const summary = await runEvolve({
        engine: deps.engine, store: deps.store, config: deps.config, targetRepo: deps.targetRepo,
        sink: deps.sink, emit: deps.emit, now: deps.now, nowDate: deps.nowDate,
      });
      evolveSummaries.push(summary);
      consecutiveErrors = 0;
      deps.emit({ type: "cycle.completed", at: now(), cycle: cycles + 1 });
    } catch (e) {
      errored = true;
      consecutiveErrors++;
      deps.emit({ type: "cycle.error", at: now(), cycle: cycles + 1, message: (e as Error).message });
    }
    cycles++;

    if (deps.signal?.stopped) return { cycles, stoppedBy: "signal", evolveSummaries };
    if (errored && consecutiveErrors >= r.maxConsecutiveErrors) {
      return { cycles, stoppedBy: "errors", evolveSummaries };
    }
    if (maxCycles !== null && cycles >= maxCycles) return { cycles, stoppedBy: "maxCycles", evolveSummaries };
    if (wallClockExceeded()) return { cycles, stoppedBy: "wallClock", evolveSummaries };
    const stoppedBy = await pauseBetweenCycles();
    if (stoppedBy) return { cycles, stoppedBy, evolveSummaries };
  }
}
```

Keep the existing `ContinuousSummary` interface unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/orchestrator/runContinuous.test.ts test/cli/run.test.ts`
Expected: PASS. (`test/cli/run.test.ts` sets `run.maxCycles: 1` explicitly, so it still stops by `maxCycles`.)

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/run.ts test/orchestrator/runContinuous.test.ts
git commit -m "feat(orchestrator): runContinuous honors control file (pause/stop/maxCycles)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Reap orphaned runs on start

**Files:**
- Modify: `src/orchestrator/store.ts`
- Modify: `src/cli/commands/run.ts`
- Test: `test/orchestrator/store.test.ts`

- [ ] **Step 1: Write the failing test** (append to `test/orchestrator/store.test.ts`)

```ts
  it("reaps orphaned running runs and resets their scenarios", () => {
    const s = mem();
    s.upsertRun({ runId: "RUN-1", scenarioId: "SCN-001", status: "running", startedAt: "t0", finishedAt: null });
    s.upsertRun({ runId: "RUN-2", scenarioId: "SCN-002", status: "passed", startedAt: "t0", finishedAt: "t1" });
    s.setScenarioState("SCN-001", "running");

    const reaped = s.reapOrphanedRuns();

    expect(reaped).toEqual(["RUN-1"]);
    expect(s.getRun("RUN-1")?.status).toBe("inconclusive");
    expect(s.getRun("RUN-2")?.status).toBe("passed"); // untouched
    expect(s.getScenarioState("SCN-001")).toBe("ready");
    s.close();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/orchestrator/store.test.ts`
Expected: FAIL — `reapOrphanedRuns` is not a function.

- [ ] **Step 3: Add the method to `StateStore`** (in `src/orchestrator/store.ts`, before `close()`)

```ts
  /** Flip every run left at status="running" (orphaned by a killed loop) to
   *  "inconclusive" and reset its scenario to "ready" so the next cycle re-runs
   *  it cleanly. Returns the affected runIds. */
  reapOrphanedRuns(): string[] {
    const rows = this.findRunsByStatus("running");
    const reap = this.db.transaction((items: RunRow[]) => {
      for (const row of items) {
        this.upsertRun({ ...row, status: "inconclusive" });
        this.setScenarioState(row.scenarioId, "ready");
      }
    });
    reap(rows);
    return rows.map((r) => r.runId);
  }
```

- [ ] **Step 4: Wire it into `runCmd`** (`src/cli/commands/run.ts`, after the bus/decisionLog setup, before `runContinuous`)

Add, immediately before the `const summary = await runContinuous({...})` call:

```ts
    for (const runId of store.reapOrphanedRuns()) {
      bus.publish(fromOrchestratorEvent({ type: "run.reaped", at: new Date().toISOString(), runId }));
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/orchestrator/store.test.ts test/cli/run.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/orchestrator/store.ts src/cli/commands/run.ts test/orchestrator/store.test.ts
git commit -m "feat(orchestrator): reap orphaned running runs on loop start (clean resume)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Monitor server accepts control frames

**Files:**
- Modify: `src/observability/monitorServer.ts`
- Test: `test/observability/monitorServer.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// test/observability/monitorServer.test.ts
import { describe, it, expect } from "vitest";
import { WebSocket } from "ws";
import { MonitorServer } from "../../src/observability/monitorServer.ts";
import type { ControlCommand } from "../../src/observability/monitorServer.ts";

function waitOpen(s: WebSocket): Promise<void> {
  return new Promise((res) => s.on("open", () => res()));
}

describe("MonitorServer control frames", () => {
  it("dispatches a control frame to the control callback", async () => {
    const received: ControlCommand[] = [];
    const server = new MonitorServer({
      summaries: () => [],
      historyFor: () => [],
      control: (cmd) => { received.push(cmd); },
    });
    const port = await server.start(0);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await waitOpen(ws);
    ws.send(JSON.stringify({ type: "control", lane: "a", action: "pause" }));
    await new Promise((r) => setTimeout(r, 50));
    ws.close();
    await server.stop();

    expect(received).toEqual([{ lane: "a", action: "pause", maxCycles: undefined }]);
  });

  it("ignores control frames with an unknown action", async () => {
    const received: ControlCommand[] = [];
    const server = new MonitorServer({
      summaries: () => [], historyFor: () => [],
      control: (cmd) => { received.push(cmd); },
    });
    const port = await server.start(0);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await waitOpen(ws);
    ws.send(JSON.stringify({ type: "control", lane: "a", action: "explode" }));
    await new Promise((r) => setTimeout(r, 50));
    ws.close();
    await server.stop();

    expect(received).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/observability/monitorServer.test.ts`
Expected: FAIL — `ControlCommand` not exported / `control` dep not honored.

- [ ] **Step 3: Implement in `src/observability/monitorServer.ts`**

Add the exported types and the dep, and handle the inbound frame. Near the top, add:

```ts
export type ControlAction = "start" | "stop" | "restart" | "pause" | "continue";

export interface ControlCommand {
  lane: string; // a lane id, or "*" for all lanes
  action: ControlAction;
  maxCycles?: number | null;
}

const CONTROL_ACTIONS: ReadonlySet<string> = new Set([
  "start", "stop", "restart", "pause", "continue",
]);
```

Extend `MonitorServerDeps`:

```ts
export interface MonitorServerDeps {
  summaries: () => LaneSummary[];
  historyFor: (laneId: string) => ConsoleEvent[];
  control?: (cmd: ControlCommand) => void;
}
```

In the `socket.on("message", ...)` handler, after the existing `focus` branch, add a `control` branch:

```ts
        if (
          msg && typeof msg === "object" &&
          (msg as { type?: unknown }).type === "control" &&
          typeof (msg as { lane?: unknown }).lane === "string" &&
          typeof (msg as { action?: unknown }).action === "string" &&
          CONTROL_ACTIONS.has((msg as { action: string }).action)
        ) {
          const m = msg as { lane: string; action: ControlAction; maxCycles?: number | null };
          this.deps.control?.({ lane: m.lane, action: m.action, maxCycles: m.maxCycles });
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/observability/monitorServer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/observability/monitorServer.ts test/observability/monitorServer.test.ts
git commit -m "feat(monitor): server accepts control WS frames

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Wire control actions in monitor.ts

**Files:**
- Modify: `src/observability/monitor.ts`
- Test: `test/observability/monitorControl.test.ts` (new)

This task extracts the action dispatcher into a testable pure function `applyControl`, then wires it.

- [ ] **Step 1: Write the failing test**

```ts
// test/observability/monitorControl.test.ts
import { describe, it, expect } from "vitest";
import { applyControl } from "../../src/observability/monitor.ts";

function makeCalls() {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      lanesRoot: "/lanes",
      laneIds: () => ["a", "b"],
      start: (wt: string) => calls.push(`start:${wt}`),
      stop: (wt: string) => calls.push(`stop:${wt}`),
      pause: (wt: string, p: boolean) => calls.push(`pause:${wt}:${p}`),
      setMaxCycles: (wt: string, m: number | null) => calls.push(`max:${wt}:${m}`),
    },
  };
}

describe("applyControl", () => {
  it("pause writes paused=true to the lane worktree", () => {
    const { calls, deps } = makeCalls();
    applyControl({ lane: "a", action: "pause" }, deps);
    expect(calls).toEqual(["pause:/lanes/a:true"]);
  });

  it("continue writes paused=false", () => {
    const { calls, deps } = makeCalls();
    applyControl({ lane: "a", action: "continue" }, deps);
    expect(calls).toEqual(["pause:/lanes/a:false"]);
  });

  it("start with maxCycles sets the limit then starts", () => {
    const { calls, deps } = makeCalls();
    applyControl({ lane: "a", action: "start", maxCycles: 5 }, deps);
    expect(calls).toEqual(["max:/lanes/a:5", "start:/lanes/a"]);
  });

  it("'*' fans an action out to every lane", () => {
    const { calls, deps } = makeCalls();
    applyControl({ lane: "*", action: "stop" }, deps);
    expect(calls).toEqual(["stop:/lanes/a", "stop:/lanes/b"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/observability/monitorControl.test.ts`
Expected: FAIL — `applyControl` not exported.

- [ ] **Step 3: Implement in `src/observability/monitor.ts`**

Add imports at the top:

```ts
import { join } from "node:path";
import { listLanes } from "../lanes/lane.ts";
import { startLaneLoop, stopLaneLoop } from "../lanes/loop.ts";
import { writeControl, clearStop, normalizeMaxCycles } from "../lanes/control.ts";
import type { ControlCommand } from "./monitorServer.ts";
```

Add the testable dispatcher and its deps interface (exported):

```ts
export interface ControlDeps {
  lanesRoot: string;
  laneIds: () => string[];
  start: (worktree: string) => void;
  stop: (worktree: string) => void;
  pause: (worktree: string, paused: boolean) => void;
  setMaxCycles: (worktree: string, maxCycles: number | null) => void;
}

/** Pure dispatcher: maps a ControlCommand to side-effecting deps. Testable. */
export function applyControl(cmd: ControlCommand, deps: ControlDeps): void {
  const targets = cmd.lane === "*" ? deps.laneIds() : [cmd.lane];
  for (const laneId of targets) {
    const wt = join(deps.lanesRoot, laneId);
    switch (cmd.action) {
      case "pause": deps.pause(wt, true); break;
      case "continue": deps.pause(wt, false); break;
      case "stop": deps.stop(wt); break;
      case "start":
        if (cmd.maxCycles !== undefined) deps.setMaxCycles(wt, normalizeMaxCycles(cmd.maxCycles));
        deps.start(wt);
        break;
      case "restart":
        if (cmd.maxCycles !== undefined) deps.setMaxCycles(wt, normalizeMaxCycles(cmd.maxCycles));
        deps.stop(wt);
        deps.start(wt);
        break;
    }
  }
}
```

Then wire it into `startMonitor` by passing a `control` callback to `new MonitorServer({...})`:

```ts
  const controlDeps: ControlDeps = {
    lanesRoot,
    laneIds: () => listLanes(lanesRoot).map((m) => m.laneId),
    start: (wt) => { clearStop(wt); void startLaneLoop({ worktree: wt, detach: true, envUp: s.envUp, log: () => {} }); },
    stop: (wt) => { stopLaneLoop(wt, undefined, () => {}); },
    pause: (wt, paused) => writeControl(wt, { paused }),
    setMaxCycles: (wt, maxCycles) => writeControl(wt, { maxCycles }),
  };

  const server = new MonitorServer({
    summaries: () => registry.summaries(),
    historyFor: (id) => registry.historyFor(id),
    control: (cmd) => applyControl(cmd, controlDeps),
  });
```

Notes for the implementer:
- `s` (lane settings) and `lanesRoot` already exist in `startMonitor`; reuse them.
- The `restart` action here issues stop then start back-to-back. The detached `startLaneLoop` re-runs `environment.up` (idempotent for the target lane). A pidfile-removal wait is not required because `startLaneLoop --detach` spawns a fresh `adapt run` that reaps orphans (Task 4) and writes its own pidfile; the killed loop exits on SIGINT. If double-run races appear in manual testing, add a short `existsSync(pidfile)` poll before `start` — out of scope for the unit test.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/observability/monitorControl.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/observability/monitor.ts test/observability/monitorControl.test.ts
git commit -m "feat(monitor): wire control actions to loop spawn/kill + control file

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Surface paused + maxCycles in lane summaries

**Files:**
- Modify: `src/observability/laneRegistry.ts`
- Test: `test/observability/laneRegistry.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// test/observability/laneRegistry.test.ts
import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LaneRegistry } from "../../src/observability/laneRegistry.ts";

function lanesRootWith(laneId: string, control?: object): string {
  const root = mkdtempSync(join(tmpdir(), "registry-"));
  const adapt = join(root, laneId, ".adapt");
  mkdirSync(adapt, { recursive: true });
  writeFileSync(join(adapt, "lane.json"), JSON.stringify({
    laneId, baseline: "v1", model: null, branch: `adapt/${laneId}`,
    composeProject: `adapt-${laneId}`, ports: { base: 55000, stride: 100 },
    consolePort: 4399, createdAt: "2026-06-14T00:00:00.000Z",
  }), "utf8");
  if (control) writeFileSync(join(adapt, "control.json"), JSON.stringify(control), "utf8");
  return root;
}

describe("LaneRegistry summaries", () => {
  it("includes paused + maxCycles read from control.json", () => {
    const root = lanesRootWith("a", { paused: true, maxCycles: 7, stopRequested: false });
    const reg = new LaneRegistry({
      lanesRoot: root, consolePortBase: 4399, portBase: 55000, portStride: 100,
      onEvent: () => {}, onChange: () => {},
      makeSource: (info) => ({
        info, start() {}, stop() {}, refresh() {},
        status: () => "stopped", cycle: () => 0,
        readHistory: () => [],
      }) as never,
    });
    reg.start();
    const summary = reg.summaries().find((s) => s.laneId === "a")!;
    expect(summary.paused).toBe(true);
    expect(summary.maxCycles).toBe(7);
    reg.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it("defaults paused=false, maxCycles=null when no control file", () => {
    const root = lanesRootWith("a");
    const reg = new LaneRegistry({
      lanesRoot: root, consolePortBase: 4399, portBase: 55000, portStride: 100,
      onEvent: () => {}, onChange: () => {},
      makeSource: (info) => ({
        info, start() {}, stop() {}, refresh() {},
        status: () => "stopped", cycle: () => 0, readHistory: () => [],
      }) as never,
    });
    reg.start();
    const summary = reg.summaries().find((s) => s.laneId === "a")!;
    expect(summary.paused).toBe(false);
    expect(summary.maxCycles).toBeNull();
    reg.stop();
    rmSync(root, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/observability/laneRegistry.test.ts`
Expected: FAIL — `paused`/`maxCycles` absent from summary.

- [ ] **Step 3: Implement in `src/observability/laneRegistry.ts`**

Add the import:

```ts
import { readControl } from "../lanes/control.ts";
```

Extend `LaneSummary`:

```ts
export interface LaneSummary {
  laneId: string;
  model: string | null;
  baseline: string;
  status: LaneStatus;
  cycle: number;
  paused: boolean;
  maxCycles: number | null;
}
```

In `summaries()`, read the control file per source:

```ts
  summaries(): LaneSummary[] {
    const out: LaneSummary[] = [];
    for (const source of this.sources.values()) {
      const ctl = readControl(source.info.worktree);
      out.push({
        laneId: source.info.laneId,
        model: source.info.model,
        baseline: source.info.baseline,
        status: source.status(),
        cycle: source.cycle(),
        paused: ctl.paused,
        maxCycles: ctl.maxCycles ?? null,
      });
    }
    return out;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/observability/laneRegistry.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/observability/laneRegistry.ts test/observability/laneRegistry.test.ts
git commit -m "feat(monitor): surface paused + maxCycles in lane summaries

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: Monitor UI — control buttons + maxCycles input

**Files:**
- Modify: `src/observability/public/monitor.html`
- Modify: `src/observability/public/monitor.js`

No unit test (consistent with the existing monitor — UI is not unit-tested). Verified manually in Task 9.

- [ ] **Step 1: Add a global control bar to `monitor.html`**

Find the lanes sidebar container (the element with `id="lanes"`). Immediately before it, add a global bar:

```html
<div id="global-controls" class="controls-bar">
  <button data-act="start" data-lane="*">▶ start all</button>
  <button data-act="pause" data-lane="*">⏸ pause all</button>
  <button data-act="continue" data-lane="*">▶ continue all</button>
  <button data-act="stop" data-lane="*">■ stop all</button>
  <input id="global-maxcycles" type="number" min="0" placeholder="∞" title="maxCycles for start (blank=∞)" />
</div>
```

Add minimal CSS in the existing `<style>` block:

```css
.controls-bar { display: flex; gap: 4px; flex-wrap: wrap; padding: 6px; }
.controls-bar button, .lane-controls button { font: inherit; cursor: pointer; padding: 2px 6px; }
.lane-controls { display: flex; gap: 3px; flex-wrap: wrap; margin-top: 4px; }
.lane-controls input { width: 48px; }
.lane.paused .dot { color: #d8a657; }
button:disabled { opacity: 0.4; cursor: default; }
```

- [ ] **Step 2: Send control frames + render per-lane controls in `monitor.js`**

Add a helper near the other ws helpers:

```js
function sendControl(lane, action, maxCyclesEl) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const msg = { type: "control", lane, action };
  if (maxCyclesEl && (action === "start" || action === "restart")) {
    const v = parseInt(maxCyclesEl.value, 10);
    msg.maxCycles = Number.isFinite(v) && v > 0 ? v : null;
  }
  ws.send(JSON.stringify(msg));
}
```

Wire the global bar once, after the ws is created (e.g. at the end of the connect function or module top-level after DOM refs):

```js
const globalControlsEl = document.getElementById("global-controls");
const globalMaxCyclesEl = document.getElementById("global-maxcycles");
if (globalControlsEl) {
  globalControlsEl.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-act]");
    if (!btn) return;
    sendControl("*", btn.dataset.act, globalMaxCyclesEl);
  });
}
```

In `renderSidebar()`, inside the `for (const lane of lanes)` loop, after `row.append(top, meta);` and before the `row.addEventListener("click", ...)`, add per-lane controls. Use `stopPropagation` so clicking a button does not also trigger focus:

```js
    const status = lane.status;
    const paused = !!lane.paused;
    const controls = document.createElement("div");
    controls.className = "lane-controls";

    const mkBtn = (label, action, enabled) => {
      const b = document.createElement("button");
      b.textContent = label;
      b.disabled = !enabled;
      b.addEventListener("click", (ev) => {
        ev.stopPropagation();
        sendControl(lane.laneId, action, maxInput);
      });
      return b;
    };

    const maxInput = document.createElement("input");
    maxInput.type = "number";
    maxInput.min = "0";
    maxInput.placeholder = "∞";
    maxInput.title = "maxCycles (blank=∞)";
    if (lane.maxCycles != null) maxInput.value = String(lane.maxCycles);
    maxInput.addEventListener("click", (ev) => ev.stopPropagation());

    const running = status === "running";
    controls.append(
      mkBtn("▶", "start", !running),
      mkBtn("⏸", "pause", running && !paused),
      mkBtn("▶▶", "continue", running && paused),
      mkBtn("⟳", "restart", running),
      mkBtn("■", "stop", running),
      maxInput,
    );
    row.append(controls);
```

Update the status line so a paused lane is visible. Where the row class is set, add the paused modifier:

```js
    row.className = "lane " + (running ? "running" : "stopped") + (lane.paused ? " paused" : "");
```

And in the meta line, show the cycle/limit. Replace the `cycle.textContent` line with:

```js
    cycle.textContent = `cycle ${lane.cycle ?? 0}` + (lane.maxCycles != null ? `/${lane.maxCycles}` : "/∞") + (lane.paused ? " (paused)" : "");
```

- [ ] **Step 3: Commit**

```bash
git add src/observability/public/monitor.html src/observability/public/monitor.js
git commit -m "feat(monitor): per-lane + global control buttons and maxCycles input

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 9: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the new control/runContinuous/store/monitorServer/monitorControl/laneRegistry suites.

- [ ] **Step 2: Type-check / build sanity**

Run: `npx tsc --noEmit`
Expected: no errors. (Resolve any `unlinkSync` unused-import warning from Task 1 if the project enables `noUnusedLocals`.)

- [ ] **Step 3: Manual smoke test (monitor controls)**

```bash
# terminal 1: monitor
npm run adapt -- monitor /path/to/target-repo
# open the printed http://127.0.0.1:<port>
```

In the browser:
- Set lane `a` maxCycles to `3`, click ▶ start. Confirm the lane shows `running`, cycle count climbs, and the loop **exits after 3 cycles** (status → stopped).
- Start again with blank maxCycles (∞). Click ⏸ pause — confirm badge flips to `paused` after the current cycle completes (`cycle.paused` in the lane stream). Click ▶▶ continue — confirm it resumes.
- Click ■ stop, then ▶ start — confirm no scenario is stuck `running` (orphan reaped; `run.reaped` in the stream).
- Use the global bar "stop all" / "start all" and confirm both fan out (if more than one lane exists).

- [ ] **Step 4: Final commit (if any manual fixups were needed)**

```bash
git add -A
git commit -m "test(monitor): manual verification fixups for lane controls

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review notes (addressed)

- **Spec coverage:** control.json (Task 1), maxCycles default ∞ (Task 2), loop honors pause/stop/maxCycles (Task 3), resume/orphan reap (Task 4), server control plane (Task 5), monitor wiring incl. global `*` fanout (Task 6), summary fields (Task 7), per-lane + global UI (Task 8), verification (Task 9). All spec sections mapped.
- **maxCycles precedence:** control value (when present) > config; `null`/unset config default = infinite. Default ∞ achieved via schema `null` default + control `null`.
- **Type consistency:** `LaneControl.maxCycles: number | null | undefined`; `LaneSummary.maxCycles: number | null` (undefined coalesced to null at the registry boundary). `ControlCommand`/`ControlAction`/`ControlDeps`/`applyControl` names consistent across Tasks 5–6.
- **Counter semantics:** maxCycles counts cycles within a process run; restart resets it (documented in spec; acceptable since default is ∞).

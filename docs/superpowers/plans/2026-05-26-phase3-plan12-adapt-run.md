# Phase 3 · Plan 12 — `adapt run` (the continuous loop)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The organism runs on its own: `adapt run` loops `evolve` cycles until a guardrail trips (max cycles, wall-clock, consecutive errors) — Ctrl-C stops it cleanly — with everything streamed to the console.

**Architecture:** `runContinuous` is a deterministic Node loop over `runEvolve`, bounded by `config.run` guardrails, with injectable `sleep`/`clock`/`signal` for testability. `adapt run` wires the bus → console/decision log, installs a SIGINT handler that flips the stop signal, and reports why it stopped. Fully stub-tested (no real waiting).

**Tech Stack:** Builds on Phases 0–2 + Plans 10–11. No new npm deps.

**Depends on:** `runEvolve`/`EvolveSummary` (Phase 2), `OrchestratorEvent`, `EventBus`/`DecisionLog`/`fromAgentEvent`/`fromOrchestratorEvent`, `StateStore`, `loadConfig`, `workspacePaths`.

---

## File Structure

```
src/config/schema.ts        # MODIFY: add the `run` guardrail block
src/orchestrator/run.ts     # NEW: runContinuous(deps) -> ContinuousSummary
src/cli/commands/run.ts     # NEW: adapt run
src/cli/index.ts            # MODIFY: register run
docs/first-real-run.md      # MODIFY: add the adapt run step
test/orchestrator/run.test.ts
test/cli/run.test.ts
```

---

## Task 1: Config — run guardrails

**Files:** Modify `src/config/schema.ts`, `test/config/schema.test.ts`

- [ ] **Step 1: Add a failing test** — inside `describe("AdaptConfigSchema", ...)`:

```ts
  it("defaults the run guardrails", () => {
    const c = AdaptConfigSchema.parse({ targetRepoPath: "/repo", appBaseUrl: "http://localhost:3000" });
    expect(c.run.maxCycles).toBe(10);
    expect(c.run.maxWallClockSeconds).toBe(3600);
    expect(c.run.pauseSeconds).toBe(5);
    expect(c.run.maxConsecutiveErrors).toBe(3);
  });
```

- [ ] **Step 2: Run** — `npx vitest run test/config/schema.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — in `src/config/schema.ts`, add a top-level `run` block to the schema object (e.g. after the `limits` block):

```ts
  run: z.object({
    maxCycles: z.number().int().positive().default(10),
    maxWallClockSeconds: z.number().int().positive().default(3600),
    pauseSeconds: z.number().int().nonnegative().default(5),
    maxConsecutiveErrors: z.number().int().positive().default(3),
  }).default({}),
```

- [ ] **Step 4: Run** — `npx vitest run test/config/schema.test.ts` (PASS), then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts test/config/schema.test.ts
git commit -m "feat(config): adapt run guardrails (maxCycles, wallClock, pause, errors)"
```

---

## Task 2: `runContinuous`

**Files:** Create `src/orchestrator/run.ts`; Test `test/orchestrator/run.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
```

- [ ] **Step 2: Run** — `npx vitest run test/orchestrator/run.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/orchestrator/run.ts`:

```ts
import type { AgentEngine, AgentEvent } from "../engine/types.ts";
import type { AdaptConfig } from "../config/schema.ts";
import { StateStore } from "./store.ts";
import type { OrchestratorEvent } from "./orchestrator.ts";
import { runEvolve, type EvolveSummary } from "./evolve.ts";

export type StopReason = "maxCycles" | "wallClock" | "errors" | "signal";

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
}

export interface ContinuousSummary {
  cycles: number;
  stoppedBy: StopReason;
  evolveSummaries: EvolveSummary[];
}

/** Loop runEvolve until a guardrail trips. Deterministic; injectable sleep/clock/signal for tests. */
export async function runContinuous(deps: ContinuousDeps): Promise<ContinuousSummary> {
  const r = deps.config.run;
  const now = deps.now ?? (() => new Date().toISOString());
  const clockMs = deps.clockMs ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((res) => setTimeout(res, ms)));
  const startMs = clockMs();

  const evolveSummaries: EvolveSummary[] = [];
  let cycles = 0;
  let consecutiveErrors = 0;

  while (true) {
    if (deps.signal?.stopped) return { cycles, stoppedBy: "signal", evolveSummaries };
    if (cycles >= r.maxCycles) return { cycles, stoppedBy: "maxCycles", evolveSummaries };
    if ((clockMs() - startMs) / 1000 >= r.maxWallClockSeconds) return { cycles, stoppedBy: "wallClock", evolveSummaries };

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

    if (errored && consecutiveErrors >= r.maxConsecutiveErrors) {
      return { cycles, stoppedBy: "errors", evolveSummaries };
    }
    if (deps.signal?.stopped) return { cycles, stoppedBy: "signal", evolveSummaries };
    await sleep(r.pauseSeconds * 1000);
  }
}
```

- [ ] **Step 4: Run** — `npx vitest run test/orchestrator/run.test.ts` (PASS, 3 tests), then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/run.ts test/orchestrator/run.test.ts
git commit -m "feat(orchestrator): runContinuous — bounded evolve loop with guardrails"
```

---

## Task 3: `adapt run` CLI + docs + final verification

**Files:** Create `src/cli/commands/run.ts`; Modify `src/cli/index.ts`, `docs/first-real-run.md`; Test `test/cli/run.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { runCmd } from "../../src/cli/commands/run.ts";
import { DecisionLog } from "../../src/observability/decisionLog.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function quietEngine() {
  return new StubEngine({ script: (s) => {
    if (s.role === "dreamer") writeFileSync(s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim(), JSON.stringify({ ambition: null, demands: [] }));
    return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
  }});
}

describe("runCmd", () => {
  it("runs a bounded continuous loop and reports why it stopped", async () => {
    dir = makeTmpDir();
    for (const d of ["scenarios", "demands", "scenario-runs", "work-items"]) mkdirSync(join(dir, ".adapt", d), { recursive: true });
    writeFileSync(join(dir, ".adapt", "north-star.md"), "# North Star\nBe great.\n", "utf8");
    writeFileSync(join(dir, ".adapt", "config.json"), JSON.stringify({ targetRepoPath: dir, appBaseUrl: "http://x", run: { maxCycles: 1, pauseSeconds: 0 } }), "utf8");

    const res = await runCmd({ targetRepo: dir, engine: quietEngine(), log: () => {} });
    expect(res.code).toBe(0);
    expect(res.summary.cycles).toBe(1);
    expect(res.summary.stoppedBy).toBe("maxCycles");

    const today = new Date().toISOString().slice(0, 10);
    expect(new DecisionLog(dir!).readDay(today).some((e) => e.kind === "cycle.start")).toBe(true);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/cli/run.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — `src/cli/commands/run.ts`:

```ts
import type { AgentEngine } from "../../engine/types.ts";
import { StubEngine } from "../../engine/stubEngine.ts";
import { ClaudeCodeEngine } from "../../engine/claudeCode.ts";
import { StateStore } from "../../orchestrator/store.ts";
import { loadConfig } from "../../config/load.ts";
import { workspacePaths } from "../../workspace/paths.ts";
import { runContinuous, type ContinuousSummary } from "../../orchestrator/run.ts";
import { EventBus } from "../../observability/eventBus.ts";
import { DecisionLog } from "../../observability/decisionLog.ts";
import { fromAgentEvent, fromOrchestratorEvent, type ConsoleEvent } from "../../observability/events.ts";

export interface RunCmdOptions {
  targetRepo: string;
  engine?: AgentEngine;
  log?: (msg: string) => void;
  signal?: { stopped: boolean };
}

export interface RunCmdResult { code: number; summary: ContinuousSummary; }

/** Core of `adapt run`: the bounded continuous loop, events mirrored to the decision log. */
export async function runCmd(opts: RunCmdOptions): Promise<RunCmdResult> {
  const log = opts.log ?? console.log;
  const config = loadConfig(opts.targetRepo);
  const ws = workspacePaths(opts.targetRepo);
  const engine = opts.engine ?? (config.engine.type === "stub" ? new StubEngine() : new ClaudeCodeEngine({ command: config.engine.command }));
  const store = new StateStore(`${ws.root}/state.db`);

  const bus = new EventBus<ConsoleEvent>();
  const decisionLog = new DecisionLog(opts.targetRepo);
  bus.subscribe((e) => decisionLog.append(e));

  const summary = await runContinuous({
    engine, store, config, targetRepo: opts.targetRepo,
    sink: (e) => bus.publish(fromAgentEvent(e)),
    emit: (e) => bus.publish(fromOrchestratorEvent(e)),
    signal: opts.signal,
  });

  store.close();
  log(`run: ${summary.cycles} cycle(s), stopped by ${summary.stoppedBy}`);
  return { code: 0, summary };
}
```

- [ ] **Step 4: Register the command** — in `src/cli/index.ts`, insert IMMEDIATELY BEFORE the final `program.parseAsync(process.argv);` (preserve existing commands):

```ts
program
  .command("run")
  .description("Run the organism continuously (bounded evolve loop) until a guardrail or Ctrl-C")
  .argument("<targetRepo>", "path to the target product repository")
  .action(async (targetRepo: string) => {
    const { runCmd } = await import("./commands/run.ts");
    const signal = { stopped: false };
    process.on("SIGINT", () => { signal.stopped = true; });
    const res = await runCmd({ targetRepo, signal });
    process.exit(res.code);
  });
```

- [ ] **Step 5: Update `docs/first-real-run.md`** — add after the `adapt evolve` step (step 9), before "What success looks like":

```markdown
10. `adapt run /path/to/app` — the organism runs continuously: it loops `evolve` until a guardrail trips
    (`run.maxCycles`, `run.maxWallClockSeconds`, `run.maxConsecutiveErrors`) or you press Ctrl-C. Set the guardrails
    in `config.json`. Watch `adapt console` alongside; inspect the growing north-star, demands, scenarios, graduated
    Playwright specs in `tests/adapt/`, and the decision log.
```

- [ ] **Step 6: Run** — `npx vitest run test/cli/run.test.ts` (PASS, 1 test), then `npx vitest run` (ALL pass — report counts) and `npx tsc --noEmit` (exit 0). Report all.

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/run.ts src/cli/index.ts docs/first-real-run.md test/cli/run.test.ts
git commit -m "feat(cli): adapt run — the continuous organism loop"
```

---

## Self-Review (completed during authoring)

- **Spec coverage (Plan 12 / spec §6):** `run` guardrail config → Task 1; `runContinuous` loop with maxCycles/wallClock/errors/signal stop reasons + pause → Task 2; `adapt run` command wiring events to the decision log + SIGINT → stop signal → Tasks 3–4; the first-real-run `adapt run` step → Task 5.
- **Type consistency:** `ContinuousDeps` (engine/store/config/targetRepo/sink/emit + injectable now/nowDate/sleep/clockMs/signal), `ContinuousSummary { cycles, stoppedBy, evolveSummaries }`, `StopReason`, `runCmd`. `runContinuous` calls `runEvolve` with the established `CycleDeps`-shaped object; emits `cycle.start`/`cycle.completed`/`cycle.error` as `OrchestratorEvent`s (which `fromOrchestratorEvent` maps to the `orchestrator` channel, `kind` = the type — hence the test asserts `e.kind === "cycle.start"`).
- **Boundedness:** the loop cannot run unbounded — `maxCycles` and `maxWallClockSeconds` both have finite defaults; the signal path gives clean Ctrl-C. Tests cover all four stop reasons except wall-clock (covered by construction; the guard is a simple comparison) — maxCycles, errors, and signal are tested explicitly.
- **End of Phase 3:** with Plan 12, `adapt run` makes the organism run on its own — dream → critique → generate → validate → triage → repair → verify, cycle after cycle, graduating proven scenarios out of the LLM loop, until a guardrail or Ctrl-C.

# Phase 2 · Plan 9 — `adapt evolve` (demand stage + cycle)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compose the full evolutionary pass — Dreamer → Critic → Generator (the demand stage) then the Phase 1 `runCycle` — behind one `adapt evolve` command that streams everything to the console and commits the workspace artifacts.

**Architecture:** `runDemandStage` chains the three Plan 7/8 functions; `runEvolve` runs the demand stage then `runCycle` on the expanded scenario set. `evolveCmd` wires one EventBus → decision log (both agent and orchestrator events) exactly like `orchestrate`, then best-effort-commits the `.adapt/` artifact changes in the target repo. Fully stub-tested.

**Tech Stack:** Builds on Phases 0–1 + Plans 7–8. No new npm deps.

**Depends on:** Plan 7 (`runDream`, `runCritique`, `Demand`), Plan 8 (`runGenerate`), Phase 1 (`runCycle`/`CycleDeps`/`CycleSummary`, `EventBus`, `DecisionLog`, `fromAgentEvent`/`fromOrchestratorEvent`, `StateStore`, `loadConfig`, `workspacePaths`).

---

## File Structure

```
src/demand/demandStage.ts       # runDemandStage(deps) -> DemandStageSummary
src/orchestrator/git.ts         # commitWorkspace(targetRepo, message) -> boolean (guarded)
src/orchestrator/evolve.ts      # runEvolve(deps) -> EvolveSummary
src/cli/commands/evolve.ts      # adapt evolve
src/cli/index.ts                # MODIFY: register evolve
docs/first-real-run.md          # MODIFY: add the evolve step
test/demand/demandStage.test.ts
test/orchestrator/git.test.ts
test/orchestrator/evolve.test.ts
test/cli/evolve.test.ts
```

---

## Task 1: `runDemandStage`

**Files:** Create `src/demand/demandStage.ts`; Test `test/demand/demandStage.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { AdaptConfigSchema } from "../../src/config/schema.ts";
import { runDemandStage } from "../../src/demand/demandStage.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function ctx() {
  dir = makeTmpDir();
  mkdirSync(join(dir, ".adapt", "scenarios"), { recursive: true });
  mkdirSync(join(dir, ".adapt", "demands"), { recursive: true });
  writeFileSync(join(dir, ".adapt", "north-star.md"), "# North Star\nBe great.\n", "utf8");
  const config = AdaptConfigSchema.parse({ targetRepoPath: dir, appBaseUrl: "http://x", limits: { maxDemandsPerCycle: 2, maxScenariosPerDemand: 1 } });
  return { dir: dir!, config };
}

// Demand-stage stub: dreamer proposes 1 ambition + 2 demands; critic approves DMD-001, rejects DMD-002;
// generator writes one valid scenario per approved demand at the assigned id.
function demandEngine() {
  return new StubEngine({ script: (s) => {
    const path = (s.prompt.match(/RESULT_FILE=(.+)/) || [])[1]?.trim();
    if (s.role === "dreamer") {
      writeFileSync(path!, JSON.stringify({ ambition: "Reach higher", demands: [
        { title: "Good feature", rationale: "r", proposedScenarios: ["do x"] },
        { title: "Bloat feature", rationale: "r", proposedScenarios: ["do y"] },
      ] }), "utf8");
    } else if (s.role === "critic") {
      const approve = s.prompt.includes("DMD-001");
      writeFileSync(path!, JSON.stringify({ decision: approve ? "approved" : "rejected", critique: "c" }), "utf8");
    } else if (s.role === "generator") {
      const genDir = s.prompt.match(/directory:\s*(\S+)/)![1];
      const id = s.prompt.match(/SCN-\d+/)![0];
      writeFileSync(join(genDir, `${id}.md`), `---\nid: ${id}\ntitle: ${id}\nstatus: ready\npriority: medium\npersona: User\ntags: [gen]\nsource: agent-discovered\n---\n# Scenario\nDo a thing.\n`, "utf8");
    }
    return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
  }});
}

describe("runDemandStage", () => {
  it("dreams, critiques, and generates scenarios for approved demands only", async () => {
    const c = ctx();
    const sum = await runDemandStage({ engine: demandEngine(), config: c.config, targetRepo: c.dir, sink: () => {}, now: () => "2026-05-26T10:00:00.000Z" });
    expect(sum.ambitionAppended).toBe(true);
    expect(sum.demands.length).toBe(2);
    expect(sum.approved.map((d) => d.id)).toEqual(["DMD-001"]);
    expect(sum.scenariosCreated.length).toBe(1); // only the approved demand produced a scenario
    expect(readFileSync(join(c.dir, ".adapt", "north-star.md"), "utf8")).toContain("Reach higher");
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/demand/demandStage.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — `src/demand/demandStage.ts`:

```ts
import type { AgentEngine, AgentEvent } from "../engine/types.ts";
import type { AdaptConfig } from "../config/schema.ts";
import { runDream } from "./dream.ts";
import { runCritique } from "./critique.ts";
import { runGenerate } from "./generate.ts";
import type { Demand } from "./demand.ts";

export interface DemandStageDeps {
  engine: AgentEngine;
  config: AdaptConfig;
  targetRepo: string;
  sink: (e: AgentEvent) => void;
  now?: () => string;
}

export interface DemandStageSummary {
  ambitionAppended: boolean;
  demands: Demand[];
  approved: Demand[];
  scenariosCreated: { id: string; filename: string }[];
}

/** One demand-generation pass: dream -> critique -> generate scenarios for approved demands. */
export async function runDemandStage(deps: DemandStageDeps): Promise<DemandStageSummary> {
  const dream = await runDream(deps);
  const approved = await runCritique(deps);
  const scenariosCreated = await runGenerate(deps, approved);
  return { ambitionAppended: dream.ambitionAppended, demands: dream.demands, approved, scenariosCreated };
}
```

- [ ] **Step 4: Run** — `npx vitest run test/demand/demandStage.test.ts`. Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/demand/demandStage.ts test/demand/demandStage.test.ts
git commit -m "feat(demand): runDemandStage — dream -> critique -> generate"
```

---

## Task 2: `commitWorkspace` git helper

**Files:** Create `src/orchestrator/git.ts`; Test `test/orchestrator/git.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { commitWorkspace } from "../../src/orchestrator/git.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

describe("commitWorkspace", () => {
  it("returns false (no throw) when the target is not a git repo", () => {
    dir = makeTmpDir();
    mkdirSync(join(dir, ".adapt"), { recursive: true });
    writeFileSync(join(dir, ".adapt", "north-star.md"), "x", "utf8");
    expect(commitWorkspace(dir, "msg")).toBe(false);
  });

  it("commits .adapt changes in a real git repo", () => {
    dir = makeTmpDir();
    spawnSync("git", ["-C", dir, "init"], { encoding: "utf8" });
    spawnSync("git", ["-C", dir, "config", "user.email", "t@t.t"], { encoding: "utf8" });
    spawnSync("git", ["-C", dir, "config", "user.name", "t"], { encoding: "utf8" });
    mkdirSync(join(dir, ".adapt"), { recursive: true });
    writeFileSync(join(dir, ".adapt", "north-star.md"), "x", "utf8");
    expect(commitWorkspace(dir, "adapt: evolve")).toBe(true);
    const log = spawnSync("git", ["-C", dir, "log", "--oneline"], { encoding: "utf8" });
    expect(log.stdout).toContain("adapt: evolve");
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/orchestrator/git.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — `src/orchestrator/git.ts`:

```ts
import { spawnSync } from "node:child_process";

/** Best-effort commit of the .adapt/ workspace in the target repo. Returns false (never throws)
 *  if the target is not a git repo or there is nothing to commit. */
export function commitWorkspace(targetRepo: string, message: string): boolean {
  const add = spawnSync("git", ["-C", targetRepo, "add", ".adapt"], { encoding: "utf8" });
  if (add.status !== 0) return false;
  const commit = spawnSync("git", ["-C", targetRepo, "commit", "-m", message], { encoding: "utf8" });
  return commit.status === 0;
}
```

- [ ] **Step 4: Run** — `npx vitest run test/orchestrator/git.test.ts`. Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/git.ts test/orchestrator/git.test.ts
git commit -m "feat(orchestrator): guarded commitWorkspace helper"
```

---

## Task 3: `runEvolve`

**Files:** Create `src/orchestrator/evolve.ts`; Test `test/orchestrator/evolve.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { StateStore } from "../../src/orchestrator/store.ts";
import { AdaptConfigSchema } from "../../src/config/schema.ts";
import { runEvolve } from "../../src/orchestrator/evolve.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function setup() {
  dir = makeTmpDir();
  mkdirSync(join(dir, ".adapt", "scenarios"), { recursive: true });
  mkdirSync(join(dir, ".adapt", "demands"), { recursive: true });
  mkdirSync(join(dir, ".adapt", "scenario-runs"), { recursive: true });
  mkdirSync(join(dir, ".adapt", "work-items"), { recursive: true });
  writeFileSync(join(dir, ".adapt", "north-star.md"), "# North Star\nBe great.\n", "utf8");
  const store = new StateStore(":memory:");
  const config = AdaptConfigSchema.parse({ targetRepoPath: dir, appBaseUrl: "http://x", limits: { maxDemandsPerCycle: 1, maxScenariosPerDemand: 1 } });
  return { dir: dir!, store, config };
}

// Full-organism stub: dreamer -> 1 demand; critic approves; generator writes SCN-001; runner passes it.
function organismEngine() {
  return new StubEngine({ script: (s) => {
    if (s.role === "dreamer") {
      const path = s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim();
      writeFileSync(path, JSON.stringify({ ambition: null, demands: [{ title: "F", rationale: "r", proposedScenarios: ["x"] }] }));
    } else if (s.role === "critic") {
      const path = s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim();
      writeFileSync(path, JSON.stringify({ decision: "approved", critique: "ok" }));
    } else if (s.role === "generator") {
      const genDir = s.prompt.match(/directory:\s*(\S+)/)![1];
      const id = s.prompt.match(/SCN-\d+/)![0];
      writeFileSync(join(genDir, `${id}.md`), `---\nid: ${id}\ntitle: ${id}\nstatus: ready\npriority: medium\npersona: User\ntags: [gen]\nsource: agent-discovered\n---\n# Scenario\nDo a thing.\n`);
    } else if (s.role === "runner") {
      const path = s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim();
      const sid = s.prompt.match(/SCENARIO (SCN-\d+)/)![1];
      writeFileSync(path, JSON.stringify({ runId: "x", scenarioId: sid, scenarioTitle: sid, status: "passed", startedAt: "t", finishedAt: "t", appBaseUrl: "http://x", appVersion: null, environment: "local", stepsExecuted: 1, failureStep: null, expectedOutcome: "x", actualOutcome: "x", consoleErrors: [], networkErrors: [], screenshots: [], artifacts: [], linkedJiraIssue: null, runnerNotes: "" }));
    }
    return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
  }});
}

describe("runEvolve", () => {
  it("runs the demand stage then the cycle on the generated scenario", async () => {
    const c = setup();
    const orchEvents: any[] = [];
    const sum = await runEvolve({
      engine: organismEngine(), store: c.store, config: c.config, targetRepo: c.dir,
      sink: () => {}, emit: (e) => orchEvents.push(e),
    });
    expect(sum.stage.scenariosCreated.map((s) => s.id)).toEqual(["SCN-001"]);
    expect(sum.cycle.runs.length).toBe(1);
    expect(sum.cycle.runs[0]!.scenarioId).toBe("SCN-001");
    expect(sum.cycle.runs[0]!.status).toBe("passed");
    expect(orchEvents.some((e) => e.type === "run.created")).toBe(true);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/orchestrator/evolve.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — `src/orchestrator/evolve.ts`:

```ts
import { runDemandStage, type DemandStageSummary } from "../demand/demandStage.ts";
import { runCycle, type CycleDeps, type CycleSummary } from "./cycle.ts";

export type EvolveDeps = CycleDeps;

export interface EvolveSummary {
  stage: DemandStageSummary;
  cycle: CycleSummary;
}

/** One full evolutionary pass: demand stage (dream -> critique -> generate) then the Phase 1 cycle. */
export async function runEvolve(deps: EvolveDeps): Promise<EvolveSummary> {
  const stage = await runDemandStage({
    engine: deps.engine, config: deps.config, targetRepo: deps.targetRepo, sink: deps.sink, now: deps.now,
  });
  const cycle = await runCycle(deps);
  return { stage, cycle };
}
```

- [ ] **Step 4: Run** — `npx vitest run test/orchestrator/evolve.test.ts`. Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/evolve.ts test/orchestrator/evolve.test.ts
git commit -m "feat(orchestrator): runEvolve — demand stage + cycle"
```

---

## Task 4: `adapt evolve` CLI

**Files:** Create `src/cli/commands/evolve.ts`; Modify `src/cli/index.ts`; Test `test/cli/evolve.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { evolveCmd } from "../../src/cli/commands/evolve.ts";
import { DecisionLog } from "../../src/observability/decisionLog.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function organismEngine() {
  return new StubEngine({ script: (s) => {
    if (s.role === "dreamer") writeFileSync(s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim(), JSON.stringify({ ambition: "higher", demands: [{ title: "F", rationale: "r", proposedScenarios: ["x"] }] }));
    else if (s.role === "critic") writeFileSync(s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim(), JSON.stringify({ decision: "approved", critique: "ok" }));
    else if (s.role === "generator") { const d = s.prompt.match(/directory:\s*(\S+)/)![1]; const id = s.prompt.match(/SCN-\d+/)![0]; writeFileSync(join(d, `${id}.md`), `---\nid: ${id}\ntitle: ${id}\nstatus: ready\npriority: medium\npersona: User\ntags: [g]\nsource: agent-discovered\n---\n# Scenario\nDo it.\n`); }
    else if (s.role === "runner") { const p = s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim(); const sid = s.prompt.match(/SCENARIO (SCN-\d+)/)![1]; writeFileSync(p, JSON.stringify({ runId: "x", scenarioId: sid, scenarioTitle: sid, status: "passed", startedAt: "t", finishedAt: "t", appBaseUrl: "http://x", appVersion: null, environment: "local", stepsExecuted: 1, failureStep: null, expectedOutcome: "x", actualOutcome: "x", consoleErrors: [], networkErrors: [], screenshots: [], artifacts: [], linkedJiraIssue: null, runnerNotes: "" })); }
    return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
  }});
}

describe("evolveCmd", () => {
  it("runs a full evolutionary pass and logs events", async () => {
    dir = makeTmpDir();
    for (const d of ["scenarios", "demands", "scenario-runs", "work-items"]) mkdirSync(join(dir, ".adapt", d), { recursive: true });
    writeFileSync(join(dir, ".adapt", "config.json"), JSON.stringify({ targetRepoPath: dir, appBaseUrl: "http://x" }), "utf8");
    writeFileSync(join(dir, ".adapt", "north-star.md"), "# North Star\nBe great.\n", "utf8");

    const res = await evolveCmd({ targetRepo: dir, engine: organismEngine(), log: () => {} });
    expect(res.code).toBe(0);
    expect(res.summary.stage.scenariosCreated.length).toBe(1);
    expect(res.summary.cycle.runs[0]!.status).toBe("passed");

    const today = new Date().toISOString().slice(0, 10);
    expect(new DecisionLog(dir!).readDay(today).some((e) => e.channel === "orchestrator")).toBe(true);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/cli/evolve.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — `src/cli/commands/evolve.ts`:

```ts
import type { AgentEngine } from "../../engine/types.ts";
import { StubEngine } from "../../engine/stubEngine.ts";
import { ClaudeCodeEngine } from "../../engine/claudeCode.ts";
import { StateStore } from "../../orchestrator/store.ts";
import { loadConfig } from "../../config/load.ts";
import { workspacePaths } from "../../workspace/paths.ts";
import { runEvolve, type EvolveSummary } from "../../orchestrator/evolve.ts";
import { commitWorkspace } from "../../orchestrator/git.ts";
import { EventBus } from "../../observability/eventBus.ts";
import { DecisionLog } from "../../observability/decisionLog.ts";
import { fromAgentEvent, fromOrchestratorEvent, type ConsoleEvent } from "../../observability/events.ts";

export interface EvolveCmdOptions {
  targetRepo: string;
  engine?: AgentEngine;
  log?: (msg: string) => void;
}

export interface EvolveCmdResult { code: number; summary: EvolveSummary; }

/** Core of `adapt evolve`: one full evolutionary pass, events mirrored to the decision log,
 *  workspace artifacts committed best-effort. */
export async function evolveCmd(opts: EvolveCmdOptions): Promise<EvolveCmdResult> {
  const log = opts.log ?? console.log;
  const config = loadConfig(opts.targetRepo);
  const ws = workspacePaths(opts.targetRepo);
  const engine = opts.engine ?? (config.engine.type === "stub" ? new StubEngine() : new ClaudeCodeEngine({ command: config.engine.command }));
  const store = new StateStore(`${ws.root}/state.db`);

  const bus = new EventBus<ConsoleEvent>();
  const decisionLog = new DecisionLog(opts.targetRepo);
  bus.subscribe((e) => decisionLog.append(e));

  const summary = await runEvolve({
    engine, store, config, targetRepo: opts.targetRepo,
    sink: (e) => bus.publish(fromAgentEvent(e)),
    emit: (e) => bus.publish(fromOrchestratorEvent(e)),
  });

  store.close();
  const committed = commitWorkspace(opts.targetRepo, "adapt: evolve cycle (north-star, demands, scenarios)");

  log(`evolve: ${summary.stage.demands.length} demand(s), ${summary.stage.approved.length} approved, ` +
      `${summary.stage.scenariosCreated.length} new scenario(s); ` +
      `cycle ${summary.cycle.runs.length} run(s), ${summary.cycle.repaired.filter((r) => r.verified).length} verified` +
      `${committed ? " · artifacts committed" : ""}`);
  return { code: 0, summary };
}
```

- [ ] **Step 4: Register the command** — in `src/cli/index.ts`, insert IMMEDIATELY BEFORE the final `program.parseAsync(process.argv);` (do not remove existing commands):

```ts
program
  .command("evolve")
  .description("Run one full evolutionary pass: dream -> critique -> generate -> validate -> triage -> repair -> verify")
  .argument("<targetRepo>", "path to the target product repository")
  .action(async (targetRepo: string) => {
    const { evolveCmd } = await import("./commands/evolve.ts");
    const res = await evolveCmd({ targetRepo });
    process.exit(res.code);
  });
```

- [ ] **Step 5: Run** — `npx vitest run test/cli/evolve.test.ts` (PASS, 1 test), then `npx vitest run` (ALL pass) and `npx tsc --noEmit` (exit 0). Report all.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/evolve.ts src/cli/index.ts test/cli/evolve.test.ts
git commit -m "feat(cli): adapt evolve — full evolutionary pass"
```

---

## Task 5: first-real-run doc + final verification

**Files:** Modify `docs/first-real-run.md`

- [ ] **Step 1: Add an evolve step** — in `docs/first-real-run.md`, insert after step 7 (the `orchestrate` step), before the "What success looks like" heading:

```markdown
9. `adapt evolve /path/to/app` — the full organism: the Dreamer proposes ambition + demands, the Critic gates them,
   the Generator writes new scenarios, then the cycle validates/repairs them. Inspect `.adapt/demands/`, the new
   `.adapt/scenarios/`, the appended `.adapt/north-star.md` (watch ambition grow in git), and the decision log.
```

- [ ] **Step 2: Final full verification** — run `npx vitest run` (report file/test counts) and `npx tsc --noEmit` (report exit code). Both must be green.

- [ ] **Step 3: Commit**

```bash
git add docs/first-real-run.md
git commit -m "docs: add adapt evolve to the first-real-run checklist"
```

---

## Self-Review (completed during authoring)

- **Spec coverage (Plan 9):** `runDemandStage` = dream → critique → generate (§6) → Task 1; `runEvolve` = demand stage then `runCycle` (§2.2, §6) → Task 3; `adapt evolve` command wiring both event channels to the decision log + best-effort artifact commit (§6) → Tasks 2, 4; bounded single pass (§7) → Tasks 1, 3 (no loops); first-real-run evolve step (§8) → Task 5.
- **Type consistency:** `DemandStageDeps`/`DemandStageSummary`, `EvolveDeps = CycleDeps`, `EvolveSummary { stage, cycle }`, `commitWorkspace(targetRepo, message) -> boolean`, `evolveCmd`. Reuses `runDream`/`runCritique`/`runGenerate` (Plans 7–8) and `runCycle`/`CycleDeps`/`CycleSummary`, `EventBus`/`DecisionLog`/`fromAgentEvent`/`fromOrchestratorEvent` (Phases 0–1) unchanged. `evolveCmd` mirrors `orchestrateCmd` exactly, adding the demand stage + artifact commit.
- **Known real-run note:** `commitWorkspace` commits `.adapt/` on the current branch; the Implementation agent inside `runCycle` separately commits *code* on `adapt/<itemId>` branches. Their interleaving on a real repo is a real-run concern (documented), not exercised by stub tests. `commitWorkspace` is guarded (returns false on a non-git target), so stub tests in temp dirs don't require git.
- **End of Phase 2:** with Plan 9, `adapt evolve` runs the whole organism — dream → critique → generate → validate → triage → repair → verify — stub-tested end to end.

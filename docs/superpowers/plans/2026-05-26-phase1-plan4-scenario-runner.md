# Phase 1 · Plan 4 — Scenario Runner

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a user-level scenario black-box against the running app via a coding agent, capture a schema-validated verdict + evidence, and record it through the Phase 0 orchestrator — with DB setup/teardown hooks around each run.

**Architecture:** The orchestrator (Node) drives one scenario: it runs the scenario's `setup` hook, launches a Runner agent (Playwright MCP, no source access) that writes a `RunRecord` JSON to a known path, validates that result, finalizes it via `orchestrator.recordResult`, then runs the `teardown` hook. A missing/invalid result or a failed setup hook resolves safely (`inconclusive` / `blocked`) — never a false pass. Everything is stub-tested: the `StubEngine` script writes a fixture result file extracted from the prompt's `RESULT_FILE=` line.

**Tech Stack:** Builds on Phase 0 (engine seam, orchestrator, run ledger, workspace/config/scenarios). No new npm dependencies (Playwright/Jira are agent-side MCP servers, not Node deps).

**Depends on:** Phase 0 (merged). Key reused exports: `AgentEngine`/`AgentSpec`/`AgentEvent` & `StubEngine` & `runAgent` (`src/engine/`), `Orchestrator` (`createRun`/`advanceRun`/`recordResult`), `RunRecord`/`RunRecordSchema` (`src/orchestrator/runRecord.ts`), `RUN_TRANSITIONS` (`src/orchestrator/lifecycles.ts`), `workspacePaths`, `AdaptConfig`, `parseScenario`/`ParsedScenario`, `rebuildRegistry`.

---

## File Structure

```
src/engine/mcp.ts                 # mcpServersFor(role, config) -> logical MCP server names
src/orchestrator/hooks.ts         # runHook(cmd, cwd) -> HookResult
src/agents/runRole.ts             # runRole(engine, spec, resultFile, schema, sink) -> RoleOutcome<T>
src/agents/prompts/runner.ts      # runnerPrompt(ctx) -> string
src/orchestrator/runScenario.ts   # runScenario(deps, scenario); runReadyScenarios(deps)
src/cli/commands/runScenarios.ts  # adapt run-scenarios
src/orchestrator/lifecycles.ts    # MODIFIED: allow queued -> blocked
test/engine/mcp.test.ts
test/orchestrator/hooks.test.ts
test/agents/runRole.test.ts
test/agents/runnerPrompt.test.ts
test/orchestrator/runScenario.test.ts
test/cli/runScenarios.test.ts
```

---

## Task 1: Allow `queued → blocked` in the run lifecycle

A scenario whose `setup` hook fails is blocked before it ever runs. The Phase 0 table only allows `queued → running`.

**Files:**
- Modify: `src/orchestrator/lifecycles.ts`
- Modify: `test/orchestrator/lifecycles.test.ts`

- [ ] **Step 1: Add a failing assertion** — in `test/orchestrator/lifecycles.test.ts`, inside the existing `describe("lifecycle transition tables", ...)`, add:

```ts
  it("a run can be blocked before it starts (setup hook failure)", () => {
    expect(RUN_TRANSITIONS.queued).toContain("blocked");
  });
```

- [ ] **Step 2: Run it** — `npx vitest run test/orchestrator/lifecycles.test.ts`. Expected: FAIL (queued has only "running").

- [ ] **Step 3: Implement** — in `src/orchestrator/lifecycles.ts` change the `queued` entry of `RUN_TRANSITIONS`:

```ts
  queued: ["running", "blocked"],
```

- [ ] **Step 4: Run it** — `npx vitest run test/orchestrator/lifecycles.test.ts`. Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/lifecycles.ts test/orchestrator/lifecycles.test.ts
git commit -m "feat(orchestrator): allow queued -> blocked (setup hook failure)"
```

---

## Task 2: MCP server selection per role

**Files:**
- Create: `src/engine/mcp.ts`
- Test: `test/engine/mcp.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { mcpServersFor } from "../../src/engine/mcp.ts";
import { AdaptConfigSchema } from "../../src/config/schema.ts";

const cfg = (over = {}) => AdaptConfigSchema.parse({ targetRepoPath: "/r", appBaseUrl: "http://localhost:3000", mcp: over });

describe("mcpServersFor", () => {
  it("runner gets playwright only (never jira)", () => {
    expect(mcpServersFor("runner", cfg({ jira: { enabled: true } }))).toEqual(["playwright"]);
  });
  it("verification gets playwright + jira when both enabled", () => {
    expect(mcpServersFor("verification", cfg({ jira: { enabled: true } }))).toEqual(["playwright", "jira"]);
  });
  it("triage and implementation get chrome-devtools + jira", () => {
    expect(mcpServersFor("triage", cfg({ jira: { enabled: true } }))).toEqual(["chrome-devtools", "jira"]);
    expect(mcpServersFor("implementation", cfg({ jira: { enabled: true } }))).toEqual(["chrome-devtools", "jira"]);
  });
  it("omits a server when its config toggle is off", () => {
    expect(mcpServersFor("runner", cfg({ playwright: { enabled: false } }))).toEqual([]);
    expect(mcpServersFor("triage", cfg({ jira: { enabled: false } }))).toEqual(["chrome-devtools"]);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/engine/mcp.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/engine/mcp.ts`:

```ts
import type { AdaptConfig } from "../config/schema.ts";

export type RoleName = "runner" | "triage" | "implementation" | "verification";

/**
 * Logical MCP server names to expose to a role, filtered by config toggles.
 * Black-box roles (runner, verification) drive a browser via Playwright; white-box
 * roles (triage, implementation) use Chrome DevTools for deep inspection. Jira is
 * exposed to every role except the runner, when enabled. The runner never touches Jira.
 * Mapping these logical names to concrete `--mcp-config` paths happens at real-run
 * wiring time; Phase 1 logic + tests operate on the names.
 */
export function mcpServersFor(role: RoleName, config: AdaptConfig): string[] {
  const out: string[] = [];
  const blackBox = role === "runner" || role === "verification";
  if (blackBox) {
    if (config.mcp.playwright.enabled) out.push("playwright");
  } else {
    if (config.mcp.chromeDevTools.enabled) out.push("chrome-devtools");
  }
  if (config.mcp.jira.enabled && role !== "runner") out.push("jira");
  return out;
}
```

- [ ] **Step 4: Run** — `npx vitest run test/engine/mcp.test.ts`. Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/engine/mcp.ts test/engine/mcp.test.ts
git commit -m "feat(engine): per-role MCP server selection"
```

---

## Task 3: DB lifecycle hooks

**Files:**
- Create: `src/orchestrator/hooks.ts`
- Test: `test/orchestrator/hooks.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { runHook } from "../../src/orchestrator/hooks.ts";

describe("runHook", () => {
  it("treats an undefined command as a no-op success", () => {
    const r = runHook(undefined, process.cwd());
    expect(r.ran).toBe(false);
    expect(r.ok).toBe(true);
  });
  it("runs a shell command and captures output", () => {
    const r = runHook("echo seeded", process.cwd());
    expect(r.ran).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("seeded");
  });
  it("reports a nonzero exit as not-ok with the code", () => {
    const r = runHook("exit 3", process.cwd());
    expect(r.ok).toBe(false);
    expect(r.code).toBe(3);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/orchestrator/hooks.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/orchestrator/hooks.ts`:

```ts
import { spawnSync } from "node:child_process";

export interface HookResult {
  ran: boolean;
  ok: boolean;
  code: number;
  output: string;
}

/** Run a shell hook command in `cwd`. An undefined command is a no-op success. */
export function runHook(cmd: string | undefined, cwd: string): HookResult {
  if (!cmd) return { ran: false, ok: true, code: 0, output: "" };
  const res = spawnSync(cmd, { cwd, shell: true, encoding: "utf8" });
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const code = res.status ?? 1;
  return { ran: true, ok: code === 0, code, output };
}
```

- [ ] **Step 4: Run** — `npx vitest run test/orchestrator/hooks.test.ts`. Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/hooks.ts test/orchestrator/hooks.test.ts
git commit -m "feat(orchestrator): DB setup/teardown hook runner"
```

---

## Task 4: `runRole` — run an agent and validate its result file

**Files:**
- Create: `src/agents/runRole.ts`
- Test: `test/agents/runRole.test.ts`

The uniform seam every Phase 1 role uses. It clears any stale result file first (so a previous run's file can't be mistaken for this one), runs the agent (forwarding events to a sink), then reads + schema-validates the result.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { runRole } from "../../src/agents/runRole.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

const Schema = z.object({ n: z.number() });

// A stub engine whose script writes `payload` (if not null) to the RESULT_FILE path in the prompt.
function engineWriting(payload: unknown | null) {
  return new StubEngine({
    script: (spec) => {
      if (payload !== null) {
        const m = spec.prompt.match(/RESULT_FILE=(.+)/);
        if (m) writeFileSync(m[1]!.trim(), JSON.stringify(payload), "utf8");
      }
      return [{ kind: "agent.exit", role: spec.role, at: "t", exitCode: 0 }];
    },
  });
}

describe("runRole", () => {
  it("returns ok with the validated value when the agent writes a valid result", async () => {
    dir = makeTmpDir();
    const file = join(dir, "out.json");
    const spec = { role: "x", prompt: `do it\nRESULT_FILE=${file}`, cwd: dir };
    const r = await runRole(engineWriting({ n: 42 }), spec, file, Schema, () => {});
    expect(r.status).toBe("ok");
    expect(r.value).toEqual({ n: 42 });
  });

  it("returns missing when no result file is written", async () => {
    dir = makeTmpDir();
    const file = join(dir, "out.json");
    const spec = { role: "x", prompt: `do it\nRESULT_FILE=${file}`, cwd: dir };
    const r = await runRole(engineWriting(null), spec, file, Schema, () => {});
    expect(r.status).toBe("missing");
  });

  it("returns invalid when the result fails the schema", async () => {
    dir = makeTmpDir();
    const file = join(dir, "out.json");
    const spec = { role: "x", prompt: `do it\nRESULT_FILE=${file}`, cwd: dir };
    const r = await runRole(engineWriting({ wrong: true }), spec, file, Schema, () => {});
    expect(r.status).toBe("invalid");
  });

  it("clears a stale result file before running (no false carry-over)", async () => {
    dir = makeTmpDir();
    const file = join(dir, "out.json");
    writeFileSync(file, JSON.stringify({ n: 999 }), "utf8"); // stale from a prior run
    const spec = { role: "x", prompt: `do it\nRESULT_FILE=${file}`, cwd: dir };
    const r = await runRole(engineWriting(null), spec, file, Schema, () => {});
    expect(r.status).toBe("missing");
  });

  it("forwards agent events to the sink", async () => {
    dir = makeTmpDir();
    const file = join(dir, "out.json");
    const kinds: string[] = [];
    const spec = { role: "x", prompt: `do it\nRESULT_FILE=${file}`, cwd: dir };
    await runRole(engineWriting({ n: 1 }), spec, file, Schema, (e) => kinds.push(e.kind));
    expect(kinds).toContain("agent.exit");
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/agents/runRole.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/agents/runRole.ts`:

```ts
import { existsSync, readFileSync, rmSync } from "node:fs";
import type { ZodType } from "zod";
import type { AgentEngine, AgentEvent, AgentSpec } from "../engine/types.ts";
import { runAgent } from "../engine/runAgent.ts";

export interface RoleOutcome<T> {
  status: "ok" | "missing" | "invalid";
  value?: T;
  error?: string;
  exitCode: number;
}

/**
 * Run an agent for a role, then read + validate the result file it was asked to write.
 * Clears any stale result file first so a prior run's output can't be mistaken for this one.
 */
export async function runRole<T>(
  engine: AgentEngine,
  spec: AgentSpec,
  resultFile: string,
  schema: ZodType<T>,
  sink: (e: AgentEvent) => void,
): Promise<RoleOutcome<T>> {
  if (existsSync(resultFile)) rmSync(resultFile);

  const res = await runAgent(engine, spec, sink);

  if (!existsSync(resultFile)) return { status: "missing", exitCode: res.exitCode };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resultFile, "utf8"));
  } catch (e) {
    return { status: "invalid", error: `result is not JSON: ${(e as Error).message}`, exitCode: res.exitCode };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { status: "invalid", error: parsed.error.message, exitCode: res.exitCode };
  return { status: "ok", value: parsed.data, exitCode: res.exitCode };
}
```

- [ ] **Step 4: Run** — `npx vitest run test/agents/runRole.test.ts`. Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agents/runRole.ts test/agents/runRole.test.ts
git commit -m "feat(agents): runRole — run an agent and validate its result file"
```

---

## Task 5: Runner prompt

**Files:**
- Create: `src/agents/prompts/runner.ts`
- Test: `test/agents/runnerPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { runnerPrompt } from "../../src/agents/prompts/runner.ts";
import { parseScenario } from "../../src/scenarios/parse.ts";

const scenario = parseScenario(`---
id: SCN-001
title: A user can log in
status: ready
priority: high
persona: Returning user
tags: [auth]
source: human-seeded
---
As a returning user, log in and land on the home page.

## Expected outcome
- The home page is shown.
`, "auth.login.md");

describe("runnerPrompt", () => {
  it("includes the scenario, app URL, the RESULT_FILE contract, and a black-box instruction", () => {
    const p = runnerPrompt({ scenario, appBaseUrl: "http://localhost:3000", resultPath: "/repo/.adapt/scenario-runs/RUN-1.agent.json", runId: "RUN-1" });
    expect(p).toContain("SCN-001");
    expect(p).toContain("A user can log in");
    expect(p).toContain("http://localhost:3000");
    expect(p).toContain("RESULT_FILE=/repo/.adapt/scenario-runs/RUN-1.agent.json");
    expect(p.toLowerCase()).toContain("do not");        // black-box: no source access
    expect(p).toContain("passed");                       // verdict vocabulary
    expect(p).toContain("RUN-1");
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/agents/runnerPrompt.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/agents/prompts/runner.ts`:

```ts
import type { ParsedScenario } from "../../scenarios/parse.ts";

export interface RunnerPromptCtx {
  scenario: ParsedScenario;
  appBaseUrl: string;
  resultPath: string;
  runId: string;
}

/** Prompt for the black-box Scenario Runner agent. */
export function runnerPrompt(ctx: RunnerPromptCtx): string {
  const { scenario, appBaseUrl, resultPath, runId } = ctx;
  return `You are a black-box QA runner. You behave exactly like the user described below.
You do NOT have access to the source code. Do NOT read the repository. Interact only through the browser
(Playwright MCP) against the running app at ${appBaseUrl}.

SCENARIO ${scenario.meta.id}: ${scenario.meta.title}
Persona: ${scenario.meta.persona}

${scenario.body}

Execute the steps as this user would. Judge the outcome HONESTLY:
- "passed" ONLY if the visible expected outcome is genuinely achieved.
- "failed" if a step is impossible, an error appears, or the expected outcome is not visible.
- "blocked" if you cannot even begin (e.g., cannot reach the app / log in with the given data).
- "flaky" if behavior differs across repeats; "invalid" if the scenario references something that no longer exists.
Capture evidence: which step failed, what you actually saw vs expected, browser console errors, failed network requests.

When finished you MUST write your verdict as a single JSON object to this exact path:
RESULT_FILE=${resultPath}

The JSON must conform to the RunRecord schema:
{ "runId": "${runId}", "scenarioId": "${scenario.meta.id}", "scenarioTitle": ${JSON.stringify(scenario.meta.title)},
  "status": "passed|failed|blocked|flaky|invalid|inconclusive",
  "startedAt": "<iso>", "finishedAt": "<iso>", "appBaseUrl": "${appBaseUrl}",
  "appVersion": null, "environment": "local", "stepsExecuted": <int>, "failureStep": <int|null>,
  "expectedOutcome": "<text>", "actualOutcome": "<text>",
  "consoleErrors": [], "networkErrors": [], "screenshots": [], "artifacts": [],
  "linkedJiraIssue": null, "runnerNotes": "<short notes>" }
Write the file before you finish. Do not guess a pass.`;
}
```

- [ ] **Step 4: Run** — `npx vitest run test/agents/runnerPrompt.test.ts`. Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/agents/prompts/runner.ts test/agents/runnerPrompt.test.ts
git commit -m "feat(agents): runner prompt with RESULT_FILE contract"
```

---

## Task 6: `runScenario` + `runReadyScenarios`

**Files:**
- Create: `src/orchestrator/runScenario.ts`
- Test: `test/orchestrator/runScenario.test.ts`

Ties it together: createRun → setup hook → Runner agent (`runRole`) → finalize via `recordResult` → teardown hook. The agent writes to `<runId>.agent.json` (distinct from the ledger's `<runId>.json`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { StateStore } from "../../src/orchestrator/store.ts";
import { Orchestrator } from "../../src/orchestrator/orchestrator.ts";
import { AdaptConfigSchema } from "../../src/config/schema.ts";
import { parseScenario } from "../../src/scenarios/parse.ts";
import { runScenario } from "../../src/orchestrator/runScenario.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function scenario(hooks = "") {
  return parseScenario(`---
id: SCN-001
title: Login works
status: ready
priority: high
persona: User
tags: [auth]
source: human-seeded
${hooks}---
Log in and see the home page.
`, "auth.login.md");
}

function setup(opts: { engine: any; hooks?: string }) {
  dir = makeTmpDir();
  mkdirSync(join(dir, ".adapt", "scenario-runs"), { recursive: true });
  const store = new StateStore(":memory:");
  const orchestrator = new Orchestrator({
    targetRepo: dir, store, appBaseUrl: "http://localhost:3000",
    limits: { maxFixAttempts: 2, maxVerificationAttempts: 3, maxItemsPerRun: 10, maxCycleSeconds: 3600 },
    clock: () => "2026-05-26T10:00:00.000Z", now: () => new Date("2026-05-26T10:00:00.000Z"),
  });
  const config = AdaptConfigSchema.parse({ targetRepoPath: dir, appBaseUrl: "http://localhost:3000" });
  return { dir: dir!, orchestrator, config, engine: opts.engine, store };
}

// Stub whose script writes a RunRecord with `status` to the prompt's RESULT_FILE, or nothing if status===null.
function runnerEngine(status: string | null) {
  return new StubEngine({
    script: (spec) => {
      if (status !== null) {
        const m = spec.prompt.match(/RESULT_FILE=(.+)/);
        const path = m![1]!.trim();
        writeFileSync(path, JSON.stringify({
          runId: "ignored", scenarioId: "SCN-001", scenarioTitle: "Login works", status,
          startedAt: "t", finishedAt: "t", appBaseUrl: "http://localhost:3000", appVersion: null,
          environment: "local", stepsExecuted: 3, failureStep: status === "failed" ? 2 : null,
          expectedOutcome: "home page", actualOutcome: status === "failed" ? "error toast" : "home page",
          consoleErrors: [], networkErrors: [], screenshots: [], artifacts: [], linkedJiraIssue: null, runnerNotes: "ok",
        }), "utf8");
      }
      return [{ kind: "agent.exit", role: spec.role, at: "t", exitCode: 0 }];
    },
  });
}

describe("runScenario", () => {
  it("records a passed verdict and writes the ledger file", async () => {
    const d = setup({ engine: runnerEngine("passed") });
    const rec = await runScenario({ ...d, targetRepo: d.dir, sink: () => {} }, scenario());
    expect(rec.status).toBe("passed");
    expect(rec.failureStep).toBeNull();
    expect(existsSync(join(d.dir, ".adapt", "scenario-runs", `${rec.runId}.json`))).toBe(true);
  });

  it("records a failed verdict with the failing step", async () => {
    const d = setup({ engine: runnerEngine("failed") });
    const rec = await runScenario({ ...d, targetRepo: d.dir, sink: () => {} }, scenario());
    expect(rec.status).toBe("failed");
    expect(rec.failureStep).toBe(2);
  });

  it("resolves to inconclusive when the agent writes no result", async () => {
    const d = setup({ engine: runnerEngine(null) });
    const rec = await runScenario({ ...d, targetRepo: d.dir, sink: () => {} }, scenario());
    expect(rec.status).toBe("inconclusive");
  });

  it("blocks the run (agent never runs) when the setup hook fails", async () => {
    let invoked = false;
    const engine = new StubEngine({ script: () => { invoked = true; return [{ kind: "agent.exit", role: "runner", at: "t", exitCode: 0 }]; } });
    const d = setup({ engine });
    const rec = await runScenario({ ...d, targetRepo: d.dir, sink: () => {} }, scenario("hooks:\n  setup: exit 7\n"));
    expect(rec.status).toBe("blocked");
    expect(invoked).toBe(false);
    expect(rec.runnerNotes).toContain("setup hook");
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/orchestrator/runScenario.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/orchestrator/runScenario.ts`:

```ts
import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { AgentEngine, AgentEvent } from "../engine/types.ts";
import type { Orchestrator } from "./orchestrator.ts";
import type { AdaptConfig } from "../config/schema.ts";
import { workspacePaths } from "../workspace/paths.ts";
import { parseScenario, type ParsedScenario } from "../scenarios/parse.ts";
import { rebuildRegistry } from "../scenarios/registry.ts";
import { RunRecordSchema, type RunRecord } from "./runRecord.ts";
import { runRole } from "../agents/runRole.ts";
import { runnerPrompt } from "../agents/prompts/runner.ts";
import { mcpServersFor } from "../engine/mcp.ts";
import { runHook } from "./hooks.ts";

export interface RunScenarioDeps {
  engine: AgentEngine;
  orchestrator: Orchestrator;
  config: AdaptConfig;
  targetRepo: string;
  sink: (e: AgentEvent) => void;
}

/** Run one scenario end-to-end. Always returns the finalized RunRecord (never throws on agent failure). */
export async function runScenario(deps: RunScenarioDeps, scenario: ParsedScenario): Promise<RunRecord> {
  const { engine, orchestrator, config, targetRepo, sink } = deps;
  const ws = workspacePaths(targetRepo);
  const run = orchestrator.createRun(scenario.meta.id, scenario.meta.title);

  const setup = runHook(scenario.meta.hooks?.setup ?? config.hooks.setup, targetRepo);
  if (!setup.ok) {
    return orchestrator.recordResult(run.runId, {
      status: "blocked",
      runnerNotes: `setup hook failed (exit ${setup.code}): ${setup.output.slice(0, 500)}`,
    });
  }

  orchestrator.advanceRun(run.runId, "running");
  const resultPath = join(ws.runsDir, `${run.runId}.agent.json`);
  const outcome = await runRole(
    engine,
    {
      role: "runner",
      prompt: runnerPrompt({ scenario, appBaseUrl: config.appBaseUrl, resultPath, runId: run.runId }),
      cwd: targetRepo,
      mcpServers: mcpServersFor("runner", config),
    },
    resultPath,
    RunRecordSchema,
    sink,
  );

  // Teardown always runs, even if the run failed.
  runHook(scenario.meta.hooks?.teardown ?? config.hooks.teardown, targetRepo);

  if (outcome.status !== "ok" || !outcome.value) {
    return orchestrator.recordResult(run.runId, {
      status: "inconclusive",
      runnerNotes: `runner produced no valid result (${outcome.status}${outcome.error ? `: ${outcome.error}` : ""})`,
    });
  }

  const v = outcome.value;
  return orchestrator.recordResult(run.runId, {
    status: v.status,
    failureStep: v.failureStep,
    expectedOutcome: v.expectedOutcome,
    actualOutcome: v.actualOutcome,
    consoleErrors: v.consoleErrors,
    networkErrors: v.networkErrors,
    screenshots: v.screenshots,
    artifacts: v.artifacts,
    runnerNotes: v.runnerNotes,
  });
}

/** Run every registered scenario (or one, by id). Returns the finalized records. */
export async function runReadyScenarios(deps: RunScenarioDeps & { scenarioId?: string }): Promise<RunRecord[]> {
  const ws = workspacePaths(deps.targetRepo);
  const entries = rebuildRegistry(deps.targetRepo);
  const selected = deps.scenarioId ? entries.filter((e) => e.id === deps.scenarioId) : entries;
  const records: RunRecord[] = [];
  for (const e of selected) {
    const scenario = parseScenario(readFileSync(join(ws.scenariosDir, e.filename), "utf8"), e.filename);
    records.push(await runScenario(deps, scenario));
  }
  return records;
}
```

- [ ] **Step 4: Run** — `npx vitest run test/orchestrator/runScenario.test.ts`. Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/runScenario.ts test/orchestrator/runScenario.test.ts
git commit -m "feat(orchestrator): runScenario — hooks + runner agent + record"
```

---

## Task 7: `adapt run-scenarios` CLI + full verification

**Files:**
- Create: `src/cli/commands/runScenarios.ts`
- Modify: `src/cli/index.ts`
- Test: `test/cli/runScenarios.test.ts`

`runReadyScenariosCmd` is the testable core (engine injected); the CLI wraps it, choosing the real engine from config.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { runReadyScenariosCmd } from "../../src/cli/commands/runScenarios.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function seed() {
  dir = makeTmpDir();
  const scn = join(dir, ".adapt", "scenarios");
  mkdirSync(join(dir, ".adapt", "scenario-runs"), { recursive: true });
  mkdirSync(scn, { recursive: true });
  writeFileSync(join(dir, ".adapt", "config.json"), JSON.stringify({ targetRepoPath: dir, appBaseUrl: "http://localhost:3000" }), "utf8");
  for (const id of ["SCN-001", "SCN-002"]) {
    writeFileSync(join(scn, `${id}.md`), `---\nid: ${id}\ntitle: ${id}\nstatus: ready\npriority: medium\npersona: User\ntags: [smoke]\nsource: human-seeded\n---\nbody`, "utf8");
  }
  return dir!;
}

function passEngine() {
  return new StubEngine({ script: (spec) => {
    const m = spec.prompt.match(/RESULT_FILE=(.+)/);
    const sid = spec.prompt.match(/SCENARIO (SCN-\d+)/)![1];
    writeFileSync(m![1]!.trim(), JSON.stringify({
      runId: "x", scenarioId: sid, scenarioTitle: sid, status: "passed", startedAt: "t", finishedAt: "t",
      appBaseUrl: "http://localhost:3000", appVersion: null, environment: "local", stepsExecuted: 1,
      failureStep: null, expectedOutcome: "x", actualOutcome: "x", consoleErrors: [], networkErrors: [],
      screenshots: [], artifacts: [], linkedJiraIssue: null, runnerNotes: "" }), "utf8");
    return [{ kind: "agent.exit", role: spec.role, at: "t", exitCode: 0 }];
  }});
}

describe("runReadyScenariosCmd", () => {
  it("runs all scenarios and returns a summary", async () => {
    const repo = seed();
    const res = await runReadyScenariosCmd({ targetRepo: repo, engine: passEngine(), log: () => {} });
    expect(res.code).toBe(0);
    expect(res.records.length).toBe(2);
    expect(res.records.every((r) => r.status === "passed")).toBe(true);
  });

  it("runs a single scenario when given an id", async () => {
    const repo = seed();
    const res = await runReadyScenariosCmd({ targetRepo: repo, scenarioId: "SCN-002", engine: passEngine(), log: () => {} });
    expect(res.records.length).toBe(1);
    expect(res.records[0]!.scenarioId).toBe("SCN-002");
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/cli/runScenarios.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/cli/commands/runScenarios.ts`:

```ts
import type { AgentEngine } from "../../engine/types.ts";
import { StubEngine } from "../../engine/stubEngine.ts";
import { ClaudeCodeEngine } from "../../engine/claudeCode.ts";
import { StateStore } from "../../orchestrator/store.ts";
import { Orchestrator } from "../../orchestrator/orchestrator.ts";
import { loadConfig } from "../../config/load.ts";
import { workspacePaths } from "../../workspace/paths.ts";
import { runReadyScenarios, type RunScenarioDeps } from "../../orchestrator/runScenario.ts";
import type { RunRecord } from "../../orchestrator/runRecord.ts";

export interface RunScenariosCmdOptions {
  targetRepo: string;
  scenarioId?: string;
  engine?: AgentEngine;            // injected in tests; real one chosen from config otherwise
  log?: (msg: string) => void;
}

export interface RunScenariosCmdResult { code: number; records: RunRecord[]; }

/** Core of `adapt run-scenarios`. */
export async function runReadyScenariosCmd(opts: RunScenariosCmdOptions): Promise<RunScenariosCmdResult> {
  const log = opts.log ?? console.log;
  const config = loadConfig(opts.targetRepo);
  const ws = workspacePaths(opts.targetRepo);
  const engine = opts.engine ?? (config.engine.type === "stub" ? new StubEngine() : new ClaudeCodeEngine({ command: config.engine.command }));
  const store = new StateStore(`${ws.root}/state.db`);
  const orchestrator = new Orchestrator({
    targetRepo: opts.targetRepo, store, appBaseUrl: config.appBaseUrl,
    limits: config.limits,
  });
  const deps: RunScenarioDeps & { scenarioId?: string } = {
    engine, orchestrator, config, targetRepo: opts.targetRepo, sink: () => {}, scenarioId: opts.scenarioId,
  };
  const records = await runReadyScenarios(deps);
  for (const r of records) log(`  ${r.status.padEnd(12)} ${r.scenarioId}  ${r.scenarioTitle}`);
  log(`\n${records.length} scenario(s) run.`);
  store.close();
  return { code: 0, records };
}
```

- [ ] **Step 4: Register the command — modify `src/cli/index.ts`** — add this block immediately before the final `program.parseAsync(process.argv);`:

```ts
program
  .command("run-scenarios")
  .description("Run ready scenarios against the target app")
  .argument("<targetRepo>", "path to the target product repository")
  .option("--scenario <id>", "run a single scenario by id (e.g. SCN-001)")
  .action(async (targetRepo: string, options: { scenario?: string }) => {
    const { runReadyScenariosCmd } = await import("./commands/runScenarios.ts");
    const res = await runReadyScenariosCmd({ targetRepo, scenarioId: options.scenario });
    process.exit(res.code);
  });
```

- [ ] **Step 5: Run + full suite + typecheck** — `npx vitest run test/cli/runScenarios.test.ts` (PASS, 2 tests), then `npx vitest run` (ALL pass) and `npm run typecheck` (exit 0). Report all. If typecheck errors, report BLOCKED with exact text.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/runScenarios.ts src/cli/index.ts test/cli/runScenarios.test.ts
git commit -m "feat(cli): adapt run-scenarios"
```

---

## Self-Review (completed during authoring)

- **Spec coverage (Plan 4 scope):** result-file contract → Tasks 4, 6 (`runRole` + `RunRecordSchema`); black-box runner with Playwright MCP + no source → Tasks 2, 5; DB hooks around the run → Tasks 3, 6; missing/invalid → inconclusive, setup-fail → blocked → Task 6; orchestrator finalizes via `recordResult` (validated transition, ledger) → Task 6; CLI → Task 7. Verdict honesty / evidence capture lives in the runner prompt (Task 5).
- **Type consistency:** `RunScenarioDeps` is the shared dependency bag (engine, orchestrator, config, targetRepo, sink) reused by `runScenario` and `runReadyScenarios`. `runRole` returns `RoleOutcome<T>`. The agent result path is `<runId>.agent.json` (distinct from the ledger's `<runId>.json`). `mcpServersFor` takes `RoleName`. These names recur unchanged in Plans 5–6.
- **Reused-not-redefined:** `RunRecord`/`RunRecordSchema`, `Orchestrator.recordResult`, `rebuildRegistry`, `parseScenario`, `workspacePaths`, `StubEngine`, `runAgent` — all Phase 0.
- **Note:** `store.db` lives in the target repo's `.adapt/` (add `/.adapt/state.db*` to the target's `.gitignore` at first real run — blueprint note).

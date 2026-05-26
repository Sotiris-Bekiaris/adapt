# Phase 3 · Plan 11 — Graduation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scenario that passes `gradPassThreshold` consecutive times is *proven*; a Grad agent writes a deterministic Playwright spec into the target's test dir, the scenario is marked `graduated`, and the LLM Runner never runs it again.

**Architecture:** The cycle tracks consecutive passes per scenario (new `scenario_passes` store table). After the run/triage/repair stages, `graduateProven` finds proven, non-graduated scenarios, has the Grad agent write a `<id>.spec.ts` (deliverable is the file, validated by Node), and flips the scenario file's frontmatter `status` to `graduated`. `runReadyScenarios` already excludes anything outside `ready/active/regression`, so graduated scenarios are skipped automatically. Stub-tested.

**Tech Stack:** Builds on Phases 0–2 + Plan 10. Uses `gray-matter` (already a dep) to rewrite scenario frontmatter.

**Depends on:** Plan 10 (the robust `runCycle`). Reuses `runAgent`, `mcpServersFor`, `parseScenario`, `rebuildRegistry`, `StateStore`, `workspacePaths`.

---

## File Structure

```
src/config/schema.ts            # MODIFY: limits.gradPassThreshold (default 3); playwrightTestDir (default "tests/adapt")
src/types.ts                    # MODIFY: add "graduated" scenario status
src/orchestrator/lifecycles.ts  # MODIFY: SCENARIO_TRANSITIONS gains "graduated"
src/engine/mcp.ts               # MODIFY: "graduation" role -> chrome-devtools
src/orchestrator/store.ts       # MODIFY: scenario_passes table + get/increment/reset methods
src/scenarios/update.ts         # NEW: setScenarioStatus(scenariosDir, filename, status)
src/agents/prompts/graduation.ts # NEW: graduationPrompt(ctx)
src/orchestrator/graduate.ts    # NEW: graduateProven(deps) -> graduated ids
src/orchestrator/cycle.ts       # MODIFY: pass-tracking + graduateProven; CycleSummary.graduated
test/... (one per change)
```

---

## Task 1: Config — graduation knobs

**Files:** Modify `src/config/schema.ts`, `test/config/schema.test.ts`

- [ ] **Step 1: Add a failing test** — inside `describe("AdaptConfigSchema", ...)`:

```ts
  it("defaults the graduation knobs", () => {
    const c = AdaptConfigSchema.parse({ targetRepoPath: "/repo", appBaseUrl: "http://localhost:3000" });
    expect(c.limits.gradPassThreshold).toBe(3);
    expect(c.playwrightTestDir).toBe("tests/adapt");
  });
```

- [ ] **Step 2: Run** — `npx vitest run test/config/schema.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — in `src/config/schema.ts`: add `gradPassThreshold: z.number().int().positive().default(3),` to the `limits` object (alongside the existing limits), and add a top-level field to the schema object (e.g. right after `appBaseUrl`):

```ts
  playwrightTestDir: z.string().default("tests/adapt"),
```

- [ ] **Step 4: Run** — `npx vitest run test/config/schema.test.ts` (PASS), then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts test/config/schema.test.ts
git commit -m "feat(config): graduation knobs (gradPassThreshold, playwrightTestDir)"
```

---

## Task 2: `graduated` scenario status

**Files:** Modify `src/types.ts`, `src/orchestrator/lifecycles.ts`, `test/orchestrator/lifecycles.test.ts`

- [ ] **Step 1: Add a failing test** — in `test/orchestrator/lifecycles.test.ts`, inside the existing describe:

```ts
  it("scenarios can graduate (terminal in the LLM loop)", () => {
    expect(SCENARIO_TRANSITIONS.regression).toContain("graduated");
    expect(SCENARIO_TRANSITIONS.passed).toContain("graduated");
    expect(SCENARIO_TRANSITIONS["graduated"]).toEqual([]);
  });
```

- [ ] **Step 2: Run** — `npx vitest run test/orchestrator/lifecycles.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** —
  In `src/types.ts`, add `"graduated"` to `SCENARIO_STATUSES` (append before the closing `] as const;`):

```ts
export const SCENARIO_STATUSES = [
  "draft", "ready", "active", "running", "passed", "regression",
  "failed", "item-created", "awaiting-fix", "ready-for-verification",
  "verified", "blocked", "invalid", "needs-product-review", "deprecated", "graduated",
] as const;
```

  In `src/orchestrator/lifecycles.ts`, update `SCENARIO_TRANSITIONS`: add `"graduated"` to the `passed`, `regression`, and `verified` arrays, and add a terminal `graduated` key. The relevant entries become:

```ts
  passed: ["regression", "ready", "graduated"],
  regression: ["ready", "running", "graduated"],
  verified: ["regression", "graduated"],
  // ... (other entries unchanged) ...
  graduated: [],
```

(Keep every other `SCENARIO_TRANSITIONS` entry exactly as it was; just add the three `"graduated"` members and the new `graduated: []` key so the `Transitions<ScenarioStatus>` record stays exhaustive.)

- [ ] **Step 4: Run** — `npx vitest run test/orchestrator/lifecycles.test.ts` (PASS), then `npx vitest run` (the scenario schema now accepts `graduated` — confirm no regressions) and `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/orchestrator/lifecycles.ts test/orchestrator/lifecycles.test.ts
git commit -m "feat(orchestrator): add graduated scenario status + transitions"
```

---

## Task 3: MCP graduation role

**Files:** Modify `src/engine/mcp.ts`, `test/engine/mcp.test.ts`

- [ ] **Step 1: Add a failing test** — inside `describe("mcpServersFor", ...)`:

```ts
  it("graduation gets chrome-devtools and never jira", () => {
    expect(mcpServersFor("graduation", cfg({ jira: { enabled: true } }))).toEqual(["chrome-devtools"]);
  });
```

- [ ] **Step 2: Run** — `npx vitest run test/engine/mcp.test.ts`. Expected: FAIL (type error).

- [ ] **Step 3: Implement** — in `src/engine/mcp.ts`: add `"graduation"` to the `RoleName` union, and add it to the chrome-devtools branch condition. The `RoleName` becomes:

```ts
export type RoleName =
  | "runner" | "triage" | "implementation" | "verification"
  | "dreamer" | "critic" | "generator" | "graduation";
```

and the chrome-devtools branch condition becomes:

```ts
  } else if (role === "triage" || role === "implementation" || role === "dreamer" || role === "generator" || role === "graduation") {
    if (config.mcp.chromeDevTools.enabled) out.push("chrome-devtools");
  }
```

(The `jiraRoles` list stays `["triage", "implementation", "verification"]` — graduation never gets Jira.)

- [ ] **Step 4: Run** — `npx vitest run test/engine/mcp.test.ts` (PASS), then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/engine/mcp.ts test/engine/mcp.test.ts
git commit -m "feat(engine): MCP mapping for the graduation role"
```

---

## Task 4: `scenario_passes` store

**Files:** Modify `src/orchestrator/store.ts`, `test/orchestrator/store.test.ts`

- [ ] **Step 1: Add a failing test** — in `test/orchestrator/store.test.ts`, inside `describe("StateStore", ...)`:

```ts
  it("tracks consecutive scenario passes", () => {
    const s = mem();
    expect(s.getScenarioPasses("SCN-001")).toBe(0);
    expect(s.incrementScenarioPasses("SCN-001")).toBe(1);
    expect(s.incrementScenarioPasses("SCN-001")).toBe(2);
    s.resetScenarioPasses("SCN-001");
    expect(s.getScenarioPasses("SCN-001")).toBe(0);
    s.close();
  });
```

- [ ] **Step 2: Run** — `npx vitest run test/orchestrator/store.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — in `src/orchestrator/store.ts`:
  Add a table to the `migrate()` `exec` block (append inside the same template string):

```sql
      CREATE TABLE IF NOT EXISTS scenario_passes (
        scenarioId TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0
      );
```

  And add these methods to the `StateStore` class (next to `getAttempts`):

```ts
  getScenarioPasses(scenarioId: string): number {
    const row = this.db.prepare(`SELECT count FROM scenario_passes WHERE scenarioId = ?`).get(scenarioId) as
      | { count: number } | undefined;
    return row?.count ?? 0;
  }

  incrementScenarioPasses(scenarioId: string): number {
    this.db.prepare(`
      INSERT INTO scenario_passes (scenarioId, count) VALUES (?, 1)
      ON CONFLICT(scenarioId) DO UPDATE SET count = count + 1
    `).run(scenarioId);
    return this.getScenarioPasses(scenarioId);
  }

  resetScenarioPasses(scenarioId: string): void {
    this.db.prepare(`
      INSERT INTO scenario_passes (scenarioId, count) VALUES (?, 0)
      ON CONFLICT(scenarioId) DO UPDATE SET count = 0
    `).run(scenarioId);
  }
```

- [ ] **Step 4: Run** — `npx vitest run test/orchestrator/store.test.ts` (PASS), then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/store.ts test/orchestrator/store.test.ts
git commit -m "feat(orchestrator): scenario_passes consecutive-pass tracking"
```

---

## Task 5: `setScenarioStatus`

**Files:** Create `src/scenarios/update.ts`; Test `test/scenarios/update.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { setScenarioStatus } from "../../src/scenarios/update.ts";
import { parseScenario } from "../../src/scenarios/parse.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

describe("setScenarioStatus", () => {
  it("rewrites only the status, preserving id/body, and re-parses", () => {
    dir = makeTmpDir();
    mkdirSync(dir, { recursive: true });
    const file = "SCN-001.md";
    writeFileSync(join(dir, file), `---\nid: SCN-001\ntitle: Login\nstatus: regression\npriority: high\npersona: User\ntags: [auth]\nsource: agent-discovered\n---\n# Scenario\nLog in.\n`, "utf8");
    setScenarioStatus(dir, file, "graduated");
    const parsed = parseScenario(readFileSync(join(dir, file), "utf8"), file);
    expect(parsed.meta.status).toBe("graduated");
    expect(parsed.meta.id).toBe("SCN-001");
    expect(parsed.body).toContain("Log in.");
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/scenarios/update.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — `src/scenarios/update.ts`:

```ts
import matter from "gray-matter";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ScenarioStatus } from "../types.ts";

/** Rewrite a scenario file's frontmatter `status` in place, preserving everything else. */
export function setScenarioStatus(scenariosDir: string, filename: string, status: ScenarioStatus): void {
  const path = join(scenariosDir, filename);
  const parsed = matter(readFileSync(path, "utf8"));
  parsed.data.status = status;
  writeFileSync(path, matter.stringify(parsed.content, parsed.data), "utf8");
}
```

- [ ] **Step 4: Run** — `npx vitest run test/scenarios/update.test.ts`. Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/scenarios/update.ts test/scenarios/update.test.ts
git commit -m "feat(scenarios): setScenarioStatus (rewrite frontmatter status in place)"
```

---

## Task 6: Graduation prompt

**Files:** Create `src/agents/prompts/graduation.ts`; Test `test/agents/graduationPrompt.test.ts`

The Grad agent writes a Playwright spec file directly (deliverable is the file), so there is no result schema — Node validates the file at the expected path.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { graduationPrompt } from "../../src/agents/prompts/graduation.ts";
import { parseScenario } from "../../src/scenarios/parse.ts";

const scenario = parseScenario(`---
id: SCN-001
title: A user can log in
status: regression
priority: high
persona: Returning user
tags: [auth]
source: agent-discovered
---
# Scenario
Log in and land on the home page.

## Expected outcome
- The home page is shown.
`, "auth.login.md");

describe("graduationPrompt", () => {
  it("names the scenario, the app URL, the SPEC_FILE path, and asks for a Playwright test", () => {
    const p = graduationPrompt({ scenario, appBaseUrl: "http://localhost:3000", specPath: "/repo/tests/adapt/SCN-001.spec.ts" });
    expect(p).toContain("SCN-001");
    expect(p).toContain("A user can log in");
    expect(p).toContain("http://localhost:3000");
    expect(p).toContain("SPEC_FILE=/repo/tests/adapt/SCN-001.spec.ts");
    expect(p.toLowerCase()).toContain("playwright");
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/agents/graduationPrompt.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — `src/agents/prompts/graduation.ts`:

```ts
import type { ParsedScenario } from "../../scenarios/parse.ts";

export interface GraduationPromptCtx {
  scenario: ParsedScenario;
  appBaseUrl: string;
  specPath: string;
}

/** Prompt for the Grad agent: freeze a proven scenario into a deterministic Playwright spec. */
export function graduationPrompt(ctx: GraduationPromptCtx): string {
  const { scenario, appBaseUrl, specPath } = ctx;
  return `You are the Graduation agent. The scenario below has passed reliably, many times. Freeze it into a
DETERMINISTIC Playwright test so it can run cheaply in CI without an LLM. You may read the source code and explore the
running app (Chrome DevTools MCP) to find robust selectors, but do NOT change product code or the scenario.

SCENARIO ${scenario.meta.id}: ${scenario.meta.title}
Persona: ${scenario.meta.persona}

${scenario.body}

Write a single Playwright test (TypeScript, @playwright/test) that drives the app at ${appBaseUrl} through the scenario's
steps and asserts the visible expected outcome. Prefer role/text/accessibility-based locators over brittle CSS. Add an
explicit wait for the success condition. The test must be self-contained and deterministic.

Write the test to this exact path:
SPEC_FILE=${specPath}
Write the file before you finish.`;
}
```

- [ ] **Step 4: Run** — `npx vitest run test/agents/graduationPrompt.test.ts`. Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/agents/prompts/graduation.ts test/agents/graduationPrompt.test.ts
git commit -m "feat(agents): graduation prompt (proven scenario -> Playwright spec)"
```

---

## Task 7: `graduateProven`

**Files:** Create `src/orchestrator/graduate.ts`; Test `test/orchestrator/graduate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { StateStore } from "../../src/orchestrator/store.ts";
import { AdaptConfigSchema } from "../../src/config/schema.ts";
import { graduateProven } from "../../src/orchestrator/graduate.ts";
import { parseScenario } from "../../src/scenarios/parse.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function ctx(over = {}) {
  dir = makeTmpDir();
  mkdirSync(join(dir, ".adapt", "scenarios"), { recursive: true });
  writeFileSync(join(dir, ".adapt", "scenarios", "SCN-001.md"), `---\nid: SCN-001\ntitle: Login\nstatus: regression\npriority: high\npersona: User\ntags: [auth]\nsource: agent-discovered\n---\n# Scenario\nLog in.\n`, "utf8");
  const store = new StateStore(":memory:");
  const config = AdaptConfigSchema.parse({ targetRepoPath: dir, appBaseUrl: "http://x", limits: { gradPassThreshold: 3, ...over } });
  return { dir: dir!, store, config };
}

// Grad stub: writes a Playwright spec to SPEC_FILE.
function gradEngine(write = true) {
  return new StubEngine({ script: (s) => {
    if (write) {
      const p = s.prompt.match(/SPEC_FILE=(.+)/)![1]!.trim();
      writeFileSync(p, `import { test, expect } from "@playwright/test";\ntest("SCN-001", async ({ page }) => { await page.goto("/"); });\n`, "utf8");
    }
    return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
  }});
}

describe("graduateProven", () => {
  it("does nothing when no scenario has reached the pass threshold", async () => {
    const c = ctx();
    c.store.incrementScenarioPasses("SCN-001"); // 1 < 3
    const grad = await graduateProven({ engine: gradEngine(), store: c.store, config: c.config, targetRepo: c.dir, sink: () => {} });
    expect(grad).toEqual([]);
  });

  it("graduates a proven scenario: writes the spec, marks it graduated", async () => {
    const c = ctx();
    c.store.incrementScenarioPasses("SCN-001");
    c.store.incrementScenarioPasses("SCN-001");
    c.store.incrementScenarioPasses("SCN-001"); // 3 >= 3
    const grad = await graduateProven({ engine: gradEngine(), store: c.store, config: c.config, targetRepo: c.dir, sink: () => {} });
    expect(grad).toEqual(["SCN-001"]);
    expect(existsSync(join(c.dir, "tests", "adapt", "SCN-001.spec.ts"))).toBe(true);
    const meta = parseScenario(readFileSync(join(c.dir, ".adapt", "scenarios", "SCN-001.md"), "utf8"), "SCN-001.md").meta;
    expect(meta.status).toBe("graduated");
  });

  it("does not graduate (or mark) when the agent writes no spec", async () => {
    const c = ctx();
    for (let i = 0; i < 3; i++) c.store.incrementScenarioPasses("SCN-001");
    const grad = await graduateProven({ engine: gradEngine(false), store: c.store, config: c.config, targetRepo: c.dir, sink: () => {} });
    expect(grad).toEqual([]);
    const meta = parseScenario(readFileSync(join(c.dir, ".adapt", "scenarios", "SCN-001.md"), "utf8"), "SCN-001.md").meta;
    expect(meta.status).toBe("regression"); // unchanged
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/orchestrator/graduate.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — `src/orchestrator/graduate.ts`:

```ts
import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import type { AgentEngine, AgentEvent } from "../engine/types.ts";
import type { AdaptConfig } from "../config/schema.ts";
import { StateStore } from "./store.ts";
import { workspacePaths } from "../workspace/paths.ts";
import { rebuildRegistry } from "../scenarios/registry.ts";
import { parseScenario } from "../scenarios/parse.ts";
import { setScenarioStatus } from "../scenarios/update.ts";
import { runAgent } from "../engine/runAgent.ts";
import { mcpServersFor } from "../engine/mcp.ts";
import { graduationPrompt } from "../agents/prompts/graduation.ts";

export interface GraduateDeps {
  engine: AgentEngine;
  store: StateStore;
  config: AdaptConfig;
  targetRepo: string;
  sink: (e: AgentEvent) => void;
}

/** Graduate every non-graduated scenario whose consecutive passes have reached the threshold:
 *  write a deterministic Playwright spec and mark the scenario `graduated`. Returns graduated ids. */
export async function graduateProven(deps: GraduateDeps): Promise<string[]> {
  const { engine, store, config, targetRepo, sink } = deps;
  const ws = workspacePaths(targetRepo);
  const testDir = join(targetRepo, config.playwrightTestDir);
  const graduated: string[] = [];

  for (const entry of rebuildRegistry(targetRepo)) {
    if (entry.status === "graduated") continue;
    if (store.getScenarioPasses(entry.id) < config.limits.gradPassThreshold) continue;

    const scenario = parseScenario(readFileSync(join(ws.scenariosDir, entry.filename), "utf8"), entry.filename);
    const specPath = join(testDir, `${entry.id}.spec.ts`);
    mkdirSync(testDir, { recursive: true });

    await runAgent(
      engine,
      {
        role: "graduation",
        prompt: graduationPrompt({ scenario, appBaseUrl: config.appBaseUrl, specPath }),
        cwd: targetRepo,
        mcpServers: mcpServersFor("graduation", config),
      },
      sink,
    );

    if (existsSync(specPath) && readFileSync(specPath, "utf8").trim() !== "") {
      setScenarioStatus(ws.scenariosDir, entry.filename, "graduated");
      graduated.push(entry.id);
    }
  }

  rebuildRegistry(targetRepo); // refresh after status changes
  return graduated;
}
```

- [ ] **Step 4: Run** — `npx vitest run test/orchestrator/graduate.test.ts` (PASS, 3 tests), then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/graduate.ts test/orchestrator/graduate.test.ts
git commit -m "feat(orchestrator): graduateProven — proven scenarios -> Playwright specs"
```

---

## Task 8: Wire pass-tracking + graduation into `runCycle`

**Files:** Modify `src/orchestrator/cycle.ts`, `test/orchestrator/cycle.test.ts`

- [ ] **Step 1: Add a failing test** — in `test/orchestrator/cycle.test.ts`, add inside `describe("runCycle robustness", ...)` (or a new describe):

```ts
  it("graduates a scenario once it has passed the threshold consecutively", async () => {
    const c = setup();
    writeFileSync(join(c.dir, ".adapt", "scenarios", "SCN-001.md"), `---\nid: SCN-001\ntitle: Login\nstatus: ready\npriority: high\npersona: User\ntags: [a]\nsource: human-seeded\n---\nLog in.`, "utf8");
    // Engine: dreamer/critic propose nothing; runner passes SCN-001; graduation writes a spec.
    const engine = new StubEngine({ script: (s) => {
      if (s.role === "runner") { const p = s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim(); writeFileSync(p, JSON.stringify({ runId: "x", scenarioId: "SCN-001", scenarioTitle: "Login", status: "passed", startedAt: "t", finishedAt: "t", appBaseUrl: "http://x", appVersion: null, environment: "local", stepsExecuted: 1, failureStep: null, expectedOutcome: "x", actualOutcome: "x", consoleErrors: [], networkErrors: [], screenshots: [], artifacts: [], linkedJiraIssue: null, runnerNotes: "" })); }
      else if (s.role === "graduation") { const p = s.prompt.match(/SPEC_FILE=(.+)/)![1]!.trim(); writeFileSync(p, `import { test } from "@playwright/test";\ntest("x", async () => {});\n`); }
      return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
    }});
    const deps = { engine, store: c.store, config: { ...c.config, limits: { ...c.config.limits, gradPassThreshold: 2 } }, targetRepo: c.dir, sink: () => {}, emit: () => {} };
    await runCycle(deps); // pass 1 (no graduation yet)
    const after1 = await runCycle(deps); // pass 2 -> graduates
    expect(after1.graduated).toEqual(["SCN-001"]);
    const { parseScenario } = await import("../../src/scenarios/parse.ts");
    const { readFileSync } = await import("node:fs");
    expect(parseScenario(readFileSync(join(c.dir, ".adapt", "scenarios", "SCN-001.md"), "utf8"), "SCN-001.md").meta.status).toBe("graduated");
    const after2 = await runCycle(deps); // graduated -> skipped, no run
    expect(after2.runs.length).toBe(0);
  });
```

- [ ] **Step 2: Run** — `npx vitest run test/orchestrator/cycle.test.ts`. Expected: FAIL (`graduated` not on the summary; no pass-tracking/graduation).

- [ ] **Step 3: Implement** — in `src/orchestrator/cycle.ts`:
  (a) add the import: `import { graduateProven } from "./graduate.ts";`
  (b) add `graduated: string[];` to the `CycleSummary` interface.
  (c) right after `const runs = await runReadyScenarios(...)`, insert consecutive-pass tracking:

```ts
  for (const run of runs) {
    if (run.status === "passed") store.incrementScenarioPasses(run.scenarioId);
    else store.resetScenarioPasses(run.scenarioId);
  }
```

  (d) just before `return { runs, triage, repaired };`, graduate proven scenarios and include them:

```ts
  const graduated = await graduateProven({ engine, store, config, targetRepo, sink });
  return { runs, triage, repaired, graduated };
```

(Replace the existing `return { runs, triage, repaired };` with the two lines above.)

- [ ] **Step 4: Run** — `npx vitest run test/orchestrator/cycle.test.ts` (PASS — incl. the original full-pass test, which now also returns `graduated: []`). Then `npx vitest run` (the evolve/run tests consume `CycleSummary` — confirm they still pass) and `npx tsc --noEmit` (exit 0). Report all.

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/cycle.ts test/orchestrator/cycle.test.ts
git commit -m "feat(orchestrator): pass-tracking + graduate proven scenarios in the cycle"
```

---

## Self-Review (completed during authoring)

- **Spec coverage (Plan 11 / spec §5):** config knobs → Task 1; `graduated` status + transitions → Task 2; graduation MCP role → Task 3; consecutive-pass tracking → Tasks 4, 8; `setScenarioStatus` → Task 5; Grad agent prompt → Task 6; `graduateProven` (proven → spec → marked graduated, missing spec = no-op) → Task 7; wired into the cycle + selection skips graduated (via the existing runnable filter) → Task 8.
- **Type consistency:** `GraduateDeps` (engine/store/config/targetRepo/sink), `graduateProven -> string[]`, `setScenarioStatus(scenariosDir, filename, status)`, `graduationPrompt(ctx)`, store `getScenarioPasses`/`incrementScenarioPasses`/`resetScenarioPasses`, `CycleSummary.graduated: string[]`. The Grad agent uses `runAgent` (deliverable is the spec file), validated by Node at `SPEC_FILE`. `graduated` is excluded from runnable selection because `RUNNABLE_STATUSES` (Plan 4) is `ready/active/regression` only.
- **Existing-consumer impact:** `CycleSummary` gains `graduated`; `runEvolve`/`runContinuous` (Plan 12) read `.cycle` but the new field is additive. The original cycle/evolve tests still pass (they now also get `graduated: []`).
- **Deferred to Plan 12:** the `adapt run` continuous loop.

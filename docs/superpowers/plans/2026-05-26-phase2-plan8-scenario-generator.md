# Phase 2 · Plan 8 — Source-aware Scenario Generator

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn each *approved* Demand into one or more user-level, black-box scenario files that the Phase 1 spine already executes — with Node assigning collision-free scenario IDs and validating every generated file.

**Architecture:** For each approved demand, Node pre-assigns a block of fresh `SCN-###` IDs (deterministic, collision-free — Node owns identity) and runs the Generator agent, which writes scenario files at those exact paths. Node then validates each assigned-ID file (parses + ID matches), deletes anything invalid, and rebuilds the registry. The generator's deliverable IS the scenario files, so it uses `runAgent` directly (not the result-file seam). Fully stub-tested.

**Tech Stack:** Builds on Phases 0–1 + Plan 7. No new npm deps.

**Depends on:** Plan 7 (`Demand`, `LocalDemandStore`, `mcpServersFor("generator")`). Reused: `runAgent`, `parseScenario`, `rebuildRegistry`, `workspacePaths`, `AdaptConfig`, `StubEngine`.

---

## File Structure

```
src/agents/prompts/generator.ts   # generatorPrompt(ctx)
src/demand/generate.ts            # nextScenarioNumber(targetRepo); runGenerate(deps, approved)
test/agents/generatorPrompt.test.ts
test/demand/generate.test.ts
```

---

## Task 1: Generator prompt

**Files:** Create `src/agents/prompts/generator.ts`; Test `test/agents/generatorPrompt.test.ts`

The generator's output is scenario *files*, so there is no result schema — Node validates the files at the IDs it assigned.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { generatorPrompt } from "../../src/agents/prompts/generator.ts";
import { newDemand } from "../../src/demand/demand.ts";

describe("generatorPrompt", () => {
  it("names the demand, the assigned IDs, the scenarios dir, and the black-box/format rules", () => {
    const demand = newDemand({ id: "DMD-003", title: "CSV export", rationale: "users ask", proposedScenarios: ["Export the project list as CSV"], createdAt: "t" });
    const p = generatorPrompt({ demand, scenariosDir: "/r/.adapt/scenarios", assignedIds: ["SCN-006", "SCN-007"] });
    expect(p).toContain("DMD-003");
    expect(p).toContain("CSV export");
    expect(p).toContain("SCN-006");
    expect(p).toContain("SCN-007");
    expect(p).toContain("/r/.adapt/scenarios");
    expect(p).toContain("agent-discovered");
    expect(p).toContain("status: ready");
    expect(p.toLowerCase()).toContain("black-box");
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/agents/generatorPrompt.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — `src/agents/prompts/generator.ts`:

```ts
import type { Demand } from "../../demand/demand.ts";

export interface GeneratorPromptCtx {
  demand: Demand;
  scenariosDir: string;
  assignedIds: string[];
}

export function generatorPrompt(ctx: GeneratorPromptCtx): string {
  const { demand, scenariosDir, assignedIds } = ctx;
  const idList = assignedIds.join(", ");
  return `You are the Scenario Generator. Turn the APPROVED demand below into user-level, BLACK-BOX scenarios that a
runner could later execute against the running app like a real user. You may read the source code for discovery, but
the scenarios MUST be user-centered and must not reference code, endpoints, files, or implementation details.

APPROVED DEMAND ${demand.id}: ${demand.title}
Rationale: ${demand.rationale}
Proposed scenarios: ${JSON.stringify(demand.proposedScenarios)}

Write between 1 and ${assignedIds.length} scenario files (only as many as the demand genuinely needs) into the
directory: ${scenariosDir}
Use these assigned IDs in order, lowest first — filename is "<id>.md": ${idList}

Each file MUST be valid scenario markdown with this exact YAML frontmatter shape (use the assigned id):
---
id: <assigned id, e.g. ${assignedIds[0]}>
title: <short user-facing title>
status: ready
priority: medium
persona: <who the user is>
tags: [<area>]
source: agent-discovered
---
# Scenario
<As the persona, do X and verify the visible outcome Y.>

## Steps
1. ...

## Expected outcome
- <a visible, user-observable success condition>

Do NOT invent extra files or use IDs other than the assigned ones. Write the files before finishing.`;
}
```

- [ ] **Step 4: Run** — `npx vitest run test/agents/generatorPrompt.test.ts`. Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add src/agents/prompts/generator.ts test/agents/generatorPrompt.test.ts
git commit -m "feat(agents): scenario generator prompt"
```

---

## Task 2: `runGenerate` (+ `nextScenarioNumber`) + full verification

**Files:** Create `src/demand/generate.ts`; Test `test/demand/generate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { AdaptConfigSchema } from "../../src/config/schema.ts";
import { newDemand, type Demand } from "../../src/demand/demand.ts";
import { runGenerate, nextScenarioNumber } from "../../src/demand/generate.ts";
import { rebuildRegistry } from "../../src/scenarios/registry.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function ctx(over = {}) {
  dir = makeTmpDir();
  mkdirSync(join(dir, ".adapt", "scenarios"), { recursive: true });
  mkdirSync(join(dir, ".adapt", "demands"), { recursive: true });
  const config = AdaptConfigSchema.parse({ targetRepoPath: dir, appBaseUrl: "http://x", limits: { maxScenariosPerDemand: 2, ...over } });
  return { dir: dir!, config };
}

const approved = (id: string): Demand => ({ ...newDemand({ id, title: `${id} feature`, rationale: "r", proposedScenarios: ["do a thing"], createdAt: "t" }), status: "approved" });

function scenarioFile(id: string): string {
  return `---\nid: ${id}\ntitle: ${id} scenario\nstatus: ready\npriority: medium\npersona: User\ntags: [gen]\nsource: agent-discovered\n---\n# Scenario\nDo a thing and see the result.\n`;
}

// Generator stub: writes `count` valid scenario files at the assigned IDs found in the prompt.
function genEngine(count: number, opts: { malformed?: boolean } = {}) {
  return new StubEngine({ script: (s) => {
    const dirMatch = s.prompt.match(/directory:\s*(\S+)/)![1]!;
    const ids = [...s.prompt.matchAll(/SCN-\d+/g)].map((m) => m[0]);
    const unique = [...new Set(ids)];
    for (let i = 0; i < Math.min(count, unique.length); i++) {
      const id = unique[i]!;
      const content = opts.malformed ? "no frontmatter here" : scenarioFile(id);
      writeFileSync(join(dirMatch, `${id}.md`), content, "utf8");
    }
    return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
  }});
}

describe("nextScenarioNumber", () => {
  it("is 1 when there are no top-level scenarios", () => {
    const c = ctx();
    expect(nextScenarioNumber(c.dir)).toBe(1);
  });
  it("is max+1 of existing top-level scenario ids", () => {
    const c = ctx();
    writeFileSync(join(c.dir, ".adapt", "scenarios", "SCN-005.md"), scenarioFile("SCN-005"), "utf8");
    expect(nextScenarioNumber(c.dir)).toBe(6);
  });
});

describe("runGenerate", () => {
  it("creates validated scenario files for an approved demand and registers them", async () => {
    const c = ctx();
    const created = await runGenerate({ engine: genEngine(2), config: c.config, targetRepo: c.dir, sink: () => {} }, [approved("DMD-001")]);
    expect(created.map((s) => s.id)).toEqual(["SCN-001", "SCN-002"]);
    expect(existsSync(join(c.dir, ".adapt", "scenarios", "SCN-001.md"))).toBe(true);
    expect(rebuildRegistry(c.dir).map((e) => e.id)).toEqual(["SCN-001", "SCN-002"]);
  });

  it("caps scenarios per demand at maxScenariosPerDemand", async () => {
    const c = ctx({ maxScenariosPerDemand: 1 });
    const created = await runGenerate({ engine: genEngine(5), config: c.config, targetRepo: c.dir, sink: () => {} }, [approved("DMD-001")]);
    expect(created.length).toBe(1);
  });

  it("deletes a malformed generated file and does not register it (registry stays valid)", async () => {
    const c = ctx();
    const created = await runGenerate({ engine: genEngine(1, { malformed: true }), config: c.config, targetRepo: c.dir, sink: () => {} }, [approved("DMD-001")]);
    expect(created.length).toBe(0);
    expect(existsSync(join(c.dir, ".adapt", "scenarios", "SCN-001.md"))).toBe(false);
    expect(() => rebuildRegistry(c.dir)).not.toThrow();
  });

  it("gives each demand a distinct ID block (no collisions)", async () => {
    const c = ctx();
    const created = await runGenerate({ engine: genEngine(2), config: c.config, targetRepo: c.dir, sink: () => {} }, [approved("DMD-001"), approved("DMD-002")]);
    const ids = created.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length); // all unique
    expect(ids).toContain("SCN-001");
    expect(ids).toContain("SCN-003"); // second demand's block starts after the first's assigned block (cap 2)
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/demand/generate.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `src/demand/generate.ts`:

```ts
import { join } from "node:path";
import { existsSync, readFileSync, rmSync } from "node:fs";
import type { AgentEngine, AgentEvent } from "../engine/types.ts";
import type { AdaptConfig } from "../config/schema.ts";
import { workspacePaths } from "../workspace/paths.ts";
import { rebuildRegistry } from "../scenarios/registry.ts";
import { parseScenario } from "../scenarios/parse.ts";
import { runAgent } from "../engine/runAgent.ts";
import { mcpServersFor } from "../engine/mcp.ts";
import { generatorPrompt } from "../agents/prompts/generator.ts";
import type { Demand } from "./demand.ts";

export interface GenerateDeps {
  engine: AgentEngine;
  config: AdaptConfig;
  targetRepo: string;
  sink: (e: AgentEvent) => void;
}

/** The next free SCN number = max existing top-level scenario id + 1 (1 if none). */
export function nextScenarioNumber(targetRepo: string): number {
  const nums = rebuildRegistry(targetRepo).map((e) => {
    const m = e.id.match(/^SCN-(\d+)$/);
    return m ? parseInt(m[1]!, 10) : 0;
  });
  return (nums.length ? Math.max(...nums) : 0) + 1;
}

function pad(n: number): string {
  return `SCN-${String(n).padStart(3, "0")}`;
}

/** Generate scenario files for each approved demand. Node assigns collision-free IDs and
 *  validates every generated file (deleting invalid ones). Returns the created scenarios. */
export async function runGenerate(deps: GenerateDeps, approved: Demand[]): Promise<{ id: string; filename: string }[]> {
  const { engine, config, targetRepo, sink } = deps;
  const ws = workspacePaths(targetRepo);
  const cap = config.limits.maxScenariosPerDemand;
  const created: { id: string; filename: string }[] = [];

  let nextNum = nextScenarioNumber(targetRepo);

  for (const demand of approved) {
    const assignedIds = Array.from({ length: cap }, (_, i) => pad(nextNum + i));
    await runAgent(
      engine,
      {
        role: "generator",
        prompt: generatorPrompt({ demand, scenariosDir: ws.scenariosDir, assignedIds }),
        cwd: targetRepo,
        mcpServers: mcpServersFor("generator", config),
      },
      sink,
    );

    for (const id of assignedIds) {
      const filename = `${id}.md`;
      const path = join(ws.scenariosDir, filename);
      if (!existsSync(path)) continue;
      try {
        const parsed = parseScenario(readFileSync(path, "utf8"), filename);
        if (parsed.meta.id !== id) { rmSync(path); continue; }   // wrong id → clean up
        created.push({ id, filename });
      } catch {
        rmSync(path);                                            // malformed → clean up so the registry stays valid
      }
    }
    nextNum += cap; // advance past this demand's whole assigned block, even if some IDs went unused
  }

  rebuildRegistry(targetRepo); // refresh the index over all (now-valid) scenarios
  return created;
}
```

- [ ] **Step 4: Run** — `npx vitest run test/demand/generate.test.ts` (PASS, 6 tests), then `npx vitest run` (ALL pass) and `npx tsc --noEmit` (exit 0). Report all.

- [ ] **Step 5: Commit**

```bash
git add src/demand/generate.ts test/demand/generate.test.ts
git commit -m "feat(demand): runGenerate — approved demands -> validated scenario files"
```

---

## Self-Review (completed during authoring)

- **Spec coverage (Plan 8):** Scenario Generator writes black-box scenario files for approved demands (§3.1, §6) → Tasks 1–2; Node assigns collision-free IDs + validates each file, invalid → skipped/deleted (§5, §7 additive/no-overwrite) → Task 2; cap per demand (§4, §7) → Task 2; generated scenarios enter at `status: ready`, `source: agent-discovered` (§4, §7) → Task 1 (prompt) + Task 2 (validation parses them). The generator uses `runAgent` directly because its deliverable is files, not a result JSON (§5 note).
- **Type consistency:** `generatorPrompt(ctx)`, `runGenerate(deps, approved: Demand[])` → `{ id, filename }[]`, `nextScenarioNumber(targetRepo)`, `GenerateDeps`. Consumes `Demand` (Plan 7) and produces standard scenario files (Phase 1 format), consumed unchanged by Plan 9's `runDemandStage`/`runEvolve` and by `runCycle`.
- **Robustness:** Node-assigned IDs are collision-free (block advances per demand); malformed/wrong-id files are deleted before the final `rebuildRegistry`, so the registry never ends up in a throwing state. The prompt forbids non-assigned filenames; in stub tests only assigned files are written.
- **Deferred to Plan 9:** `runDemandStage` (dream → critique → generate) composition and `adapt evolve`.

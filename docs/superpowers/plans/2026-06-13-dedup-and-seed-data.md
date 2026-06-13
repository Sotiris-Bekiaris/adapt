# Dedup-aware Critic & Guaranteed Scenario Seed Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop cross-cycle scenario duplication via a corpus-aware Critic, and guarantee each scenario's data exists before it runs.

**Architecture:** Add a `duplicate` verdict to the existing Critic and feed it the existing scenario/demand corpus so it judges overlap by meaning. Teach the Generator to emit `hooks.setup`/`hooks.teardown` that seed the exact data its steps assume. Add a config flag + runtime guard so a scenario with no resolved setup hook either blocks or emits a visible warning.

**Tech Stack:** TypeScript (ESM, `tsx`), Zod schemas, Vitest. Test runner: `npm test` (vitest run). Typecheck: `npm run typecheck`.

Spec: `docs/superpowers/specs/2026-06-13-dedup-and-seed-data-design.md`.

---

## File Structure

- `src/demand/demand.ts` — add `"duplicate"` status + `duplicateOf` field (Task 1).
- `src/agents/prompts/critic.ts` — `duplicate` verdict + `corpus` in prompt (Task 2).
- `src/demand/critique.ts` — build corpus, persist `duplicate`, exclude from approved (Task 3).
- `src/agents/prompts/generator.ts` — seed-hook frontmatter + rule (Task 4).
- `src/config/schema.ts` — `hooks.requireSetupHook` flag (Task 5).
- `src/orchestrator/runScenario.ts` — no-setup-hook guard (Task 6).

`src/demand/dream.ts` is intentionally **unchanged**: its `demandTitleKey` seen-set already excludes only `rejected`, so `duplicate` demands remain in `seen` and the Dreamer won't re-propose an identical title. The semantic safety net now lives in the Critic. No code change needed there.

---

## Task 1: Demand gains a `duplicate` status and `duplicateOf` field

**Files:**
- Modify: `src/demand/demand.ts`
- Test: `test/demand/demand.test.ts`

- [ ] **Step 1: Write the failing test**

Append inside the existing top-level `describe` (or add a new `describe`) in `test/demand/demand.test.ts`:

```typescript
import { DEMAND_STATUSES, DemandSchema } from "../../src/demand/demand.ts";

describe("duplicate status", () => {
  it("includes 'duplicate' as a valid status", () => {
    expect(DEMAND_STATUSES).toContain("duplicate");
  });

  it("newDemand defaults duplicateOf to null", () => {
    const d = newDemand({ id: "DMD-001", title: "t", rationale: "r", proposedScenarios: [], createdAt: "t" });
    expect(d.duplicateOf).toBeNull();
  });

  it("DemandSchema accepts a duplicate demand naming what it overlaps", () => {
    const d = DemandSchema.parse({
      id: "DMD-002", title: "t", rationale: "r", proposedScenarios: [], source: "dreamer",
      status: "duplicate", critique: null, createdAt: "t", duplicateOf: "SCN-005",
    });
    expect(d.status).toBe("duplicate");
    expect(d.duplicateOf).toBe("SCN-005");
  });

  it("DemandSchema defaults duplicateOf to null when absent (back-compat)", () => {
    const d = DemandSchema.parse({
      id: "DMD-003", title: "t", rationale: "r", proposedScenarios: [], source: "dreamer",
      status: "proposed", critique: null, createdAt: "t",
    });
    expect(d.duplicateOf).toBeNull();
  });
});
```

If `newDemand`/`DemandSchema` are not already imported at the top of the file, add them to the existing import from `../../src/demand/demand.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/demand/demand.test.ts`
Expected: FAIL — `DEMAND_STATUSES` does not contain `"duplicate"`, and `duplicateOf` is undefined.

- [ ] **Step 3: Write minimal implementation**

In `src/demand/demand.ts`, change the status list, schema, and factory:

```typescript
export const DEMAND_STATUSES = ["proposed", "approved", "rejected", "duplicate"] as const;

export const DemandSchema = z.object({
  id: z.string().regex(/^DMD-\d+$/, "id must look like DMD-001"),
  title: z.string().min(1),
  rationale: z.string(),
  proposedScenarios: z.array(z.string()),
  source: z.literal("dreamer"),
  status: z.enum(DEMAND_STATUSES),
  critique: z.string().nullable(),
  createdAt: z.string(),
  duplicateOf: z.string().nullable().default(null),
});

export type Demand = z.infer<typeof DemandSchema>;
export type DemandStatus = (typeof DEMAND_STATUSES)[number];

export function newDemand(args: {
  id: string; title: string; rationale: string; proposedScenarios: string[]; createdAt: string;
}): Demand {
  return {
    id: args.id, title: args.title, rationale: args.rationale,
    proposedScenarios: args.proposedScenarios, source: "dreamer",
    status: "proposed", critique: null, createdAt: args.createdAt, duplicateOf: null,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/demand/demand.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/demand/demand.ts test/demand/demand.test.ts
git commit -m "feat: add duplicate demand status and duplicateOf field"
```

---

## Task 2: Critic gains a `duplicate` verdict and corpus context

**Files:**
- Modify: `src/agents/prompts/critic.ts`
- Test: `test/agents/criticPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

Replace the contents of `test/agents/criticPrompt.test.ts` with:

```typescript
import { describe, it, expect } from "vitest";
import { criticPrompt, CriticVerdictSchema } from "../../src/agents/prompts/critic.ts";
import { newDemand } from "../../src/demand/demand.ts";

describe("critic", () => {
  it("CriticVerdictSchema validates and defaults critique + duplicateOf", () => {
    const v = CriticVerdictSchema.parse({ decision: "approved" });
    expect(v.critique).toBe("");
    expect(v.duplicateOf).toBeNull();
  });

  it("CriticVerdictSchema accepts a duplicate verdict", () => {
    const v = CriticVerdictSchema.parse({ decision: "duplicate", duplicateOf: "SCN-009" });
    expect(v.decision).toBe("duplicate");
    expect(v.duplicateOf).toBe("SCN-009");
  });

  it("prompt presents the demand, north-star, corpus, RESULT_FILE, and the duplicate option", () => {
    const demand = newDemand({ id: "DMD-001", title: "Add CSV export", rationale: "users ask", proposedScenarios: ["Export list as CSV"], createdAt: "t" });
    const p = criticPrompt({
      demand, northStar: "Be the best CRM.", corpus: "Existing scenarios:\nSCN-009 · Export contacts [export]",
      resultPath: "/r/.adapt/demands/critic-DMD-001.json",
    });
    expect(p).toContain("DMD-001");
    expect(p).toContain("Add CSV export");
    expect(p).toContain("Be the best CRM");
    expect(p).toContain("SCN-009 · Export contacts");
    expect(p).toContain("RESULT_FILE=/r/.adapt/demands/critic-DMD-001.json");
    expect(p.toLowerCase()).toContain("approved");
    expect(p.toLowerCase()).toContain("duplicate");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/agents/criticPrompt.test.ts`
Expected: FAIL — `duplicateOf` undefined on the parsed verdict and `corpus` is not a known prompt arg.

- [ ] **Step 3: Write minimal implementation**

Replace `src/agents/prompts/critic.ts` with:

```typescript
import { z } from "zod";
import type { Demand } from "../../demand/demand.ts";

export const CriticVerdictSchema = z.object({
  decision: z.enum(["approved", "rejected", "duplicate"]),
  critique: z.string().default(""),
  duplicateOf: z.string().nullable().default(null),
});
export type CriticVerdict = z.infer<typeof CriticVerdictSchema>;

export interface CriticPromptCtx {
  demand: Demand;
  northStar: string;
  corpus: string;
  resultPath: string;
}

export function criticPrompt(ctx: CriticPromptCtx): string {
  const { demand, northStar, corpus, resultPath } = ctx;
  return `You are the Critic — a skeptical product owner. Challenge the proposed demand below. Approve it ONLY if it
is genuinely valuable, aligned with the north-star, and worth building now — not bloat, busywork, or a vanity feature.
You may read the source code but do NOT write code.

=== NORTH STAR ===
${northStar}
=== ALREADY COVERED (existing scenarios and other demands) ===
${corpus}
=== PROPOSED DEMAND ${demand.id} ===
Title: ${demand.title}
Rationale: ${demand.rationale}
Proposed scenarios: ${JSON.stringify(demand.proposedScenarios)}
=== END ===

Decide one of:
- "approved" — valuable, aligned, and NOT already covered above.
- "rejected" — bloat, busywork, misaligned, or not worth building now.
- "duplicate" — already substantially covered by an existing scenario or another demand listed above. Judge by
  MEANING, not wording; differently-phrased restatements of the same user value are duplicates. Set "duplicateOf"
  to the id (e.g. SCN-009 or DMD-002) it overlaps.

Give a one-paragraph critique explaining your decision.

Write your verdict as a single JSON object to this exact path:
RESULT_FILE=${resultPath}
Shape: { "decision": "approved" | "rejected" | "duplicate", "critique": "<text>", "duplicateOf": "<id or null>" }`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/agents/criticPrompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agents/prompts/critic.ts test/agents/criticPrompt.test.ts
git commit -m "feat: critic gains duplicate verdict and corpus awareness"
```

---

## Task 3: Critique stage builds the corpus and handles duplicates

**Files:**
- Modify: `src/demand/critique.ts`
- Test: `test/demand/critique.test.ts`

- [ ] **Step 1: Write the failing test**

Replace the contents of `test/demand/critique.test.ts` with:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { AdaptConfigSchema } from "../../src/config/schema.ts";
import { LocalDemandStore } from "../../src/demand/demandStore.ts";
import { newDemand } from "../../src/demand/demand.ts";
import { runCritique } from "../../src/demand/critique.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function ctx() {
  dir = makeTmpDir();
  mkdirSync(join(dir, ".adapt", "demands"), { recursive: true });
  mkdirSync(join(dir, ".adapt", "scenarios"), { recursive: true });
  writeFileSync(join(dir, ".adapt", "north-star.md"), "# North Star\nBe great.\n", "utf8");
  const config = AdaptConfigSchema.parse({ targetRepoPath: dir, appBaseUrl: "http://x" });
  const store = new LocalDemandStore(dir);
  return { dir: dir!, config, store };
}

function seedScenario(dir: string) {
  writeFileSync(join(dir, ".adapt", "scenarios", "SCN-001.md"), `---
id: SCN-001
title: Export contacts as CSV
status: ready
priority: medium
persona: User
tags: [export]
source: human-seeded
---
Export and verify the file.
`, "utf8");
}

// Approves DMD-001, rejects DMD-002, marks DMD-003 duplicate of SCN-001.
function criticEngine() {
  return new StubEngine({ script: (s) => {
    const path = s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim();
    let verdict: Record<string, unknown>;
    if (s.prompt.includes("DMD-001")) verdict = { decision: "approved", critique: "good", duplicateOf: null };
    else if (s.prompt.includes("DMD-003")) verdict = { decision: "duplicate", critique: "already have it", duplicateOf: "SCN-001" };
    else verdict = { decision: "rejected", critique: "bloat", duplicateOf: null };
    writeFileSync(path, JSON.stringify(verdict), "utf8");
    return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
  }});
}

describe("runCritique", () => {
  it("approves, rejects, and marks duplicates; only approved are returned", async () => {
    const c = ctx();
    seedScenario(c.dir);
    c.store.create(newDemand({ id: "DMD-001", title: "good", rationale: "r", proposedScenarios: [], createdAt: "t" }));
    c.store.create(newDemand({ id: "DMD-002", title: "bloat", rationale: "r", proposedScenarios: [], createdAt: "t" }));
    c.store.create(newDemand({ id: "DMD-003", title: "export contacts to a CSV file", rationale: "r", proposedScenarios: [], createdAt: "t" }));

    const approved = await runCritique({ engine: criticEngine(), config: c.config, targetRepo: c.dir, sink: () => {} });

    expect(approved.map((d) => d.id)).toEqual(["DMD-001"]);
    expect(c.store.listByStatus("rejected").map((d) => d.id)).toEqual(["DMD-002"]);
    const dup = c.store.list().find((d) => d.id === "DMD-003")!;
    expect(dup.status).toBe("duplicate");
    expect(dup.duplicateOf).toBe("SCN-001");
  });

  it("feeds the existing scenario corpus into the critic prompt", async () => {
    const c = ctx();
    seedScenario(c.dir);
    c.store.create(newDemand({ id: "DMD-001", title: "good", rationale: "r", proposedScenarios: [], createdAt: "t" }));
    let seenPrompt = "";
    const engine = new StubEngine({ script: (s) => {
      seenPrompt = s.prompt;
      const path = s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim();
      writeFileSync(path, JSON.stringify({ decision: "approved", critique: "", duplicateOf: null }), "utf8");
      return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
    }});
    await runCritique({ engine, config: c.config, targetRepo: c.dir, sink: () => {} });
    expect(seenPrompt).toContain("SCN-001");
    expect(seenPrompt).toContain("Export contacts as CSV");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/demand/critique.test.ts`
Expected: FAIL — the corpus is not in the prompt and `duplicateOf` is not persisted.

- [ ] **Step 3: Write minimal implementation**

Replace `src/demand/critique.ts` with:

```typescript
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { AgentEngine, AgentEvent } from "../engine/types.ts";
import type { AdaptConfig } from "../config/schema.ts";
import { workspacePaths } from "../workspace/paths.ts";
import { rebuildRegistry } from "../scenarios/registry.ts";
import { runRole } from "../agents/runRole.ts";
import { mcpServersFor } from "../engine/mcp.ts";
import { criticPrompt, CriticVerdictSchema } from "../agents/prompts/critic.ts";
import { LocalDemandStore } from "./demandStore.ts";
import type { Demand } from "./demand.ts";

export interface CritiqueDeps {
  engine: AgentEngine;
  config: AdaptConfig;
  targetRepo: string;
  sink: (e: AgentEvent) => void;
}

/** Critic pass over every proposed demand. Returns the approved demands. */
export async function runCritique(deps: CritiqueDeps): Promise<Demand[]> {
  const { engine, config, targetRepo, sink } = deps;
  const ws = workspacePaths(targetRepo);
  const store = new LocalDemandStore(targetRepo);
  const northStar = existsSync(ws.northStar) ? readFileSync(ws.northStar, "utf8") : "";

  const scenarioCorpus = rebuildRegistry(targetRepo)
    .map((e) => `${e.id} · ${e.title} [${e.tags.join(", ")}]`).join("\n") || "(none)";

  const approved: Demand[] = [];
  for (const demand of store.listByStatus("proposed")) {
    const demandCorpus = store.list()
      .filter((d) => d.id !== demand.id && d.status !== "rejected")
      .map((d) => `${d.id} · ${d.title}`).join("\n") || "(none)";
    const corpus = `Existing scenarios:\n${scenarioCorpus}\n\nOther demands:\n${demandCorpus}`;

    const resultPath = join(ws.demandsDir, `critic-${demand.id}.json`);
    const outcome = await runRole(
      engine,
      {
        role: "critic",
        prompt: criticPrompt({ demand, northStar, corpus, resultPath }),
        cwd: targetRepo,
        mcpServers: mcpServersFor("critic", config),
      },
      resultPath, CriticVerdictSchema, sink,
    );
    if (outcome.status !== "ok" || !outcome.value) continue; // no valid verdict → leave proposed, skip
    const decided: Demand = {
      ...demand,
      status: outcome.value.decision,
      critique: outcome.value.critique,
      duplicateOf: outcome.value.duplicateOf,
    };
    store.update(decided);
    if (decided.status === "approved") approved.push(decided);
  }
  return approved;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/demand/critique.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/demand/critique.ts test/demand/critique.test.ts
git commit -m "feat: critique stage feeds corpus and persists duplicate verdicts"
```

---

## Task 4: Generator writes the seed hook for data-dependent scenarios

**Files:**
- Modify: `src/agents/prompts/generator.ts`
- Test: `test/agents/generatorPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `it` block to the existing `describe("generatorPrompt", ...)` in `test/agents/generatorPrompt.test.ts`:

```typescript
  it("instructs the generator to emit setup/teardown seed hooks for data-dependent scenarios", () => {
    const demand = newDemand({ id: "DMD-003", title: "CSV export", rationale: "users ask", proposedScenarios: ["Export the project list as CSV"], createdAt: "t" });
    const p = generatorPrompt({ demand, scenariosDir: "/r/.adapt/scenarios", assignedIds: ["SCN-006"] });
    expect(p).toContain("hooks:");
    expect(p).toContain("setup:");
    expect(p).toContain("teardown:");
    expect(p.toLowerCase()).toContain("seed");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/agents/generatorPrompt.test.ts`
Expected: FAIL — the prompt has no `hooks:`/`setup:`/seed instruction.

- [ ] **Step 3: Write minimal implementation**

Replace `src/agents/prompts/generator.ts` with:

```typescript
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
hooks:
  setup: <shell command that seeds the data this scenario assumes, or omit the whole hooks block>
  teardown: <shell command that cleans that data, or omit>
---
# Scenario
<As the persona, do X and verify the visible outcome Y.>

## Steps
1. ...

## Expected outcome
- <a visible, user-observable success condition>

SEED DATA — CRITICAL: The runner is a black-box browser user with NO repo access; it cannot create data itself.
If your scenario depends on data existing BEFORE the user acts (a specific account to log in as, pre-existing
records, a particular app state), you MUST emit a "hooks.setup" command that seeds EXACTLY that data into the
isolated test database, plus a "hooks.teardown" that cleans it. Discover the project's own seed tooling (you may
read the source to find it — e.g. a seed script, migration, or fixture loader). Never reference a user or record
your setup hook does not create. If the scenario genuinely needs no pre-existing data (e.g. a fresh signup from an
empty state), OMIT the entire "hooks" block.

Do NOT invent extra files or use IDs other than the assigned ones. Write the files before finishing.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/agents/generatorPrompt.test.ts`
Expected: PASS (both the new `it` and the existing assertions for `agent-discovered`, `status: ready`, `black-box`, the SCN ids, and the dir).

- [ ] **Step 5: Commit**

```bash
git add src/agents/prompts/generator.ts test/agents/generatorPrompt.test.ts
git commit -m "feat: generator emits seed hooks for data-dependent scenarios"
```

---

## Task 5: Config gains `hooks.requireSetupHook`

**Files:**
- Modify: `src/config/schema.ts:23-26` (the `hooks` object)
- Test: `test/config/schema.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

If `test/config/schema.test.ts` exists, add the `describe` below to it; otherwise create the file with:

```typescript
import { describe, it, expect } from "vitest";
import { AdaptConfigSchema } from "../../src/config/schema.ts";

describe("hooks.requireSetupHook", () => {
  it("defaults to false", () => {
    const c = AdaptConfigSchema.parse({ targetRepoPath: "/r", appBaseUrl: "http://x" });
    expect(c.hooks.requireSetupHook).toBe(false);
  });

  it("can be enabled", () => {
    const c = AdaptConfigSchema.parse({ targetRepoPath: "/r", appBaseUrl: "http://x", hooks: { requireSetupHook: true } });
    expect(c.hooks.requireSetupHook).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/config/schema.test.ts`
Expected: FAIL — `requireSetupHook` is undefined on `c.hooks`.

- [ ] **Step 3: Write minimal implementation**

In `src/config/schema.ts`, change the `hooks` object (currently lines 23-26):

```typescript
  // Global default DB lifecycle hooks; scenario-level hooks override (blueprint §13)
  hooks: z.object({
    setup: z.string().optional(),
    teardown: z.string().optional(),
    requireSetupHook: z.boolean().default(false),
  }).default({}),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/config/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts test/config/schema.test.ts
git commit -m "feat: add hooks.requireSetupHook config flag"
```

---

## Task 6: runScenario guards against a missing setup hook

**Files:**
- Modify: `src/orchestrator/runScenario.ts:36-42`
- Test: `test/orchestrator/runScenario.test.ts`

- [ ] **Step 1: Write the failing test**

Add these two `it` blocks inside the existing `describe("runScenario", ...)` in `test/orchestrator/runScenario.test.ts`. (The existing `setup()` helper builds `config` from `AdaptConfigSchema.parse`; override `config.hooks` per-test as shown.)

```typescript
  it("blocks (agent never runs) when no setup hook resolves and requireSetupHook is on", async () => {
    let invoked = false;
    const engine = new StubEngine({ script: () => { invoked = true; return [{ kind: "agent.exit", role: "runner", at: "t", exitCode: 0 }]; } });
    const d = setup({ engine });
    const config = { ...d.config, hooks: { ...d.config.hooks, requireSetupHook: true } };
    const rec = await runScenario({ ...d, config, targetRepo: d.dir, sink: () => {} }, scenario());
    expect(rec.status).toBe("blocked");
    expect(invoked).toBe(false);
    expect(rec.runnerNotes.toLowerCase()).toContain("no setup hook");
  });

  it("warns but still runs when no setup hook resolves and requireSetupHook is off (default)", async () => {
    const events: { text?: string }[] = [];
    const d = setup({ engine: runnerEngine("passed") });
    const rec = await runScenario({ ...d, targetRepo: d.dir, sink: (e) => events.push(e) }, scenario());
    expect(rec.status).toBe("passed");
    expect(events.some((e) => (e.text ?? "").toLowerCase().includes("no setup hook"))).toBe(true);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/orchestrator/runScenario.test.ts`
Expected: FAIL — no block on missing hook, and no warning event is emitted.

- [ ] **Step 3: Write minimal implementation**

In `src/orchestrator/runScenario.ts`, replace the setup block (currently lines 36-42):

```typescript
  const setup = runHook(scenario.meta.hooks?.setup ?? config.hooks.setup, targetRepo);
  if (!setup.ok) {
    return orchestrator.recordResult(run.runId, {
      status: "blocked",
      runnerNotes: `setup hook failed (exit ${setup.code}): ${setup.output.slice(0, 500)}`,
    });
  }
```

with:

```typescript
  const setupCmd = scenario.meta.hooks?.setup ?? config.hooks.setup;
  if (!setupCmd) {
    if (config.hooks.requireSetupHook) {
      return orchestrator.recordResult(run.runId, {
        status: "blocked",
        runnerNotes: `no setup hook resolved for ${scenario.meta.id}; DB state unmanaged (hooks.requireSetupHook is on)`,
      });
    }
    sink({
      kind: "agent.text",
      role: "runner",
      at: new Date().toISOString(),
      text: `WARN: no setup hook for ${scenario.meta.id}; running against unmanaged DB state`,
    });
  }
  const setup = runHook(setupCmd, targetRepo);
  if (!setup.ok) {
    return orchestrator.recordResult(run.runId, {
      status: "blocked",
      runnerNotes: `setup hook failed (exit ${setup.code}): ${setup.output.slice(0, 500)}`,
    });
  }
```

(`runHook(undefined, ...)` is already a no-op success, so the warn-and-continue path falls through to it harmlessly.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- test/orchestrator/runScenario.test.ts`
Expected: PASS (including the existing passed/failed/inconclusive/out-of-vocab/setup-fails tests).

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/runScenario.ts test/orchestrator/runScenario.test.ts
git commit -m "feat: guard scenarios that resolve no setup hook"
```

---

## Final verification

- [ ] **Run the full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests PASS, no type errors.

---

## Self-Review notes

- **Spec coverage:** A→Tasks 1-3 (+ dream.ts intentionally unchanged, documented in File Structure). B→Task 4. C→Tasks 5-6. All spec sections mapped.
- **Deviations from spec, by necessity:**
  - Corpus uses `id · title [tags]` for scenarios (the registry index carries `tags` but not `persona`); reading every scenario file for persona was rejected as needless I/O. Demand corpus is `id · title`.
  - The warning is emitted as an `agent.text` event prefixed `WARN:` rather than a new `"warning"` event kind — `AgentEventKind` is a closed union rendered by the console; reusing `agent.text` keeps it visible without a cross-cutting enum change.
- **Type consistency:** `duplicateOf` (nullable string, default null) is identical across `DemandSchema`, `CriticVerdictSchema`, and the `decided` object. `decision` enum values match the demand `DEMAND_STATUSES` so `status: outcome.value.decision` type-checks.

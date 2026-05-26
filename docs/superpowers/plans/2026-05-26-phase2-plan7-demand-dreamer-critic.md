# Phase 2 · Plan 7 — Demand model + Dreamer + Critic

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The adversarial demand pipeline: a Dreamer proposes a new north-star ambition + concrete Demands, and a Critic approves or rejects each — producing a set of *approved* demands ready for scenario generation (Plan 8).

**Architecture:** Same `runRole` result-file seam as Phase 1. The Dreamer/Critic are read-only coding agents that emit schema-validated JSON; Node owns all persistence — it appends the proposed ambition to `north-star.md` (append-only), persists Demands (capped), and records Critic verdicts. Fully stub-tested.

**Tech Stack:** Builds on Phases 0–1. No new npm deps.

**Depends on:** Phase 1 (`runRole`, `mcpServersFor`, `rebuildRegistry`, `workspacePaths`, `AdaptConfig`, `StubEngine`).

---

## File Structure

```
src/config/schema.ts            # MODIFY: limits.maxDemandsPerCycle, limits.maxScenariosPerDemand
src/engine/mcp.ts               # MODIFY: add dreamer/critic/generator role mappings
src/workspace/paths.ts          # MODIFY: add demandsDir
src/demand/demand.ts            # Demand schema + newDemand
src/demand/demandStore.ts       # LocalDemandStore (list/create/update/nextId/listByStatus)
src/demand/northStar.ts         # appendAmbition(targetRepo, text, now)
src/agents/prompts/dreamer.ts   # DreamResultSchema + dreamerPrompt
src/agents/prompts/critic.ts    # CriticVerdictSchema + criticPrompt
src/demand/dream.ts             # runDream(deps)
src/demand/critique.ts          # runCritique(deps)
test/... (one per source file)
```

---

## Task 1: Config — demand caps

**Files:** Modify `src/config/schema.ts`; Modify `test/config/schema.test.ts`

- [ ] **Step 1: Add a failing assertion** — inside the existing `describe("AdaptConfigSchema", ...)` in `test/config/schema.test.ts`:

```ts
  it("defaults the demand caps", () => {
    const parsed = AdaptConfigSchema.parse({ targetRepoPath: "/repo", appBaseUrl: "http://localhost:3000" });
    expect(parsed.limits.maxDemandsPerCycle).toBe(3);
    expect(parsed.limits.maxScenariosPerDemand).toBe(2);
  });
```

- [ ] **Step 2: Run** — `npx vitest run test/config/schema.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — in `src/config/schema.ts`, replace the `limits` block with:

```ts
  limits: z.object({
    maxFixAttempts: z.number().int().positive().default(2),
    maxVerificationAttempts: z.number().int().positive().default(3),
    maxItemsPerRun: z.number().int().positive().default(10),
    maxCycleSeconds: z.number().int().positive().default(3600),
    maxDemandsPerCycle: z.number().int().positive().default(3),
    maxScenariosPerDemand: z.number().int().positive().default(2),
  }).default({}),
```

- [ ] **Step 4: Run** — `npx vitest run test/config/schema.test.ts`. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts test/config/schema.test.ts
git commit -m "feat(config): demand caps (maxDemandsPerCycle, maxScenariosPerDemand)"
```

---

## Task 2: MCP role mappings for the demand roles

**Files:** Modify `src/engine/mcp.ts`; Modify `test/engine/mcp.test.ts`

- [ ] **Step 1: Add failing assertions** — append inside the existing `describe("mcpServersFor", ...)` in `test/engine/mcp.test.ts`:

```ts
  it("dreamer and generator get chrome-devtools; critic gets nothing; none get jira", () => {
    expect(mcpServersFor("dreamer", cfg({ jira: { enabled: true } }))).toEqual(["chrome-devtools"]);
    expect(mcpServersFor("generator", cfg({ jira: { enabled: true } }))).toEqual(["chrome-devtools"]);
    expect(mcpServersFor("critic", cfg({ jira: { enabled: true } }))).toEqual([]);
  });
```

- [ ] **Step 2: Run** — `npx vitest run test/engine/mcp.test.ts`. Expected: FAIL (type error / wrong result).

- [ ] **Step 3: Implement** — replace the entire body of `src/engine/mcp.ts` with:

```ts
import type { AdaptConfig } from "../config/schema.ts";

export type RoleName =
  | "runner" | "triage" | "implementation" | "verification"
  | "dreamer" | "critic" | "generator";

/**
 * Logical MCP server names to expose to a role, filtered by config toggles.
 * Black-box roles (runner, verification) drive a browser via Playwright; white-box
 * roles (triage, implementation, dreamer, generator) use Chrome DevTools to inspect/
 * explore. The critic reads only. Jira is exposed to triage/implementation/verification
 * when enabled — never to the runner or the demand roles. Logical names map to concrete
 * --mcp-config paths at real-run wiring time.
 */
export function mcpServersFor(role: RoleName, config: AdaptConfig): string[] {
  const out: string[] = [];
  if (role === "runner" || role === "verification") {
    if (config.mcp.playwright.enabled) out.push("playwright");
  } else if (role === "triage" || role === "implementation" || role === "dreamer" || role === "generator") {
    if (config.mcp.chromeDevTools.enabled) out.push("chrome-devtools");
  }
  // critic: no browser.
  const jiraRoles: RoleName[] = ["triage", "implementation", "verification"];
  if (config.mcp.jira.enabled && jiraRoles.includes(role)) out.push("jira");
  return out;
}
```

- [ ] **Step 4: Run** — `npx vitest run test/engine/mcp.test.ts`. Expected: PASS (all prior cases + the new one). Then `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/engine/mcp.ts test/engine/mcp.test.ts
git commit -m "feat(engine): MCP mappings for dreamer/critic/generator roles"
```

---

## Task 3: Demand schema + factory

**Files:** Create `src/demand/demand.ts`; Test `test/demand/demand.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { DemandSchema, newDemand } from "../../src/demand/demand.ts";

describe("Demand", () => {
  it("newDemand builds a proposed demand", () => {
    const d = newDemand({ id: "DMD-001", title: "Add CSV export", rationale: "users ask for it", proposedScenarios: ["Export the project list as CSV"], createdAt: "t" });
    expect(DemandSchema.safeParse(d).success).toBe(true);
    expect(d.status).toBe("proposed");
    expect(d.source).toBe("dreamer");
    expect(d.critique).toBeNull();
  });
  it("rejects an id that is not DMD-<number>", () => {
    expect(DemandSchema.safeParse({ id: "X1", title: "t", rationale: "", proposedScenarios: [], source: "dreamer", status: "proposed", critique: null, createdAt: "t" }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/demand/demand.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — `src/demand/demand.ts`:

```ts
import { z } from "zod";

export const DEMAND_STATUSES = ["proposed", "approved", "rejected"] as const;

export const DemandSchema = z.object({
  id: z.string().regex(/^DMD-\d+$/, "id must look like DMD-001"),
  title: z.string().min(1),
  rationale: z.string(),
  proposedScenarios: z.array(z.string()),
  source: z.literal("dreamer"),
  status: z.enum(DEMAND_STATUSES),
  critique: z.string().nullable(),
  createdAt: z.string(),
});

export type Demand = z.infer<typeof DemandSchema>;

export function newDemand(args: {
  id: string; title: string; rationale: string; proposedScenarios: string[]; createdAt: string;
}): Demand {
  return {
    id: args.id, title: args.title, rationale: args.rationale,
    proposedScenarios: args.proposedScenarios, source: "dreamer",
    status: "proposed", critique: null, createdAt: args.createdAt,
  };
}
```

- [ ] **Step 4: Run** — `npx vitest run test/demand/demand.test.ts`. Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/demand/demand.ts test/demand/demand.test.ts
git commit -m "feat(demand): Demand schema + factory"
```

---

## Task 4: demandsDir + LocalDemandStore

**Files:** Modify `src/workspace/paths.ts` + `test/workspace/paths.test.ts`; Create `src/demand/demandStore.ts`; Test `test/demand/demandStore.test.ts`

- [ ] **Step 1: Add a failing path assertion** — in `test/workspace/paths.test.ts`, inside the first test (`derives all workspace paths...`), add:

```ts
    expect(p.demandsDir).toBe("/repo/.adapt/demands");
```

- [ ] **Step 2: Run** — `npx vitest run test/workspace/paths.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement the path** — in `src/workspace/paths.ts`, add `demandsDir: string;` to the `WorkspacePaths` interface (after `decisionLogDir`), and in the returned object (after `decisionLogDir: join(root, "decision-log"),`) add:

```ts
    demandsDir: join(root, "demands"),
```

- [ ] **Step 4: Run** — `npx vitest run test/workspace/paths.test.ts`. Expected: PASS.

- [ ] **Step 5: Write the failing store test** — `test/demand/demandStore.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { LocalDemandStore } from "../../src/demand/demandStore.ts";
import { newDemand, type Demand } from "../../src/demand/demand.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

const d = (id: string) => newDemand({ id, title: id, rationale: "r", proposedScenarios: [], createdAt: "t" });

describe("LocalDemandStore", () => {
  it("creates, lists, and nextId increments", () => {
    dir = makeTmpDir();
    const s = new LocalDemandStore(dir);
    expect(s.nextId()).toBe("DMD-001");
    s.create(d("DMD-001"));
    expect(s.list().length).toBe(1);
    expect(s.nextId()).toBe("DMD-002");
  });
  it("update changes status; listByStatus filters", () => {
    dir = makeTmpDir();
    const s = new LocalDemandStore(dir);
    s.create(d("DMD-001"));
    const updated: Demand = { ...s.list()[0]!, status: "approved", critique: "ok" };
    s.update(updated);
    expect(s.listByStatus("approved").map((x) => x.id)).toEqual(["DMD-001"]);
    expect(s.listByStatus("proposed")).toEqual([]);
  });
});
```

- [ ] **Step 6: Run** — `npx vitest run test/demand/demandStore.test.ts`. Expected: FAIL.

- [ ] **Step 7: Implement** — `src/demand/demandStore.ts`:

```ts
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { workspacePaths } from "../workspace/paths.ts";
import { DemandSchema, type Demand, type DEMAND_STATUSES } from "./demand.ts";

type DemandStatus = (typeof DEMAND_STATUSES)[number];

/** Canonical local store of demands: one JSON file per demand in .adapt/demands/. */
export class LocalDemandStore {
  private dir: string;

  constructor(targetRepo: string) {
    this.dir = workspacePaths(targetRepo).demandsDir;
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true });
  }

  private fileFor(id: string): string {
    return join(this.dir, `${id}.json`);
  }

  list(): Demand[] {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json") && f.startsWith("DMD-"))
      .map((f) => DemandSchema.parse(JSON.parse(readFileSync(join(this.dir, f), "utf8"))))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  listByStatus(status: DemandStatus): Demand[] {
    return this.list().filter((d) => d.status === status);
  }

  nextId(): string {
    return `DMD-${String(this.list().length + 1).padStart(3, "0")}`;
  }

  create(demand: Demand): void {
    writeFileSync(this.fileFor(demand.id), JSON.stringify(DemandSchema.parse(demand), null, 2) + "\n", "utf8");
  }

  update(demand: Demand): void {
    writeFileSync(this.fileFor(demand.id), JSON.stringify(DemandSchema.parse(demand), null, 2) + "\n", "utf8");
  }
}
```

- [ ] **Step 8: Run** — `npx vitest run test/demand/demandStore.test.ts`. Expected: PASS (2 tests).

- [ ] **Step 9: Commit**

```bash
git add src/workspace/paths.ts test/workspace/paths.test.ts src/demand/demandStore.ts test/demand/demandStore.test.ts
git commit -m "feat(demand): demandsDir + LocalDemandStore"
```

---

## Task 5: north-star append

**Files:** Create `src/demand/northStar.ts`; Test `test/demand/northStar.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { appendAmbition } from "../../src/demand/northStar.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

describe("appendAmbition", () => {
  it("appends an ambition section, preserving prior content", () => {
    dir = makeTmpDir();
    mkdirSync(join(dir, ".adapt"), { recursive: true });
    writeFileSync(join(dir, ".adapt", "north-star.md"), "# North Star\n\nMy vision.\n", "utf8");
    appendAmbition(dir, "Add real-time collaboration", () => "2026-05-26T10:00:00.000Z");
    appendAmbition(dir, "Add an analytics dashboard", () => "2026-05-26T11:00:00.000Z");
    const text = readFileSync(join(dir, ".adapt", "north-star.md"), "utf8");
    expect(text).toContain("My vision.");
    expect(text).toContain("## Ambition 2026-05-26T10:00:00.000Z");
    expect(text).toContain("Add real-time collaboration");
    expect(text).toContain("Add an analytics dashboard");
    expect(text.indexOf("real-time")).toBeLessThan(text.indexOf("analytics"));
  });

  it("creates the file with a heading if it does not exist", () => {
    dir = makeTmpDir();
    mkdirSync(join(dir, ".adapt"), { recursive: true });
    appendAmbition(dir, "First ambition", () => "t");
    const text = readFileSync(join(dir, ".adapt", "north-star.md"), "utf8");
    expect(text).toContain("# North Star");
    expect(text).toContain("First ambition");
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/demand/northStar.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — `src/demand/northStar.ts`:

```ts
import { existsSync, appendFileSync, writeFileSync } from "node:fs";
import { workspacePaths } from "../workspace/paths.ts";

/** Append-only: add a timestamped ambition section to north-star.md (creating it if absent). */
export function appendAmbition(targetRepo: string, text: string, now: () => string = () => new Date().toISOString()): void {
  const { northStar } = workspacePaths(targetRepo);
  if (!existsSync(northStar)) writeFileSync(northStar, "# North Star\n", "utf8");
  appendFileSync(northStar, `\n## Ambition ${now()}\n\n${text.trim()}\n`, "utf8");
}
```

- [ ] **Step 4: Run** — `npx vitest run test/demand/northStar.test.ts`. Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/demand/northStar.ts test/demand/northStar.test.ts
git commit -m "feat(demand): append-only north-star ambition writer"
```

---

## Task 6: Dreamer schema + prompt

**Files:** Create `src/agents/prompts/dreamer.ts`; Test `test/agents/dreamerPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { dreamerPrompt, DreamResultSchema } from "../../src/agents/prompts/dreamer.ts";

describe("dreamer", () => {
  it("DreamResultSchema validates and defaults ambition to null + demands to []", () => {
    const r = DreamResultSchema.parse({});
    expect(r.ambition).toBeNull();
    expect(r.demands).toEqual([]);
  });
  it("prompt includes the north-star, the scenario summary, the cap, and the RESULT_FILE", () => {
    const p = dreamerPrompt({ northStar: "# North Star\nBe the best CRM.", scenarioSummary: "SCN-001 Login", resultPath: "/r/.adapt/demands/dream.json", maxDemands: 3 });
    expect(p).toContain("Be the best CRM");
    expect(p).toContain("SCN-001 Login");
    expect(p).toContain("RESULT_FILE=/r/.adapt/demands/dream.json");
    expect(p).toContain("3");
    expect(p.toLowerCase()).toContain("ambition");
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/agents/dreamerPrompt.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — `src/agents/prompts/dreamer.ts`:

```ts
import { z } from "zod";

export const DreamResultSchema = z.object({
  ambition: z.string().nullable().default(null),
  demands: z.array(z.object({
    title: z.string().min(1),
    rationale: z.string().default(""),
    proposedScenarios: z.array(z.string()).default([]),
  })).default([]),
});
export type DreamResult = z.infer<typeof DreamResultSchema>;

export interface DreamerPromptCtx {
  northStar: string;
  scenarioSummary: string;
  resultPath: string;
  maxDemands: number;
}

export function dreamerPrompt(ctx: DreamerPromptCtx): string {
  const { northStar, scenarioSummary, resultPath, maxDemands } = ctx;
  return `You are the Dreamer. You decide what this product should become NEXT. You may read the source code
and use the Chrome DevTools MCP to explore the running app, but you do NOT write code.

The north-star (the product's living genome) is below. The existing scenarios show what already works.

=== NORTH STAR ===
${northStar}
=== EXISTING SCENARIOS ===
${scenarioSummary}
=== END ===

Do two things:
1. AMBITION (optional): if the product has grown enough that the north-star should reach higher, propose ONE new
   ambition — a single short paragraph of new product vision to append to the genome. If nothing warrants it, use null.
   Raise the ceiling thoughtfully; do not restate existing goals.
2. DEMANDS: propose up to ${maxDemands} concrete, valuable demands — features or improvements that move the product
   toward the north-star and that a real user would notice. For each, give a title, a one-line rationale, and 1–2
   proposed user-level scenario sketches (what a user would do to exercise it). Avoid trivial or duplicate demands.

Write your result as a single JSON object to this exact path:
RESULT_FILE=${resultPath}
Shape: { "ambition": "<text>" | null, "demands": [ { "title": "...", "rationale": "...", "proposedScenarios": ["...","..."] } ] }`;
}
```

- [ ] **Step 4: Run** — `npx vitest run test/agents/dreamerPrompt.test.ts`. Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agents/prompts/dreamer.ts test/agents/dreamerPrompt.test.ts
git commit -m "feat(agents): dreamer result schema + prompt"
```

---

## Task 7: Critic schema + prompt

**Files:** Create `src/agents/prompts/critic.ts`; Test `test/agents/criticPrompt.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { criticPrompt, CriticVerdictSchema } from "../../src/agents/prompts/critic.ts";
import { newDemand } from "../../src/demand/demand.ts";

describe("critic", () => {
  it("CriticVerdictSchema validates and defaults critique", () => {
    const v = CriticVerdictSchema.parse({ decision: "approved" });
    expect(v.critique).toBe("");
  });
  it("prompt presents the demand, the north-star, and the RESULT_FILE", () => {
    const demand = newDemand({ id: "DMD-001", title: "Add CSV export", rationale: "users ask", proposedScenarios: ["Export list as CSV"], createdAt: "t" });
    const p = criticPrompt({ demand, northStar: "Be the best CRM.", resultPath: "/r/.adapt/demands/critic-DMD-001.json" });
    expect(p).toContain("DMD-001");
    expect(p).toContain("Add CSV export");
    expect(p).toContain("Be the best CRM");
    expect(p).toContain("RESULT_FILE=/r/.adapt/demands/critic-DMD-001.json");
    expect(p.toLowerCase()).toContain("approved");
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/agents/criticPrompt.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — `src/agents/prompts/critic.ts`:

```ts
import { z } from "zod";
import type { Demand } from "../../demand/demand.ts";

export const CriticVerdictSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  critique: z.string().default(""),
});
export type CriticVerdict = z.infer<typeof CriticVerdictSchema>;

export interface CriticPromptCtx {
  demand: Demand;
  northStar: string;
  resultPath: string;
}

export function criticPrompt(ctx: CriticPromptCtx): string {
  const { demand, northStar, resultPath } = ctx;
  return `You are the Critic — a skeptical product owner. Challenge the proposed demand below. Approve it ONLY if it
is genuinely valuable, aligned with the north-star, and worth building now — not bloat, busywork, or a vanity feature.
You may read the source code but do NOT write code.

=== NORTH STAR ===
${northStar}
=== PROPOSED DEMAND ${demand.id} ===
Title: ${demand.title}
Rationale: ${demand.rationale}
Proposed scenarios: ${JSON.stringify(demand.proposedScenarios)}
=== END ===

Decide "approved" or "rejected" and give a one-paragraph critique explaining why (what's strong, what's weak, or why it's bloat).

Write your verdict as a single JSON object to this exact path:
RESULT_FILE=${resultPath}
Shape: { "decision": "approved" | "rejected", "critique": "<text>" }`;
}
```

- [ ] **Step 4: Run** — `npx vitest run test/agents/criticPrompt.test.ts`. Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/agents/prompts/critic.ts test/agents/criticPrompt.test.ts
git commit -m "feat(agents): critic verdict schema + prompt"
```

---

## Task 8: `runDream`

**Files:** Create `src/demand/dream.ts`; Test `test/demand/dream.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { AdaptConfigSchema } from "../../src/config/schema.ts";
import { runDream } from "../../src/demand/dream.ts";
import { LocalDemandStore } from "../../src/demand/demandStore.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function ctx(over = {}) {
  dir = makeTmpDir();
  mkdirSync(join(dir, ".adapt", "scenarios"), { recursive: true });
  mkdirSync(join(dir, ".adapt", "demands"), { recursive: true });
  writeFileSync(join(dir, ".adapt", "north-star.md"), "# North Star\nBe great.\n", "utf8");
  const config = AdaptConfigSchema.parse({ targetRepoPath: dir, appBaseUrl: "http://x", limits: { maxDemandsPerCycle: 2, ...over } });
  return { dir: dir!, config };
}

// Dreamer stub: writes a DreamResult with `ambition` + `n` demands to RESULT_FILE.
function dreamEngine(ambition: string | null, n: number) {
  return new StubEngine({ script: (s) => {
    const path = s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim();
    const demands = Array.from({ length: n }, (_, i) => ({ title: `Demand ${i + 1}`, rationale: "r", proposedScenarios: ["do a thing"] }));
    writeFileSync(path, JSON.stringify({ ambition, demands }), "utf8");
    return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
  }});
}

describe("runDream", () => {
  it("persists demands and appends the ambition to north-star", async () => {
    const c = ctx();
    const res = await runDream({ engine: dreamEngine("Reach higher", 2), config: c.config, targetRepo: c.dir, sink: () => {}, now: () => "2026-05-26T10:00:00.000Z" });
    expect(res.ambitionAppended).toBe(true);
    expect(res.demands.length).toBe(2);
    expect(new LocalDemandStore(c.dir).list().length).toBe(2);
    expect(readFileSync(join(c.dir, ".adapt", "north-star.md"), "utf8")).toContain("Reach higher");
  });

  it("caps demands at maxDemandsPerCycle", async () => {
    const c = ctx({ maxDemandsPerCycle: 1 });
    const res = await runDream({ engine: dreamEngine(null, 5), config: c.config, targetRepo: c.dir, sink: () => {}, now: () => "t" });
    expect(res.demands.length).toBe(1);
    expect(res.ambitionAppended).toBe(false);
  });

  it("returns empty + appends nothing when the dreamer writes no result", async () => {
    const c = ctx();
    const noop = new StubEngine({ script: (s) => [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }] });
    const res = await runDream({ engine: noop, config: c.config, targetRepo: c.dir, sink: () => {}, now: () => "t" });
    expect(res.demands).toEqual([]);
    expect(res.ambitionAppended).toBe(false);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/demand/dream.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — `src/demand/dream.ts`:

```ts
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { AgentEngine, AgentEvent } from "../engine/types.ts";
import type { AdaptConfig } from "../config/schema.ts";
import { workspacePaths } from "../workspace/paths.ts";
import { rebuildRegistry } from "../scenarios/registry.ts";
import { runRole } from "../agents/runRole.ts";
import { mcpServersFor } from "../engine/mcp.ts";
import { dreamerPrompt, DreamResultSchema } from "../agents/prompts/dreamer.ts";
import { LocalDemandStore } from "./demandStore.ts";
import { newDemand, type Demand } from "./demand.ts";
import { appendAmbition } from "./northStar.ts";

export interface DreamDeps {
  engine: AgentEngine;
  config: AdaptConfig;
  targetRepo: string;
  sink: (e: AgentEvent) => void;
  now?: () => string;
}

/** One Dreamer pass: append an ambition (if proposed) and persist capped demands. */
export async function runDream(deps: DreamDeps): Promise<{ ambitionAppended: boolean; demands: Demand[] }> {
  const { engine, config, targetRepo, sink } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const ws = workspacePaths(targetRepo);
  const store = new LocalDemandStore(targetRepo);

  const northStar = existsSync(ws.northStar) ? readFileSync(ws.northStar, "utf8") : "";
  const scenarioSummary = rebuildRegistry(targetRepo).map((e) => `${e.id} ${e.title}`).join("\n") || "(none yet)";
  const resultPath = join(ws.demandsDir, "dream.json");

  const outcome = await runRole(
    engine,
    {
      role: "dreamer",
      prompt: dreamerPrompt({ northStar, scenarioSummary, resultPath, maxDemands: config.limits.maxDemandsPerCycle }),
      cwd: targetRepo,
      mcpServers: mcpServersFor("dreamer", config),
    },
    resultPath, DreamResultSchema, sink,
  );

  if (outcome.status !== "ok" || !outcome.value) return { ambitionAppended: false, demands: [] };

  let ambitionAppended = false;
  if (outcome.value.ambition) {
    appendAmbition(targetRepo, outcome.value.ambition, now);
    ambitionAppended = true;
  }

  const created: Demand[] = [];
  for (const d of outcome.value.demands.slice(0, config.limits.maxDemandsPerCycle)) {
    const demand = newDemand({ id: store.nextId(), title: d.title, rationale: d.rationale, proposedScenarios: d.proposedScenarios, createdAt: now() });
    store.create(demand);
    created.push(demand);
  }
  return { ambitionAppended, demands: created };
}
```

- [ ] **Step 4: Run** — `npx vitest run test/demand/dream.test.ts`. Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/demand/dream.ts test/demand/dream.test.ts
git commit -m "feat(demand): runDream — persist capped demands + append ambition"
```

---

## Task 9: `runCritique` + full verification

**Files:** Create `src/demand/critique.ts`; Test `test/demand/critique.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
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
  writeFileSync(join(dir, ".adapt", "north-star.md"), "# North Star\nBe great.\n", "utf8");
  const config = AdaptConfigSchema.parse({ targetRepoPath: dir, appBaseUrl: "http://x" });
  const store = new LocalDemandStore(dir);
  return { dir: dir!, config, store };
}

// Critic stub: approves DMD-001, rejects everything else.
function criticEngine() {
  return new StubEngine({ script: (s) => {
    const path = s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim();
    const approve = s.prompt.includes("DMD-001");
    writeFileSync(path, JSON.stringify({ decision: approve ? "approved" : "rejected", critique: "because" }), "utf8");
    return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
  }});
}

describe("runCritique", () => {
  it("approves/rejects each proposed demand and returns the approved ones", async () => {
    const c = ctx();
    c.store.create(newDemand({ id: "DMD-001", title: "good", rationale: "r", proposedScenarios: [], createdAt: "t" }));
    c.store.create(newDemand({ id: "DMD-002", title: "bloat", rationale: "r", proposedScenarios: [], createdAt: "t" }));
    const approved = await runCritique({ engine: criticEngine(), config: c.config, targetRepo: c.dir, sink: () => {} });
    expect(approved.map((d) => d.id)).toEqual(["DMD-001"]);
    expect(c.store.listByStatus("approved").map((d) => d.id)).toEqual(["DMD-001"]);
    expect(c.store.listByStatus("rejected").map((d) => d.id)).toEqual(["DMD-002"]);
    expect(c.store.list().find((d) => d.id === "DMD-001")!.critique).toBe("because");
  });

  it("only critiques proposed demands (skips already-decided)", async () => {
    const c = ctx();
    c.store.create({ ...newDemand({ id: "DMD-001", title: "done", rationale: "r", proposedScenarios: [], createdAt: "t" }), status: "approved" });
    const approved = await runCritique({ engine: criticEngine(), config: c.config, targetRepo: c.dir, sink: () => {} });
    expect(approved).toEqual([]); // nothing in "proposed"
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/demand/critique.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement** — `src/demand/critique.ts`:

```ts
import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { AgentEngine, AgentEvent } from "../engine/types.ts";
import type { AdaptConfig } from "../config/schema.ts";
import { workspacePaths } from "../workspace/paths.ts";
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

  const approved: Demand[] = [];
  for (const demand of store.listByStatus("proposed")) {
    const resultPath = join(ws.demandsDir, `critic-${demand.id}.json`);
    const outcome = await runRole(
      engine,
      {
        role: "critic",
        prompt: criticPrompt({ demand, northStar, resultPath }),
        cwd: targetRepo,
        mcpServers: mcpServersFor("critic", config),
      },
      resultPath, CriticVerdictSchema, sink,
    );
    if (outcome.status !== "ok" || !outcome.value) continue; // no valid verdict → leave proposed, skip
    const decided: Demand = { ...demand, status: outcome.value.decision, critique: outcome.value.critique };
    store.update(decided);
    if (decided.status === "approved") approved.push(decided);
  }
  return approved;
}
```

- [ ] **Step 4: Run** — `npx vitest run test/demand/critique.test.ts` (PASS, 2 tests), then `npx vitest run` (ALL pass) and `npx tsc --noEmit` (exit 0). Report all.

- [ ] **Step 5: Commit**

```bash
git add src/demand/critique.ts test/demand/critique.test.ts
git commit -m "feat(demand): runCritique — adversarial gate over proposed demands"
```

---

## Self-Review (completed during authoring)

- **Spec coverage (Plan 7):** demand caps config (§4 caps) → Task 1; MCP role mappings for the 3 demand roles (§3.1) → Task 2; Demand artifact (§4) → Tasks 3–4; append-only north-star, Node-writes (§2.1, §5) → Tasks 5, 8; Dreamer + DreamResult (§3.1, §5) → Tasks 6, 8; Critic gate + verdict (§3.1, §5, §7) → Tasks 7, 9; caps enforced (§7) → Task 8; demand-cycle = dream then critique (§6) → Tasks 8–9. Missing/invalid result → safe no-op (§5) → Tasks 8, 9.
- **Type consistency:** `Demand`/`DemandSchema`/`newDemand`, `LocalDemandStore` (list/listByStatus/nextId/create/update), `DreamResult`/`DreamResultSchema`, `CriticVerdict`/`CriticVerdictSchema`, `DreamDeps`/`CritiqueDeps`, `appendAmbition`, `mcpServersFor` extended `RoleName`, `workspacePaths().demandsDir`. Result files live in `.adapt/demands/` (`dream.json`, `critic-<id>.json`) but `LocalDemandStore.list` filters `DMD-` so they don't pollute the demand list. These are consumed unchanged by Plan 8 (`runGenerate` reads approved demands) and Plan 9 (`runDemandStage`/`runEvolve`).
- **Reused unchanged:** `runRole`, `StubEngine`, `rebuildRegistry`, `workspacePaths`, `AdaptConfig`.
- **Deferred to Plan 8/9:** the Scenario Generator (consumes approved demands), `runDemandStage` composition, `adapt evolve`, scaffolding `.adapt/demands/` in `adapt init` (the store mkdirs it on first use, so not blocking).

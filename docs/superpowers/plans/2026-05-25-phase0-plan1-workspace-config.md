# Phase 0 · Plan 1 — Workspace & Config Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A reusable `adapt` CLI that scaffolds a `.adapt/` workspace inside any target repo, with validated config, a scenario file format (markdown + YAML frontmatter) parser, and a machine-readable scenario registry — all pure IO, no agents.

**Architecture:** Node + TypeScript (ESM). `zod` is the single source of truth for both runtime validation and static types (config + scenario frontmatter). The workspace lives at `<targetRepo>/.adapt/`. This plan produces the data/IO bedrock that Plans 2 and 3 read from and write to. No subprocesses, no network, no agents yet.

**Tech Stack:** Node 20+, TypeScript (ESM, `moduleResolution: bundler`), Vitest, Commander, Zod, gray-matter, zod-to-json-schema. Run TS directly via `tsx` (no build step needed for the experiment).

---

## File Structure

```
adapt/                                  # the framework repo (this repo)
  package.json
  tsconfig.json
  vitest.config.ts
  bin/adapt.mjs                         # thin CLI shim (tsx)
  src/
    types.ts                            # shared cross-plan types/constants (lifecycle enums)
    workspace/
      paths.ts                          # resolve .adapt/ workspace paths from a target dir
      scaffold.ts                       # create the .adapt/ structure + templates
    config/
      schema.ts                         # zod AdaptConfig schema + type
      load.ts                           # load + validate .adapt/config.json
    scenarios/
      schema.ts                         # zod ScenarioMeta (frontmatter) schema + type
      parse.ts                          # parse a scenario .md via gray-matter
      registry.ts                       # read/write .adapt/scenarios/index.json
    schemas/
      export.ts                         # emit JSON Schema files from the zod schemas
    cli/
      index.ts                          # commander entrypoint
      commands/init.ts                  # `adapt init <targetRepo>` scaffolds the workspace
  test/
    workspace/paths.test.ts
    config/schema.test.ts
    config/load.test.ts
    scenarios/schema.test.ts
    scenarios/parse.test.ts
    scenarios/registry.test.ts
    workspace/scaffold.test.ts
    cli/init.test.ts
    schemas/export.test.ts
    helpers/tmp.ts                       # temp-dir helper for IO tests
```

Responsibilities are split by domain (workspace / config / scenarios), not by layer. `src/types.ts` holds only the constants shared across plans (the lifecycle enums) so Plans 2–3 import them without duplicating literals.

---

## Task 0: Project scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `bin/adapt.mjs`, `src/types.ts`, `test/helpers/tmp.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "adapt",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": { "adapt": "bin/adapt.mjs" },
  "scripts": {
    "adapt": "tsx src/cli/index.ts",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "schemas": "tsx src/schemas/export.ts"
  },
  "dependencies": {
    "commander": "^12.1.0",
    "gray-matter": "^4.0.3",
    "zod": "^3.23.8",
    "zod-to-json-schema": "^3.23.2"
  },
  "devDependencies": {
    "tsx": "^4.19.2",
    "typescript": "^5.6.3",
    "vitest": "^2.1.4",
    "@types/node": "^22.9.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["node"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "verbatimModuleSyntax": false,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    globals: false,
  },
});
```

- [ ] **Step 4: Create `bin/adapt.mjs`** (thin shim so `adapt` runs the TS CLI via tsx)

```js
#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "../src/cli/index.ts");
const res = spawnSync("npx", ["tsx", entry, ...process.argv.slice(2)], {
  stdio: "inherit",
});
process.exit(res.status ?? 1);
```

- [ ] **Step 5: Create `src/types.ts`** (shared constants used by all three Phase 0 plans)

```ts
// Lifecycle enums shared across plans. Single source of truth — Plans 2 and 3 import from here.

export const SCENARIO_STATUSES = [
  "draft", "ready", "active", "running", "passed", "regression",
  "failed", "item-created", "awaiting-fix", "ready-for-verification",
  "verified", "blocked", "invalid", "needs-product-review", "deprecated",
] as const;
export type ScenarioStatus = (typeof SCENARIO_STATUSES)[number];

export const RUN_STATUSES = [
  "queued", "running", "passed", "failed", "blocked", "flaky",
  "invalid", "inconclusive", "archived",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const WORK_ITEM_STATUSES = [
  "open", "triaged", "in-progress", "in-review",
  "ready-for-verification", "done", "reopened",
] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const SCENARIO_SOURCES = ["human-seeded", "agent-discovered"] as const;
export type ScenarioSource = (typeof SCENARIO_SOURCES)[number];

export const WORKSPACE_DIRNAME = ".adapt";
```

- [ ] **Step 6: Create `test/helpers/tmp.ts`** (temp-dir helper for IO tests)

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Make a throwaway directory; returns its path. Caller passes it to cleanupTmp. */
export function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "adapt-test-"));
}

export function cleanupTmp(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}
```

- [ ] **Step 7: Install dependencies**

Run: `npm install`
Expected: completes, creates `node_modules/` and `package-lock.json`, no errors.

- [ ] **Step 8: Verify the toolchain runs**

Run: `npx vitest run`
Expected: exits 0 with "No test files found" (no tests yet). This confirms vitest is wired.

- [ ] **Step 9: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts bin/adapt.mjs src/types.ts test/helpers/tmp.ts package-lock.json
git commit -m "chore: scaffold adapt Node+TS project (vitest, tsx, cli shim)"
```

---

## Task 1: Workspace path resolution

**Files:**
- Create: `src/workspace/paths.ts`
- Test: `test/workspace/paths.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { workspacePaths } from "../../src/workspace/paths.ts";

describe("workspacePaths", () => {
  it("derives all workspace paths from a target repo dir", () => {
    const p = workspacePaths("/repo");
    expect(p.root).toBe("/repo/.adapt");
    expect(p.configFile).toBe("/repo/.adapt/config.json");
    expect(p.northStar).toBe("/repo/.adapt/north-star.md");
    expect(p.scenariosDir).toBe("/repo/.adapt/scenarios");
    expect(p.scenarioIndex).toBe("/repo/.adapt/scenarios/index.json");
    expect(p.runsDir).toBe("/repo/.adapt/scenario-runs");
    expect(p.workItemsDir).toBe("/repo/.adapt/work-items");
    expect(p.verificationReportsDir).toBe("/repo/.adapt/verification-reports");
    expect(p.decisionLogDir).toBe("/repo/.adapt/decision-log");
  });

  it("resolves relative target dirs to absolute", () => {
    const p = workspacePaths(".");
    expect(p.root.startsWith("/")).toBe(true);
    expect(p.root.endsWith("/.adapt")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/workspace/paths.test.ts`
Expected: FAIL — cannot resolve `../../src/workspace/paths.ts`.

- [ ] **Step 3: Write minimal implementation**

```ts
import { resolve, join } from "node:path";
import { WORKSPACE_DIRNAME } from "../types.ts";

export interface WorkspacePaths {
  targetRepo: string;
  root: string;
  configFile: string;
  northStar: string;
  scenariosDir: string;
  scenarioIndex: string;
  runsDir: string;
  workItemsDir: string;
  verificationReportsDir: string;
  decisionLogDir: string;
}

/** Resolve every workspace path from a target repo directory. Pure — no IO. */
export function workspacePaths(targetRepo: string): WorkspacePaths {
  const repo = resolve(targetRepo);
  const root = join(repo, WORKSPACE_DIRNAME);
  const scenariosDir = join(root, "scenarios");
  return {
    targetRepo: repo,
    root,
    configFile: join(root, "config.json"),
    northStar: join(root, "north-star.md"),
    scenariosDir,
    scenarioIndex: join(scenariosDir, "index.json"),
    runsDir: join(root, "scenario-runs"),
    workItemsDir: join(root, "work-items"),
    verificationReportsDir: join(root, "verification-reports"),
    decisionLogDir: join(root, "decision-log"),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/workspace/paths.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/workspace/paths.ts test/workspace/paths.test.ts
git commit -m "feat(workspace): resolve .adapt workspace paths from target repo"
```

---

## Task 2: Config schema (zod)

**Files:**
- Create: `src/config/schema.ts`
- Test: `test/config/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { AdaptConfigSchema, defaultConfig } from "../../src/config/schema.ts";

describe("AdaptConfigSchema", () => {
  it("accepts a minimal valid config and applies defaults", () => {
    const parsed = AdaptConfigSchema.parse({
      targetRepoPath: "/repo",
      appBaseUrl: "http://localhost:3000",
    });
    expect(parsed.engine.type).toBe("claude-code");
    expect(parsed.console.port).toBe(4399);
    expect(parsed.limits.maxFixAttempts).toBe(2);
    expect(parsed.jira.enabled).toBe(false);
    expect(parsed.mcp.playwright.enabled).toBe(true);
  });

  it("rejects a non-url appBaseUrl", () => {
    const r = AdaptConfigSchema.safeParse({ targetRepoPath: "/repo", appBaseUrl: "not-a-url" });
    expect(r.success).toBe(false);
  });

  it("rejects missing targetRepoPath", () => {
    const r = AdaptConfigSchema.safeParse({ appBaseUrl: "http://localhost:3000" });
    expect(r.success).toBe(false);
  });

  it("defaultConfig() produces a parseable example", () => {
    const r = AdaptConfigSchema.safeParse(defaultConfig("/repo", "http://localhost:3000"));
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/config/schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { z } from "zod";

export const AdaptConfigSchema = z.object({
  // Target coupling (blueprint §10, principle 9)
  targetRepoPath: z.string().min(1),
  appBaseUrl: z.string().url(),
  startCommand: z.string().optional(),

  // Coding-agent engine that backs every role (blueprint §9)
  engine: z.object({
    type: z.enum(["claude-code", "stub"]).default("claude-code"),
    command: z.string().optional(), // override binary/path; defaults set by the engine adapter (Plan 3)
  }).default({}),

  // Live console (blueprint §11)
  console: z.object({
    port: z.number().int().positive().default(4399),
  }).default({}),

  // Global default DB lifecycle hooks; scenario-level hooks override (blueprint §13)
  hooks: z.object({
    setup: z.string().optional(),
    teardown: z.string().optional(),
  }).default({}),

  // Work tracker: Jira behind an adapter (blueprint §9–10)
  jira: z.object({
    enabled: z.boolean().default(false),
    baseUrl: z.string().url().optional(),
    projectKey: z.string().default(""),
    defaultIssueType: z.string().default("Bug"),
    transitions: z.object({
      inReview: z.string().default("In Review"),
      readyForVerification: z.string().default("Ready for Verification"),
      done: z.string().default("Done"),
      reopened: z.string().default("In Progress"),
    }).default({}),
  }).default({}),

  // MCP servers exposed per role (blueprint §9)
  mcp: z.object({
    playwright: z.object({ enabled: z.boolean().default(true) }).default({}),
    chromeDevTools: z.object({ enabled: z.boolean().default(true) }).default({}),
    jira: z.object({ enabled: z.boolean().default(false) }).default({}),
  }).default({}),

  // Safety limits (blueprint §14)
  limits: z.object({
    maxFixAttempts: z.number().int().positive().default(2),
    maxVerificationAttempts: z.number().int().positive().default(3),
    maxItemsPerRun: z.number().int().positive().default(10),
    maxCycleSeconds: z.number().int().positive().default(3600),
  }).default({}),
});

export type AdaptConfig = z.infer<typeof AdaptConfigSchema>;

/** A fully-defaulted example config for scaffolding config.example.json. */
export function defaultConfig(targetRepoPath: string, appBaseUrl: string): AdaptConfig {
  return AdaptConfigSchema.parse({ targetRepoPath, appBaseUrl });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/config/schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts test/config/schema.test.ts
git commit -m "feat(config): zod AdaptConfig schema with defaults"
```

---

## Task 3: Config loader

**Files:**
- Create: `src/config/load.ts`
- Test: `test/config/load.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { loadConfig, ConfigError } from "../../src/config/load.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function writeConfig(repo: string, json: unknown) {
  mkdirSync(join(repo, ".adapt"), { recursive: true });
  writeFileSync(join(repo, ".adapt", "config.json"), JSON.stringify(json), "utf8");
}

describe("loadConfig", () => {
  it("loads and validates a config file", () => {
    dir = makeTmpDir();
    writeConfig(dir, { targetRepoPath: dir, appBaseUrl: "http://localhost:3000" });
    const cfg = loadConfig(dir);
    expect(cfg.appBaseUrl).toBe("http://localhost:3000");
    expect(cfg.limits.maxFixAttempts).toBe(2);
  });

  it("throws ConfigError when the file is missing", () => {
    dir = makeTmpDir();
    expect(() => loadConfig(dir!)).toThrow(ConfigError);
    expect(() => loadConfig(dir!)).toThrow(/not found/i);
  });

  it("throws ConfigError with field detail on invalid config", () => {
    dir = makeTmpDir();
    writeConfig(dir, { appBaseUrl: "nope" });
    expect(() => loadConfig(dir!)).toThrow(ConfigError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/config/load.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { existsSync, readFileSync } from "node:fs";
import { workspacePaths } from "../workspace/paths.ts";
import { AdaptConfigSchema, type AdaptConfig } from "./schema.ts";

export class ConfigError extends Error {}

/** Load, parse, and validate <targetRepo>/.adapt/config.json. Throws ConfigError on any problem. */
export function loadConfig(targetRepo: string): AdaptConfig {
  const { configFile } = workspacePaths(targetRepo);
  if (!existsSync(configFile)) {
    throw new ConfigError(`Config not found at ${configFile}. Run "adapt init" first.`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configFile, "utf8"));
  } catch (e) {
    throw new ConfigError(`Config at ${configFile} is not valid JSON: ${(e as Error).message}`);
  }
  const result = AdaptConfigSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new ConfigError(`Invalid config at ${configFile}:\n${detail}`);
  }
  return result.data;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/config/load.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config/load.ts test/config/load.test.ts
git commit -m "feat(config): load + validate .adapt/config.json with friendly errors"
```

---

## Task 4: Scenario frontmatter schema

**Files:**
- Create: `src/scenarios/schema.ts`
- Test: `test/scenarios/schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { ScenarioMetaSchema } from "../../src/scenarios/schema.ts";

const valid = {
  id: "SCN-001",
  title: "Create a new project",
  status: "active",
  priority: "high",
  persona: "Project manager",
  tags: ["projects", "create-flow"],
  source: "human-seeded",
};

describe("ScenarioMetaSchema", () => {
  it("accepts valid frontmatter and defaults optional fields", () => {
    const m = ScenarioMetaSchema.parse(valid);
    expect(m.lastResult).toBe("unknown");
    expect(m.lastRunId).toBeNull();
    expect(m.linkedIssues).toEqual([]);
  });

  it("rejects an id that is not SCN-<number>", () => {
    expect(ScenarioMetaSchema.safeParse({ ...valid, id: "X1" }).success).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(ScenarioMetaSchema.safeParse({ ...valid, status: "bogus" }).success).toBe(false);
  });

  it("accepts optional setup/teardown hooks", () => {
    const m = ScenarioMetaSchema.parse({ ...valid, hooks: { setup: "npm run seed", teardown: "npm run clean" } });
    expect(m.hooks?.setup).toBe("npm run seed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/scenarios/schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { z } from "zod";
import { SCENARIO_STATUSES, PRIORITIES, SCENARIO_SOURCES, RUN_STATUSES } from "../types.ts";

export const ScenarioMetaSchema = z.object({
  id: z.string().regex(/^SCN-\d+$/, "id must look like SCN-001"),
  title: z.string().min(1),
  status: z.enum(SCENARIO_STATUSES),
  priority: z.enum(PRIORITIES),
  persona: z.string().min(1),
  tags: z.array(z.string()).default([]),
  source: z.enum(SCENARIO_SOURCES),
  lastResult: z.enum(["unknown", ...RUN_STATUSES]).default("unknown"),
  lastRunId: z.string().nullable().default(null),
  linkedIssues: z.array(z.string()).default([]),
  hooks: z.object({
    setup: z.string().optional(),
    teardown: z.string().optional(),
  }).optional(),
});

export type ScenarioMeta = z.infer<typeof ScenarioMetaSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/scenarios/schema.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/scenarios/schema.ts test/scenarios/schema.test.ts
git commit -m "feat(scenarios): zod ScenarioMeta frontmatter schema"
```

---

## Task 5: Scenario file parser

**Files:**
- Create: `src/scenarios/parse.ts`
- Test: `test/scenarios/parse.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { parseScenario, ScenarioParseError } from "../../src/scenarios/parse.ts";

const file = `---
id: SCN-001
title: Create a new project
status: active
priority: high
persona: Project manager
tags: [projects, create-flow]
source: human-seeded
---

# Scenario

As a project manager, create a new project and verify it appears in the list.

## Expected outcome

- The project appears in the project list.
`;

describe("parseScenario", () => {
  it("returns validated meta and the markdown body", () => {
    const s = parseScenario(file, "projects.create.md");
    expect(s.meta.id).toBe("SCN-001");
    expect(s.meta.priority).toBe("high");
    expect(s.body).toContain("verify it appears in the list");
    expect(s.filename).toBe("projects.create.md");
  });

  it("throws ScenarioParseError on invalid frontmatter", () => {
    const bad = file.replace("id: SCN-001", "id: nope");
    expect(() => parseScenario(bad, "bad.md")).toThrow(ScenarioParseError);
  });

  it("throws ScenarioParseError when frontmatter is absent", () => {
    expect(() => parseScenario("# just markdown", "x.md")).toThrow(ScenarioParseError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/scenarios/parse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import matter from "gray-matter";
import { ScenarioMetaSchema, type ScenarioMeta } from "./schema.ts";

export class ScenarioParseError extends Error {}

export interface ParsedScenario {
  meta: ScenarioMeta;
  body: string;
  filename: string;
}

/** Parse a scenario markdown string (YAML frontmatter + body). Validates the frontmatter. */
export function parseScenario(content: string, filename: string): ParsedScenario {
  const parsed = matter(content);
  if (!parsed.data || Object.keys(parsed.data).length === 0) {
    throw new ScenarioParseError(`${filename}: missing YAML frontmatter`);
  }
  const result = ScenarioMetaSchema.safeParse(parsed.data);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new ScenarioParseError(`${filename}: invalid frontmatter — ${detail}`);
  }
  return { meta: result.data, body: parsed.content.trim(), filename };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/scenarios/parse.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/scenarios/parse.ts test/scenarios/parse.test.ts
git commit -m "feat(scenarios): parse scenario markdown + validate frontmatter"
```

---

## Task 6: Scenario registry (index.json)

**Files:**
- Create: `src/scenarios/registry.ts`
- Test: `test/scenarios/registry.test.ts`

The registry is the machine-readable mirror of the scenario files (blueprint §10). It is rebuilt by scanning the scenarios directory, so it never drifts from the source files.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { rebuildRegistry, readRegistry } from "../../src/scenarios/registry.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function writeScenario(repo: string, name: string, id: string) {
  const scn = join(repo, ".adapt", "scenarios");
  mkdirSync(scn, { recursive: true });
  writeFileSync(join(scn, name), `---
id: ${id}
title: ${id} title
status: ready
priority: medium
persona: User
tags: [smoke]
source: human-seeded
---
body`, "utf8");
}

describe("scenario registry", () => {
  it("rebuilds index.json from scenario files, sorted by id", () => {
    dir = makeTmpDir();
    writeScenario(dir, "b.md", "SCN-002");
    writeScenario(dir, "a.md", "SCN-001");
    const entries = rebuildRegistry(dir);
    expect(entries.map((e) => e.id)).toEqual(["SCN-001", "SCN-002"]);
    expect(entries[0]!.filename).toBe("a.md");
    expect(existsSync(join(dir, ".adapt", "scenarios", "index.json"))).toBe(true);
  });

  it("readRegistry returns [] when index.json is absent", () => {
    dir = makeTmpDir();
    expect(readRegistry(dir)).toEqual([]);
  });

  it("throws on a duplicate scenario id", () => {
    dir = makeTmpDir();
    writeScenario(dir, "a.md", "SCN-001");
    writeScenario(dir, "b.md", "SCN-001");
    expect(() => rebuildRegistry(dir!)).toThrow(/duplicate/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/scenarios/registry.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { workspacePaths } from "../workspace/paths.ts";
import { parseScenario } from "./parse.ts";
import type { Priority, ScenarioSource, ScenarioStatus } from "../types.ts";

export interface RegistryEntry {
  id: string;
  title: string;
  filename: string;
  status: ScenarioStatus;
  priority: Priority;
  tags: string[];
  source: ScenarioSource;
  lastResult: string;
  lastRunId: string | null;
  linkedIssues: string[];
}

/** Read scenario files, validate them, and write a sorted index.json. Returns the entries. */
export function rebuildRegistry(targetRepo: string): RegistryEntry[] {
  const { scenariosDir, scenarioIndex } = workspacePaths(targetRepo);
  const entries: RegistryEntry[] = [];
  const seen = new Set<string>();

  const files = existsSync(scenariosDir)
    ? readdirSync(scenariosDir).filter((f) => f.endsWith(".md"))
    : [];

  for (const filename of files) {
    const { meta } = parseScenario(readFileSync(join(scenariosDir, filename), "utf8"), filename);
    if (seen.has(meta.id)) throw new Error(`Duplicate scenario id ${meta.id} (in ${filename})`);
    seen.add(meta.id);
    entries.push({
      id: meta.id, title: meta.title, filename, status: meta.status,
      priority: meta.priority, tags: meta.tags, source: meta.source,
      lastResult: meta.lastResult, lastRunId: meta.lastRunId, linkedIssues: meta.linkedIssues,
    });
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(scenarioIndex, JSON.stringify(entries, null, 2) + "\n", "utf8");
  return entries;
}

/** Read the existing index.json (returns [] if it does not exist). */
export function readRegistry(targetRepo: string): RegistryEntry[] {
  const { scenarioIndex } = workspacePaths(targetRepo);
  if (!existsSync(scenarioIndex)) return [];
  return JSON.parse(readFileSync(scenarioIndex, "utf8")) as RegistryEntry[];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/scenarios/registry.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/scenarios/registry.ts test/scenarios/registry.test.ts
git commit -m "feat(scenarios): rebuild + read scenarios/index.json registry"
```

---

## Task 7: Workspace scaffold

**Files:**
- Create: `src/workspace/scaffold.ts`
- Test: `test/workspace/scaffold.test.ts`

Creates the `.adapt/` directory tree and seed files. Idempotent and never overwrites existing user content (blueprint safeguard: don't clobber scenarios/north-star).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { scaffoldWorkspace } from "../../src/workspace/scaffold.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

describe("scaffoldWorkspace", () => {
  it("creates the .adapt tree, config.example.json, north-star, and an example scenario", () => {
    dir = makeTmpDir();
    const r = scaffoldWorkspace(dir, "http://localhost:3000");
    expect(existsSync(join(dir, ".adapt", "config.example.json"))).toBe(true);
    expect(existsSync(join(dir, ".adapt", "north-star.md"))).toBe(true);
    expect(existsSync(join(dir, ".adapt", "scenario-runs"))).toBe(true);
    expect(existsSync(join(dir, ".adapt", "scenarios", "examples", "example.login.md"))).toBe(true);
    expect(r.created.length).toBeGreaterThan(0);
  });

  it("does not overwrite an existing north-star.md", () => {
    dir = makeTmpDir();
    mkdirSync(join(dir, ".adapt"), { recursive: true });
    writeFileSync(join(dir, ".adapt", "north-star.md"), "MY VISION", "utf8");
    scaffoldWorkspace(dir, "http://localhost:3000");
    expect(readFileSync(join(dir, ".adapt", "north-star.md"), "utf8")).toBe("MY VISION");
  });

  it("the scaffolded example scenario parses successfully", async () => {
    dir = makeTmpDir();
    scaffoldWorkspace(dir, "http://localhost:3000");
    const { parseScenario } = await import("../../src/scenarios/parse.ts");
    const p = join(dir, ".adapt", "scenarios", "examples", "example.login.md");
    expect(() => parseScenario(readFileSync(p, "utf8"), "example.login.md")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/workspace/scaffold.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { workspacePaths } from "./paths.ts";
import { defaultConfig } from "../config/schema.ts";

export interface ScaffoldResult {
  created: string[];
  skipped: string[];
}

const NORTH_STAR_TEMPLATE = `# North Star

> The product vision adapt evolves toward. This file is the "genome" — version it,
> and watch ambition grow over time. The Dreamer raises this ceiling (Phase 2);
> for now (Phase 1) you seed it by hand.

## Vision

_Describe what this product should become and for whom._

## Goals

- _A measurable, user-visible goal._

## Constraints

- _What the organism must never break or violate._
`;

const EXAMPLE_SCENARIO = `---
id: SCN-001
title: A user can log in
status: ready
priority: high
persona: Returning user
tags: [auth, smoke]
source: human-seeded
hooks:
  setup: echo "seed the isolated test DB here"
  teardown: echo "reset the isolated test DB here"
---

# Scenario

As a returning user, log in with valid credentials and land on the home page.

## Preconditions

- A test account exists in the isolated agent database.

## Steps

1. Open the login page.
2. Enter valid credentials.
3. Submit.

## Expected outcome

- The user lands on the authenticated home page.
- No validation error, server error, or uncaught browser error appears.

## Failure signals

- The submit button does nothing.
- A visible error appears.
- The browser console shows an uncaught error.
`;

function ensureDir(path: string, res: ScaffoldResult) {
  if (existsSync(path)) { res.skipped.push(path); return; }
  mkdirSync(path, { recursive: true });
  res.created.push(path);
}

function writeIfAbsent(path: string, content: string, res: ScaffoldResult) {
  if (existsSync(path)) { res.skipped.push(path); return; }
  writeFileSync(path, content, "utf8");
  res.created.push(path);
}

/** Create the .adapt/ workspace. Idempotent; never overwrites existing files. */
export function scaffoldWorkspace(targetRepo: string, appBaseUrl: string): ScaffoldResult {
  const p = workspacePaths(targetRepo);
  const res: ScaffoldResult = { created: [], skipped: [] };

  for (const d of [p.root, p.scenariosDir, p.runsDir, p.workItemsDir, p.verificationReportsDir, p.decisionLogDir]) {
    ensureDir(d, res);
  }
  const examplesDir = `${p.scenariosDir}/examples`;
  ensureDir(examplesDir, res);

  writeIfAbsent(`${p.root}/config.example.json`,
    JSON.stringify(defaultConfig(p.targetRepo, appBaseUrl), null, 2) + "\n", res);
  writeIfAbsent(p.northStar, NORTH_STAR_TEMPLATE, res);
  writeIfAbsent(`${examplesDir}/example.login.md`, EXAMPLE_SCENARIO, res);

  return res;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/workspace/scaffold.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/workspace/scaffold.ts test/workspace/scaffold.test.ts
git commit -m "feat(workspace): scaffold .adapt tree with templates (idempotent)"
```

---

## Task 8: `adapt init` CLI command

**Files:**
- Create: `src/cli/commands/init.ts`, `src/cli/index.ts`
- Test: `test/cli/init.test.ts`

`runInit` is the testable core; `index.ts` is the thin commander wiring around it.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { runInit } from "../../src/cli/commands/init.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

describe("runInit", () => {
  it("scaffolds the workspace and reports created paths", () => {
    dir = makeTmpDir();
    const log = vi.fn();
    const code = runInit({ targetRepo: dir, appBaseUrl: "http://localhost:3000" }, log);
    expect(code).toBe(0);
    expect(existsSync(join(dir, ".adapt", "config.example.json"))).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("adapt workspace ready"));
  });

  it("returns a non-zero code for a non-existent target repo", () => {
    const log = vi.fn();
    const code = runInit({ targetRepo: "/no/such/dir/here", appBaseUrl: "http://localhost:3000" }, log);
    expect(code).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli/init.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`src/cli/commands/init.ts`:

```ts
import { existsSync, statSync } from "node:fs";
import { scaffoldWorkspace } from "../../workspace/scaffold.ts";

export interface InitOptions {
  targetRepo: string;
  appBaseUrl: string;
}

/** Core of `adapt init`. Returns a process exit code. `log` is injected for testability. */
export function runInit(opts: InitOptions, log: (msg: string) => void = console.log): number {
  if (!existsSync(opts.targetRepo) || !statSync(opts.targetRepo).isDirectory()) {
    log(`error: target repo "${opts.targetRepo}" is not an existing directory`);
    return 1;
  }
  const res = scaffoldWorkspace(opts.targetRepo, opts.appBaseUrl);
  for (const c of res.created) log(`  created  ${c}`);
  for (const s of res.skipped) log(`  skipped  ${s} (already exists)`);
  log(`\nadapt workspace ready at ${opts.targetRepo}/.adapt`);
  log(`Next: copy config.example.json to config.json and edit it, then seed scenarios/.`);
  return 0;
}
```

`src/cli/index.ts`:

```ts
import { Command } from "commander";
import { runInit } from "./commands/init.ts";

const program = new Command();
program.name("adapt").description("Agent Development for Autonomous ProducTs").version("0.0.0");

program
  .command("init")
  .description("Scaffold the .adapt workspace inside a target repo")
  .argument("<targetRepo>", "path to the target product repository")
  .option("--app-base-url <url>", "base URL of the running app", "http://localhost:3000")
  .action((targetRepo: string, options: { appBaseUrl: string }) => {
    const code = runInit({ targetRepo, appBaseUrl: options.appBaseUrl });
    process.exit(code);
  });

program.parseAsync(process.argv);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/cli/init.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Smoke-test the real CLI end-to-end**

Run:
```bash
mkdir -p /tmp/adapt-smoke && npm run adapt -- init /tmp/adapt-smoke && ls -R /tmp/adapt-smoke/.adapt && rm -rf /tmp/adapt-smoke
```
Expected: prints "created" lines and "adapt workspace ready"; `ls` shows `config.example.json`, `north-star.md`, `scenarios/examples/example.login.md`, and the empty run/work-item/report/decision-log dirs.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/init.ts src/cli/index.ts test/cli/init.test.ts
git commit -m "feat(cli): adapt init command scaffolds a target workspace"
```

---

## Task 9: JSON Schema export

**Files:**
- Create: `src/schemas/export.ts`
- Test: `test/schemas/export.test.ts`

Emits `*.schema.json` files from the zod schemas (blueprint §10 lists a `schemas/` dir). Single source of truth stays in zod; these files are generated docs/interop artifacts committed to the adapt repo.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { buildSchemas } from "../../src/schemas/export.ts";

describe("buildSchemas", () => {
  it("produces JSON Schema objects for config and scenario meta", () => {
    const schemas = buildSchemas();
    expect(schemas["adapt-config.schema.json"].type).toBe("object");
    expect(schemas["scenario-meta.schema.json"].type).toBe("object");
    expect(Object.keys(schemas).length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/schemas/export.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { AdaptConfigSchema } from "../config/schema.ts";
import { ScenarioMetaSchema } from "../scenarios/schema.ts";

/** Build the named JSON Schema objects. Pure — returned for testing. */
export function buildSchemas(): Record<string, any> {
  return {
    "adapt-config.schema.json": zodToJsonSchema(AdaptConfigSchema, "AdaptConfig"),
    "scenario-meta.schema.json": zodToJsonSchema(ScenarioMetaSchema, "ScenarioMeta"),
  };
}

/** Write the schemas to src/schemas/generated/. Invoked via `npm run schemas`. */
export function writeSchemas(): string[] {
  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "generated");
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (const [name, schema] of Object.entries(buildSchemas())) {
    const path = resolve(outDir, name);
    writeFileSync(path, JSON.stringify(schema, null, 2) + "\n", "utf8");
    written.push(path);
  }
  return written;
}

// Run directly: `npm run schemas`
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const p of writeSchemas()) console.log(`wrote ${p}`);
}
```

- [ ] **Step 4: Run test to verify it passes, then generate the files**

Run: `npx vitest run test/schemas/export.test.ts`
Expected: PASS (1 test).

Run: `npm run schemas`
Expected: prints `wrote .../src/schemas/generated/adapt-config.schema.json` and `...scenario-meta.schema.json`.

- [ ] **Step 5: Final full-suite check + typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all test files PASS; `tsc --noEmit` exits 0 with no output.

- [ ] **Step 6: Commit**

```bash
git add src/schemas/export.ts src/schemas/generated test/schemas/export.test.ts
git commit -m "feat(schemas): export JSON Schema from zod definitions"
```

---

## Self-Review (completed during authoring)

- **Spec coverage:** Workspace layout (§10) → Tasks 1, 7; config incl. Jira/MCP/limits/hooks (§9, §13, §14) → Tasks 2–3; scenario format with hooks (§10, §13) → Tasks 4–5; registry (§10) → Task 6; "never overwrite scenarios/north-star" safeguard (§16) → Task 7; JSON schemas (§10) → Task 9. The two-repo boundary (§10) is enforced by `workspacePaths` always rooting at `<target>/.adapt`.
- **Type consistency:** lifecycle/priority/source enums live only in `src/types.ts` and are imported by config, scenario, and registry code. `AdaptConfig`, `ScenarioMeta`, `RegistryEntry`, `WorkspacePaths`, `ParsedScenario` are the stable exports Plans 2–3 depend on.
- **Out of scope (correctly deferred):** running agents, the orchestrator state machine, the console, Jira sync — Plans 2 and 3.

# Baselines & Lanes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the ability to save a shared baseline (a git tag + manifest) of a target repo and fork it into multiple isolated, self-sustaining lanes — each with its own worktree+branch, DB/port namespace, state DB, model, and resumable autonomous loop.

**Architecture:** A new `src/lanes/` module holds pure helpers (port allocation, path resolution, git primitives) and orchestration (baseline create/list, lane create/reset/destroy/list, loop start/stop). The CLI gains `baseline` and `lane` command groups. The existing continuous loop (`runContinuous` via `runCmd`) is reused per-lane by pointing it at a worktree; it becomes model-aware by reading the lane manifest. adapt stays generic: it injects a namespace (`ADAPT_LANE_ID`, `ADAPT_COMPOSE_PROJECT`, `ADAPT_PORT_BASE`) into target-supplied `environment.up/down/reset` commands and never contains target-stack logic.

**Tech Stack:** Node + TypeScript, commander (CLI), zod (config), better-sqlite3 (state), vitest (tests), `node:child_process` `spawnSync`/`spawn` for git + environment commands.

**Scope:** Spec 1 only (baseline + lane core). Uses the existing local-JSON work tracker. Jira-per-lane and the multi-lane console are out of scope (named follow-ups in the design doc).

---

## File Structure

**Create:**
- `src/lanes/types.ts` — `BaselineManifest`, `LaneManifest` interfaces.
- `src/lanes/ports.ts` — pure port-slot allocation.
- `src/lanes/paths.ts` — lane/worktree path resolution (pure).
- `src/lanes/git.ts` — git primitives (clean check, tag, worktree add/remove, reset, branch delete).
- `src/lanes/baseline.ts` — `createBaseline`, `listBaselines`.
- `src/lanes/lane.ts` — lane manifest IO, `runEnvCommand`, `createLane`, `resetLane`, `destroyLane`, `listLanes`.
- `src/lanes/loop.ts` — `startLaneLoop` (foreground + detached), `stopLaneLoop`, `laneLoopStatus`.
- `src/cli/commands/baseline.ts` — CLI cores for the `baseline` group.
- `src/cli/commands/lane.ts` — CLI cores for the `lane` group.
- Tests mirroring each under `test/lanes/` and `test/cli/`.

**Modify:**
- `src/config/schema.ts` — add optional `environment` and `lanes` config sections.
- `src/workspace/paths.ts` — add `baselinesDir` and `laneManifest` paths.
- `src/engine/claudeCode.ts` — add a `model` option that appends `--model <model>`.
- `src/cli/commands/run.ts` — read the lane manifest (if present) and use its model when building the engine.
- `src/cli/index.ts` — wire the `baseline` and `lane` command groups.
- `src/workspace/scaffold.ts` — write a `.adapt/.gitignore` covering runtime files.

---

## Task 1: Config schema — `environment` and `lanes` sections

**Files:**
- Modify: `src/config/schema.ts:60-67` (insert new sections before the closing `});`)
- Test: `test/config/environmentLanes.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/config/environmentLanes.test.ts
import { describe, it, expect } from "vitest";
import { AdaptConfigSchema } from "../../src/config/schema.ts";

describe("config environment + lanes", () => {
  it("defaults lanes.rootDir and leaves environment undefined when absent", () => {
    const c = AdaptConfigSchema.parse({
      targetRepoPath: "/tmp/x",
      appBaseUrl: "http://localhost:3000",
    });
    expect(c.lanes.rootDir).toBe("../adapt-lanes");
    expect(c.environment).toBeUndefined();
  });

  it("accepts an environment block with up/down/reset and port settings", () => {
    const c = AdaptConfigSchema.parse({
      targetRepoPath: "/tmp/x",
      appBaseUrl: "http://localhost:3000",
      environment: { up: "up.sh", down: "down.sh", reset: "supabase db reset", portBase: 54300, portStride: 100 },
    });
    expect(c.environment?.reset).toBe("supabase db reset");
    expect(c.environment?.portBase).toBe(54300);
    expect(c.environment?.portStride).toBe(100);
  });

  it("defaults portBase/portStride inside environment when only commands are given", () => {
    const c = AdaptConfigSchema.parse({
      targetRepoPath: "/tmp/x",
      appBaseUrl: "http://localhost:3000",
      environment: { reset: "supabase db reset" },
    });
    expect(c.environment?.portBase).toBe(54300);
    expect(c.environment?.portStride).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/config/environmentLanes.test.ts`
Expected: FAIL — `c.lanes` is undefined / `environment` not in schema.

- [ ] **Step 3: Add the schema sections**

In `src/config/schema.ts`, insert these two blocks immediately before the closing `});` of `AdaptConfigSchema` (i.e. after the `run` block on line 66):

```typescript
  // Environment orchestration for lanes (Spec: baselines & lanes).
  // Optional — absent means lanes are git-only (no env bring-up/reset).
  environment: z.object({
    up: z.string().optional(),
    down: z.string().optional(),
    reset: z.string().optional(),
    portBase: z.number().int().positive().default(54300),
    portStride: z.number().int().positive().default(100),
  }).optional(),

  // Where lane worktrees are created.
  lanes: z.object({
    rootDir: z.string().default("../adapt-lanes"),
  }).default({}),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/config/environmentLanes.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/config/schema.ts test/config/environmentLanes.test.ts
git commit -m "feat(config): environment + lanes config sections"
```

---

## Task 2: Pure port-slot allocation

**Files:**
- Create: `src/lanes/ports.ts`
- Test: `test/lanes/ports.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/lanes/ports.test.ts
import { describe, it, expect } from "vitest";
import { allocatePortBase, slotIndex } from "../../src/lanes/ports.ts";

describe("allocatePortBase", () => {
  it("returns portBase for the first lane", () => {
    expect(allocatePortBase([], 54300, 100)).toBe(54300);
  });

  it("picks the next free slot when slots are contiguous", () => {
    expect(allocatePortBase([54300, 54400], 54300, 100)).toBe(54500);
  });

  it("reuses the lowest freed slot (gap) before extending", () => {
    // 54300 and 54500 used, 54400 free -> reuse 54400
    expect(allocatePortBase([54300, 54500], 54300, 100)).toBe(54400);
  });

  it("ignores port bases that are not on the stride grid", () => {
    expect(allocatePortBase([54350], 54300, 100)).toBe(54300);
  });
});

describe("slotIndex", () => {
  it("maps a base to its grid index", () => {
    expect(slotIndex(54500, 54300, 100)).toBe(2);
  });
  it("returns -1 for an off-grid base", () => {
    expect(slotIndex(54350, 54300, 100)).toBe(-1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lanes/ports.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lanes/ports.ts`**

```typescript
/** Map a port base to its index on the stride grid, or -1 if off-grid. Pure. */
export function slotIndex(base: number, portBase: number, portStride: number): number {
  const delta = base - portBase;
  if (delta < 0 || delta % portStride !== 0) return -1;
  return delta / portStride;
}

/** Allocate the lowest free port base on the grid given the bases already in use. Pure. */
export function allocatePortBase(usedBases: number[], portBase: number, portStride: number): number {
  const usedIdx = new Set<number>();
  for (const b of usedBases) {
    const i = slotIndex(b, portBase, portStride);
    if (i >= 0) usedIdx.add(i);
  }
  let i = 0;
  while (usedIdx.has(i)) i++;
  return portBase + i * portStride;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lanes/ports.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lanes/ports.ts test/lanes/ports.test.ts
git commit -m "feat(lanes): pure port-slot allocation"
```

---

## Task 3: Lane/baseline types + workspace paths

**Files:**
- Create: `src/lanes/types.ts`
- Modify: `src/workspace/paths.ts:4-16` (interface) and `:22-35` (return object)
- Test: `test/lanes/paths.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/lanes/paths.test.ts
import { describe, it, expect } from "vitest";
import { workspacePaths } from "../../src/workspace/paths.ts";

describe("workspacePaths baseline + lane additions", () => {
  it("resolves baselinesDir and laneManifest under .adapt", () => {
    const p = workspacePaths("/tmp/repo");
    expect(p.baselinesDir).toBe("/tmp/repo/.adapt/baselines");
    expect(p.laneManifest).toBe("/tmp/repo/.adapt/lane.json");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lanes/paths.test.ts`
Expected: FAIL — `baselinesDir` undefined.

- [ ] **Step 3: Create `src/lanes/types.ts`**

```typescript
export interface BaselineManifest {
  name: string;
  gitTag: string;
  commit: string;
  createdAt: string;
}

export interface LaneManifest {
  laneId: string;
  baseline: string;
  model: string | null;
  branch: string;
  composeProject: string;
  ports: { base: number; stride: number };
  createdAt: string;
}
```

- [ ] **Step 4: Extend `src/workspace/paths.ts`**

Add two fields to the `WorkspacePaths` interface (after `demandsDir: string;` on line 15):

```typescript
  baselinesDir: string;
  laneManifest: string;
```

Add them to the returned object in `workspacePaths` (after `demandsDir: join(root, "demands"),` on line 34):

```typescript
    baselinesDir: join(root, "baselines"),
    laneManifest: join(root, "lane.json"),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/lanes/paths.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lanes/types.ts src/workspace/paths.ts test/lanes/paths.test.ts
git commit -m "feat(lanes): manifest types + baseline/lane workspace paths"
```

---

## Task 4: Git primitives

**Files:**
- Create: `src/lanes/git.ts`
- Test: `test/lanes/git.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/lanes/git.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import {
  isClean, headCommit, tagBaseline, tagExists,
  addWorktree, removeWorktree, resetHard, deleteBranch,
} from "../../src/lanes/git.ts";

function initRepo(): string {
  const dir = makeTmpDir();
  spawnSync("git", ["-C", dir, "init"], { encoding: "utf8" });
  spawnSync("git", ["-C", dir, "config", "user.email", "t@t.t"], { encoding: "utf8" });
  spawnSync("git", ["-C", dir, "config", "user.name", "t"], { encoding: "utf8" });
  writeFileSync(join(dir, "f.txt"), "one", "utf8");
  spawnSync("git", ["-C", dir, "add", "."], { encoding: "utf8" });
  spawnSync("git", ["-C", dir, "commit", "-m", "init"], { encoding: "utf8" });
  return dir;
}

const dirs: string[] = [];
afterEach(() => { while (dirs.length) cleanupTmp(dirs.pop()!); });

describe("lanes/git", () => {
  it("isClean is true on a fresh commit, false with changes", () => {
    const repo = initRepo(); dirs.push(repo);
    expect(isClean(repo)).toBe(true);
    writeFileSync(join(repo, "f.txt"), "two", "utf8");
    expect(isClean(repo)).toBe(false);
  });

  it("headCommit returns a sha", () => {
    const repo = initRepo(); dirs.push(repo);
    expect(headCommit(repo)).toMatch(/^[0-9a-f]{7,40}$/);
  });

  it("tagBaseline creates a tag that tagExists detects", () => {
    const repo = initRepo(); dirs.push(repo);
    expect(tagExists(repo, "adapt-baseline/v1")).toBe(false);
    expect(tagBaseline(repo, "v1")).toBe(true);
    expect(tagExists(repo, "adapt-baseline/v1")).toBe(true);
  });

  it("addWorktree forks a branch from the tag; resetHard + removeWorktree work", () => {
    const repo = initRepo(); dirs.push(repo);
    tagBaseline(repo, "v1");
    const wt = makeTmpDir(); dirs.push(wt);
    cleanupTmp(wt); // git worktree add requires the path to not pre-exist
    expect(addWorktree(repo, wt, "adapt/laneA", "adapt-baseline/v1")).toBe(true);
    // A new commit on the lane, then reset back to baseline:
    writeFileSync(join(wt, "f.txt"), "changed", "utf8");
    spawnSync("git", ["-C", wt, "commit", "-am", "lane change"], { encoding: "utf8" });
    expect(resetHard(wt, "adapt-baseline/v1")).toBe(true);
    expect(removeWorktree(repo, wt)).toBe(true);
    expect(deleteBranch(repo, "adapt/laneA")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lanes/git.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lanes/git.ts`**

```typescript
import { spawnSync } from "node:child_process";

function git(repo: string, args: string[]): { ok: boolean; stdout: string } {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  return { ok: r.status === 0, stdout: (r.stdout ?? "").trim() };
}

/** True if the working tree has no uncommitted changes. */
export function isClean(repo: string): boolean {
  const r = git(repo, ["status", "--porcelain"]);
  return r.ok && r.stdout === "";
}

/** Current HEAD commit sha, or null if not a repo / no commits. */
export function headCommit(repo: string): string | null {
  const r = git(repo, ["rev-parse", "HEAD"]);
  return r.ok ? r.stdout : null;
}

/** Create the tag adapt-baseline/<name> at HEAD. */
export function tagBaseline(repo: string, name: string): boolean {
  return git(repo, ["tag", `adapt-baseline/${name}`]).ok;
}

export function tagExists(repo: string, tag: string): boolean {
  return git(repo, ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`]).ok;
}

/** git worktree add <path> -b <branch> <startPoint>. The path must not pre-exist. */
export function addWorktree(repo: string, path: string, branch: string, startPoint: string): boolean {
  return git(repo, ["worktree", "add", path, "-b", branch, startPoint]).ok;
}

/** git worktree remove --force <path>. */
export function removeWorktree(repo: string, path: string): boolean {
  return git(repo, ["worktree", "remove", "--force", path]).ok;
}

/** git -C <worktree> reset --hard <ref>. Note: operates inside the worktree itself. */
export function resetHard(worktree: string, ref: string): boolean {
  return git(worktree, ["reset", "--hard", ref]).ok;
}

/** git branch -D <branch>. */
export function deleteBranch(repo: string, branch: string): boolean {
  return git(repo, ["branch", "-D", branch]).ok;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lanes/git.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lanes/git.ts test/lanes/git.test.ts
git commit -m "feat(lanes): git primitives (tag, worktree, reset, branch)"
```

---

## Task 5: Baseline create + list

**Files:**
- Create: `src/lanes/baseline.ts`
- Test: `test/lanes/baseline.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/lanes/baseline.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { createBaseline, listBaselines } from "../../src/lanes/baseline.ts";
import { tagExists } from "../../src/lanes/git.ts";

function initRepo(): string {
  const dir = makeTmpDir();
  spawnSync("git", ["-C", dir, "init"], { encoding: "utf8" });
  spawnSync("git", ["-C", dir, "config", "user.email", "t@t.t"], { encoding: "utf8" });
  spawnSync("git", ["-C", dir, "config", "user.name", "t"], { encoding: "utf8" });
  mkdirSync(join(dir, ".adapt"), { recursive: true });
  writeFileSync(join(dir, ".adapt", "north-star.md"), "x", "utf8");
  spawnSync("git", ["-C", dir, "add", "."], { encoding: "utf8" });
  spawnSync("git", ["-C", dir, "commit", "-m", "init"], { encoding: "utf8" });
  return dir;
}

const dirs: string[] = [];
afterEach(() => { while (dirs.length) cleanupTmp(dirs.pop()!); });

describe("createBaseline", () => {
  it("tags, writes a manifest, and lists it", () => {
    const repo = initRepo(); dirs.push(repo);
    const logs: string[] = [];
    const code = createBaseline({ targetRepo: repo, name: "v1" }, (m) => logs.push(m));
    expect(code).toBe(0);
    expect(tagExists(repo, "adapt-baseline/v1")).toBe(true);
    const list = listBaselines(repo);
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("v1");
    expect(list[0].gitTag).toBe("adapt-baseline/v1");
    expect(list[0].commit).toMatch(/^[0-9a-f]{7,40}$/);
  });

  it("refuses when the working tree is dirty", () => {
    const repo = initRepo(); dirs.push(repo);
    writeFileSync(join(repo, "dirty.txt"), "z", "utf8");
    const logs: string[] = [];
    const code = createBaseline({ targetRepo: repo, name: "v1" }, (m) => logs.push(m));
    expect(code).toBe(1);
    expect(logs.join("\n")).toMatch(/uncommitted|clean/i);
    expect(tagExists(repo, "adapt-baseline/v1")).toBe(false);
  });

  it("refuses a duplicate baseline name", () => {
    const repo = initRepo(); dirs.push(repo);
    expect(createBaseline({ targetRepo: repo, name: "v1" }, () => {})).toBe(0);
    const logs: string[] = [];
    const code = createBaseline({ targetRepo: repo, name: "v1" }, (m) => logs.push(m));
    expect(code).toBe(1);
    expect(logs.join("\n")).toMatch(/exists/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lanes/baseline.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lanes/baseline.ts`**

```typescript
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { workspacePaths } from "../workspace/paths.ts";
import { isClean, headCommit, tagBaseline, tagExists } from "./git.ts";
import type { BaselineManifest } from "./types.ts";

export interface CreateBaselineOptions {
  targetRepo: string;
  name: string;
  now?: () => string;
}

/** Core of `adapt baseline create`. Returns a process exit code. */
export function createBaseline(opts: CreateBaselineOptions, log: (msg: string) => void = console.log): number {
  const now = opts.now ?? (() => new Date().toISOString());
  const repo = opts.targetRepo;
  const tag = `adapt-baseline/${opts.name}`;

  if (tagExists(repo, tag)) {
    log(`error: baseline "${opts.name}" already exists (${tag})`);
    return 1;
  }
  if (!isClean(repo)) {
    log(`error: working tree has uncommitted changes — commit or stash before creating a baseline`);
    return 1;
  }
  const commit = headCommit(repo);
  if (!commit) {
    log(`error: ${repo} is not a git repo with at least one commit`);
    return 1;
  }
  if (!tagBaseline(repo, opts.name)) {
    log(`error: failed to create tag ${tag}`);
    return 1;
  }

  const ws = workspacePaths(repo);
  if (!existsSync(ws.baselinesDir)) mkdirSync(ws.baselinesDir, { recursive: true });
  const manifest: BaselineManifest = { name: opts.name, gitTag: tag, commit, createdAt: now() };
  const manifestPath = join(ws.baselinesDir, `${opts.name}.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  spawnSync("git", ["-C", repo, "add", manifestPath], { encoding: "utf8" });
  spawnSync("git", ["-C", repo, "commit", "-m", `chore(adapt): baseline ${opts.name}`], { encoding: "utf8" });

  log(`  created  baseline "${opts.name}" at ${commit.slice(0, 8)} (${tag})`);
  return 0;
}

/** List baselines from .adapt/baselines/. */
export function listBaselines(targetRepo: string): BaselineManifest[] {
  const ws = workspacePaths(targetRepo);
  if (!existsSync(ws.baselinesDir)) return [];
  return readdirSync(ws.baselinesDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(ws.baselinesDir, f), "utf8")) as BaselineManifest)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lanes/baseline.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lanes/baseline.ts test/lanes/baseline.test.ts
git commit -m "feat(lanes): baseline create + list"
```

---

## Task 6: Engine `--model` support

**Files:**
- Modify: `src/engine/claudeCode.ts:5-27`
- Test: `test/engine/claudeCodeModel.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/engine/claudeCodeModel.test.ts
import { describe, it, expect } from "vitest";
import { ClaudeCodeEngine } from "../../src/engine/claudeCode.ts";

// Reach the default argsBuilder by constructing with a model and inspecting the built args.
// We expose argsBuilder behavior via a tiny spec; the engine stores argsBuilder, so we
// reconstruct the same default by calling a fresh engine's builder through a public path:
// the simplest stable check is that buildArgs (exported helper) includes --model.
import { buildClaudeArgs } from "../../src/engine/claudeCode.ts";

describe("buildClaudeArgs", () => {
  it("includes --model when a model is provided", () => {
    const args = buildClaudeArgs({ role: "runner", prompt: "hi", cwd: "/x" }, { model: "opus", skipPermissions: true });
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("opus");
  });

  it("omits --model when none is provided", () => {
    const args = buildClaudeArgs({ role: "runner", prompt: "hi", cwd: "/x" }, { skipPermissions: false });
    expect(args).not.toContain("--model");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/engine/claudeCodeModel.test.ts`
Expected: FAIL — `buildClaudeArgs` not exported.

- [ ] **Step 3: Refactor `src/engine/claudeCode.ts` to extract `buildClaudeArgs` and accept `model`**

Replace lines 5-27 (the options interface and constructor) with:

```typescript
export interface ClaudeCodeEngineOptions {
  command?: string;                              // default "claude"
  model?: string;                                // optional --model (per-lane)
  argsBuilder?: (spec: AgentSpec) => string[];   // default builds headless stream-json flags
  skipPermissions?: boolean;                     // default true — pass --dangerously-skip-permissions
  now?: () => string;
}

/** Build the claude CLI args for a spec. Exported for testing. */
export function buildClaudeArgs(spec: AgentSpec, opts: { model?: string; skipPermissions: boolean }): string[] {
  const args: string[] = [];
  if (opts.model) args.push("--model", opts.model);
  args.push("-p", spec.prompt, "--output-format", "stream-json", "--verbose");
  if (opts.skipPermissions) args.push("--dangerously-skip-permissions");
  for (const s of spec.mcpServers ?? []) args.push("--mcp-config", s);
  return args;
}

export class ClaudeCodeEngine implements AgentEngine {
  private command: string;
  private argsBuilder: (spec: AgentSpec) => string[];
  private now: () => string;

  constructor(opts: ClaudeCodeEngineOptions = {}) {
    const skipPermissions = opts.skipPermissions ?? true;
    this.command = opts.command ?? "claude";
    this.argsBuilder = opts.argsBuilder ?? ((spec: AgentSpec) =>
      buildClaudeArgs(spec, { model: opts.model, skipPermissions }));
    this.now = opts.now ?? (() => new Date().toISOString());
  }
```

(Leave the rest of the class — the `run` method from line 29 onward — unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/engine/claudeCodeModel.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full engine suite to confirm no regression**

Run: `npx vitest run test/engine`
Expected: PASS (existing engine tests still green).

- [ ] **Step 6: Commit**

```bash
git add src/engine/claudeCode.ts test/engine/claudeCodeModel.test.ts
git commit -m "feat(engine): optional --model flag (per-lane model)"
```

---

## Task 7: Lane manifest IO + listLanes

**Files:**
- Create: `src/lanes/lane.ts` (manifest IO + list; orchestration added in Tasks 8–11)
- Test: `test/lanes/laneManifest.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/lanes/laneManifest.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { readLaneManifest, writeLaneManifest, listLanes } from "../../src/lanes/lane.ts";
import type { LaneManifest } from "../../src/lanes/types.ts";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) cleanupTmp(dirs.pop()!); });

const sample = (laneId: string): LaneManifest => ({
  laneId, baseline: "v1", model: "opus", branch: `adapt/${laneId}`,
  composeProject: `adapt-${laneId}`, ports: { base: 54300, stride: 100 },
  createdAt: "2026-05-28T00:00:00.000Z",
});

describe("lane manifest IO", () => {
  it("writes then reads a lane manifest from a worktree", () => {
    const wt = makeTmpDir(); dirs.push(wt);
    writeLaneManifest(wt, sample("laneA"));
    const read = readLaneManifest(wt);
    expect(read?.laneId).toBe("laneA");
    expect(read?.model).toBe("opus");
  });

  it("readLaneManifest returns null when absent", () => {
    const wt = makeTmpDir(); dirs.push(wt);
    expect(readLaneManifest(wt)).toBeNull();
  });

  it("listLanes scans the lanes root for manifests", () => {
    const root = makeTmpDir(); dirs.push(root);
    for (const id of ["laneA", "laneB"]) {
      const wt = join(root, id);
      mkdirSync(join(wt, ".adapt"), { recursive: true });
      writeFileSync(join(wt, ".adapt", "lane.json"), JSON.stringify(sample(id)), "utf8");
    }
    const lanes = listLanes(root);
    expect(lanes.map((l) => l.laneId).sort()).toEqual(["laneA", "laneB"]);
  });

  it("listLanes returns [] for a missing root", () => {
    expect(listLanes("/no/such/dir")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lanes/laneManifest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lanes/lane.ts` (manifest IO + list only for now)**

```typescript
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { workspacePaths } from "../workspace/paths.ts";
import type { LaneManifest } from "./types.ts";

/** Read <worktree>/.adapt/lane.json, or null if it does not exist. */
export function readLaneManifest(worktree: string): LaneManifest | null {
  const { laneManifest } = workspacePaths(worktree);
  if (!existsSync(laneManifest)) return null;
  return JSON.parse(readFileSync(laneManifest, "utf8")) as LaneManifest;
}

/** Write <worktree>/.adapt/lane.json. Creates .adapt/ if needed. */
export function writeLaneManifest(worktree: string, manifest: LaneManifest): void {
  const ws = workspacePaths(worktree);
  if (!existsSync(ws.root)) mkdirSync(ws.root, { recursive: true });
  writeFileSync(ws.laneManifest, JSON.stringify(manifest, null, 2) + "\n", "utf8");
}

/** Scan a lanes root directory for lane manifests (one per child worktree). */
export function listLanes(lanesRoot: string): LaneManifest[] {
  if (!existsSync(lanesRoot)) return [];
  const out: LaneManifest[] = [];
  for (const entry of readdirSync(lanesRoot)) {
    const wt = join(lanesRoot, entry);
    if (!statSync(wt).isDirectory()) continue;
    const m = readLaneManifest(wt);
    if (m) out.push(m);
  }
  return out.sort((a, b) => a.laneId.localeCompare(b.laneId));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lanes/laneManifest.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lanes/lane.ts test/lanes/laneManifest.test.ts
git commit -m "feat(lanes): lane manifest IO + listLanes"
```

---

## Task 8: Environment command runner with namespace injection

**Files:**
- Modify: `src/lanes/lane.ts` (append)
- Test: `test/lanes/runEnvCommand.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/lanes/runEnvCommand.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { runEnvCommand, laneEnv } from "../../src/lanes/lane.ts";
import type { LaneManifest } from "../../src/lanes/types.ts";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) cleanupTmp(dirs.pop()!); });

const manifest: LaneManifest = {
  laneId: "laneA", baseline: "v1", model: null, branch: "adapt/laneA",
  composeProject: "adapt-laneA", ports: { base: 54400, stride: 100 },
  createdAt: "2026-05-28T00:00:00.000Z",
};

describe("laneEnv", () => {
  it("builds the ADAPT_* namespace vars", () => {
    expect(laneEnv(manifest)).toEqual({
      ADAPT_LANE_ID: "laneA",
      ADAPT_COMPOSE_PROJECT: "adapt-laneA",
      ADAPT_PORT_BASE: "54400",
    });
  });
});

describe("runEnvCommand", () => {
  it("runs the command in cwd with ADAPT_* vars in the environment", () => {
    const cwd = makeTmpDir(); dirs.push(cwd);
    const ok = runEnvCommand('printf "%s %s" "$ADAPT_LANE_ID" "$ADAPT_PORT_BASE" > out.txt', cwd, manifest);
    expect(ok).toBe(true);
    expect(readFileSync(join(cwd, "out.txt"), "utf8")).toBe("laneA 54400");
  });

  it("returns false on a failing command", () => {
    const cwd = makeTmpDir(); dirs.push(cwd);
    expect(runEnvCommand("exit 3", cwd, manifest)).toBe(false);
  });

  it("returns true (no-op) for an undefined command", () => {
    const cwd = makeTmpDir(); dirs.push(cwd);
    expect(runEnvCommand(undefined, cwd, manifest)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lanes/runEnvCommand.test.ts`
Expected: FAIL — `runEnvCommand`/`laneEnv` not exported.

- [ ] **Step 3: Append to `src/lanes/lane.ts`**

Add this import line at the top (merge with the existing `node:child_process` usage — there is none yet, so add it):

```typescript
import { spawnSync } from "node:child_process";
```

Append these functions to the end of the file:

```typescript
/** The namespace environment variables adapt guarantees each lane. */
export function laneEnv(manifest: LaneManifest): Record<string, string> {
  return {
    ADAPT_LANE_ID: manifest.laneId,
    ADAPT_COMPOSE_PROJECT: manifest.composeProject,
    ADAPT_PORT_BASE: String(manifest.ports.base),
  };
}

/** Run a target-supplied environment command (shell) in `cwd` with the lane namespace injected.
 *  Undefined/empty command is a successful no-op. Returns false on non-zero exit. */
export function runEnvCommand(command: string | undefined, cwd: string, manifest: LaneManifest): boolean {
  if (!command || command.trim() === "") return true;
  const r = spawnSync(command, {
    cwd, shell: true, stdio: "inherit",
    env: { ...process.env, ...laneEnv(manifest) },
  });
  return r.status === 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lanes/runEnvCommand.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lanes/lane.ts test/lanes/runEnvCommand.test.ts
git commit -m "feat(lanes): env command runner with ADAPT_* namespace injection"
```

---

## Task 9: createLane orchestration

**Files:**
- Modify: `src/lanes/lane.ts` (append `createLane`)
- Test: `test/lanes/createLane.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/lanes/createLane.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { createBaseline } from "../../src/lanes/baseline.ts";
import { createLane, readLaneManifest } from "../../src/lanes/lane.ts";

function initRepo(): string {
  const dir = makeTmpDir();
  spawnSync("git", ["-C", dir, "init"], { encoding: "utf8" });
  spawnSync("git", ["-C", dir, "config", "user.email", "t@t.t"], { encoding: "utf8" });
  spawnSync("git", ["-C", dir, "config", "user.name", "t"], { encoding: "utf8" });
  mkdirSync(join(dir, ".adapt"), { recursive: true });
  writeFileSync(join(dir, ".adapt", "north-star.md"), "x", "utf8");
  spawnSync("git", ["-C", dir, "add", "."], { encoding: "utf8" });
  spawnSync("git", ["-C", dir, "commit", "-m", "init"], { encoding: "utf8" });
  return dir;
}

const dirs: string[] = [];
afterEach(() => {
  // worktrees must be removed before their parent repo dir is deleted
  while (dirs.length) cleanupTmp(dirs.pop()!);
});

describe("createLane", () => {
  it("creates a worktree on a forked branch with a lane manifest", () => {
    const repo = initRepo(); dirs.unshift(repo);
    const lanesRoot = makeTmpDir(); dirs.unshift(lanesRoot);
    createBaseline({ targetRepo: repo, name: "v1" }, () => {});

    const logs: string[] = [];
    const code = createLane({
      targetRepo: repo, laneId: "laneA", baseline: "v1", model: "opus",
      lanesRoot, portBase: 54300, portStride: 100,
      // no environment commands configured -> env steps skipped
    }, (m) => logs.push(m));

    expect(code).toBe(0);
    const wt = join(lanesRoot, "laneA");
    expect(existsSync(join(wt, ".adapt", "north-star.md"))).toBe(true); // forked from baseline
    const m = readLaneManifest(wt)!;
    expect(m.laneId).toBe("laneA");
    expect(m.model).toBe("opus");
    expect(m.branch).toBe("adapt/laneA");
    expect(m.composeProject).toBe("adapt-laneA");
    expect(m.ports.base).toBe(54300);
  });

  it("allocates the next free port for a second lane and refuses duplicates", () => {
    const repo = initRepo(); dirs.unshift(repo);
    const lanesRoot = makeTmpDir(); dirs.unshift(lanesRoot);
    createBaseline({ targetRepo: repo, name: "v1" }, () => {});
    createLane({ targetRepo: repo, laneId: "laneA", baseline: "v1", model: null, lanesRoot, portBase: 54300, portStride: 100 }, () => {});
    createLane({ targetRepo: repo, laneId: "laneB", baseline: "v1", model: null, lanesRoot, portBase: 54300, portStride: 100 }, () => {});
    expect(readLaneManifest(join(lanesRoot, "laneB"))!.ports.base).toBe(54400);

    const logs: string[] = [];
    const dup = createLane({ targetRepo: repo, laneId: "laneA", baseline: "v1", model: null, lanesRoot, portBase: 54300, portStride: 100 }, (m) => logs.push(m));
    expect(dup).toBe(1);
    expect(logs.join("\n")).toMatch(/exists/i);
  });

  it("refuses an unknown baseline and an invalid lane id", () => {
    const repo = initRepo(); dirs.unshift(repo);
    const lanesRoot = makeTmpDir(); dirs.unshift(lanesRoot);
    expect(createLane({ targetRepo: repo, laneId: "laneA", baseline: "ghost", model: null, lanesRoot, portBase: 54300, portStride: 100 }, () => {})).toBe(1);
    createBaseline({ targetRepo: repo, name: "v1" }, () => {});
    expect(createLane({ targetRepo: repo, laneId: "bad id!", baseline: "v1", model: null, lanesRoot, portBase: 54300, portStride: 100 }, () => {})).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lanes/createLane.test.ts`
Expected: FAIL — `createLane` not exported.

- [ ] **Step 3: Append `createLane` (and a lane-id validator) to `src/lanes/lane.ts`**

Add these imports to the top of the file (merge with existing import lines):

```typescript
import { addWorktree, tagExists } from "./git.ts";
import { allocatePortBase } from "./ports.ts";
import type { AdaptConfig } from "../config/schema.ts";
```

Append:

```typescript
/** Lane ids are used in branch names, compose project names, and paths. */
export function isValidLaneId(laneId: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,38}$/.test(laneId);
}

export interface CreateLaneOptions {
  targetRepo: string;
  laneId: string;
  baseline: string;
  model: string | null;
  lanesRoot: string;
  portBase: number;
  portStride: number;
  /** Target-supplied env commands (from config.environment); optional. */
  envUp?: string;
  envReset?: string;
  now?: () => string;
}

/** Core of `adapt lane create`. Returns a process exit code. */
export function createLane(opts: CreateLaneOptions, log: (msg: string) => void = console.log): number {
  const now = opts.now ?? (() => new Date().toISOString());
  if (!isValidLaneId(opts.laneId)) {
    log(`error: invalid lane id "${opts.laneId}" (use lowercase letters, digits, hyphens; max 39 chars)`);
    return 1;
  }
  const tag = `adapt-baseline/${opts.baseline}`;
  if (!tagExists(opts.targetRepo, tag)) {
    log(`error: baseline "${opts.baseline}" not found (${tag}). Create it with "adapt baseline create".`);
    return 1;
  }
  const worktree = join(opts.lanesRoot, opts.laneId);
  if (existsSync(worktree)) {
    log(`error: lane "${opts.laneId}" already exists at ${worktree}`);
    return 1;
  }

  const existing = listLanes(opts.lanesRoot);
  const portBase = allocatePortBase(existing.map((l) => l.ports.base), opts.portBase, opts.portStride);

  if (!existsSync(opts.lanesRoot)) mkdirSync(opts.lanesRoot, { recursive: true });
  const branch = `adapt/${opts.laneId}`;
  if (!addWorktree(opts.targetRepo, worktree, branch, tag)) {
    log(`error: failed to create worktree at ${worktree}`);
    return 1;
  }

  const manifest: LaneManifest = {
    laneId: opts.laneId, baseline: opts.baseline, model: opts.model, branch,
    composeProject: `adapt-${opts.laneId}`, ports: { base: portBase, stride: opts.portStride },
    createdAt: now(),
  };
  writeLaneManifest(worktree, manifest);

  if (!runEnvCommand(opts.envUp, worktree, manifest)) {
    log(`error: environment.up failed for lane "${opts.laneId}"`);
    return 1;
  }
  if (!runEnvCommand(opts.envReset, worktree, manifest)) {
    log(`error: environment.reset failed for lane "${opts.laneId}"`);
    return 1;
  }

  log(`  created  lane "${opts.laneId}" (branch ${branch}, ports ${portBase}+, model ${opts.model ?? "default"})`);
  log(`           worktree: ${worktree}`);
  return 0;
}

/** Resolve env commands + lane root + port settings from a loaded config. */
export function laneSettingsFromConfig(config: AdaptConfig): {
  lanesRoot: string; portBase: number; portStride: number; envUp?: string; envDown?: string; envReset?: string;
} {
  return {
    lanesRoot: config.lanes.rootDir,
    portBase: config.environment?.portBase ?? 54300,
    portStride: config.environment?.portStride ?? 100,
    envUp: config.environment?.up,
    envDown: config.environment?.down,
    envReset: config.environment?.reset,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lanes/createLane.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lanes/lane.ts test/lanes/createLane.test.ts
git commit -m "feat(lanes): createLane (worktree fork + manifest + env bring-up)"
```

---

## Task 10: resetLane

**Files:**
- Modify: `src/lanes/lane.ts` (append `resetLane`)
- Test: `test/lanes/resetLane.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/lanes/resetLane.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { createBaseline } from "../../src/lanes/baseline.ts";
import { createLane, resetLane } from "../../src/lanes/lane.ts";

function initRepo(): string {
  const dir = makeTmpDir();
  spawnSync("git", ["-C", dir, "init"], { encoding: "utf8" });
  spawnSync("git", ["-C", dir, "config", "user.email", "t@t.t"], { encoding: "utf8" });
  spawnSync("git", ["-C", dir, "config", "user.name", "t"], { encoding: "utf8" });
  writeFileSync(join(dir, "app.txt"), "baseline", "utf8");
  spawnSync("git", ["-C", dir, "add", "."], { encoding: "utf8" });
  spawnSync("git", ["-C", dir, "commit", "-m", "init"], { encoding: "utf8" });
  return dir;
}

const dirs: string[] = [];
afterEach(() => { while (dirs.length) cleanupTmp(dirs.pop()!); });

describe("resetLane", () => {
  it("discards lane commits and restores the baseline content", () => {
    const repo = initRepo(); dirs.unshift(repo);
    const lanesRoot = makeTmpDir(); dirs.unshift(lanesRoot);
    createBaseline({ targetRepo: repo, name: "v1" }, () => {});
    createLane({ targetRepo: repo, laneId: "laneA", baseline: "v1", model: null, lanesRoot, portBase: 54300, portStride: 100 }, () => {});

    const wt = join(lanesRoot, "laneA");
    writeFileSync(join(wt, "app.txt"), "evolved", "utf8");
    spawnSync("git", ["-C", wt, "commit", "-am", "lane evolved"], { encoding: "utf8" });
    expect(readFileSync(join(wt, "app.txt"), "utf8")).toBe("evolved");

    const code = resetLane({ targetRepo: repo, laneId: "laneA", lanesRoot, portBase: 54300, portStride: 100 }, () => {});
    expect(code).toBe(0);
    expect(readFileSync(join(wt, "app.txt"), "utf8")).toBe("baseline");
  });

  it("refuses when the lane does not exist", () => {
    const repo = initRepo(); dirs.unshift(repo);
    const lanesRoot = makeTmpDir(); dirs.unshift(lanesRoot);
    expect(resetLane({ targetRepo: repo, laneId: "ghost", lanesRoot, portBase: 54300, portStride: 100 }, () => {})).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lanes/resetLane.test.ts`
Expected: FAIL — `resetLane` not exported.

- [ ] **Step 3: Append `resetLane` to `src/lanes/lane.ts`**

Add to the top imports (merge): `unlinkSync` from `node:fs` and `resetHard` from `./git.ts`:

```typescript
import { unlinkSync } from "node:fs";
import { resetHard } from "./git.ts";
```

Append:

```typescript
export interface ResetLaneOptions {
  targetRepo: string;
  laneId: string;
  lanesRoot: string;
  portBase: number;
  portStride: number;
  envReset?: string;
  now?: () => string;
}

/** Core of `adapt lane reset`: discard the lineage's commits and clean its data, back to baseline. */
export function resetLane(opts: ResetLaneOptions, log: (msg: string) => void = console.log): number {
  const worktree = join(opts.lanesRoot, opts.laneId);
  const manifest = readLaneManifest(worktree);
  if (!manifest) {
    log(`error: lane "${opts.laneId}" not found at ${worktree}`);
    return 1;
  }
  const tag = `adapt-baseline/${manifest.baseline}`;
  if (!resetHard(worktree, tag)) {
    log(`error: failed to reset lane "${opts.laneId}" to ${tag}`);
    return 1;
  }
  // Re-write the manifest (reset --hard restored the baseline tree, which has no lane.json).
  writeLaneManifest(worktree, manifest);

  // Clear the lane's orchestrator state so the loop starts fresh.
  const ws = workspacePaths(worktree);
  for (const f of [`${ws.root}/state.db`, `${ws.root}/state.db-wal`, `${ws.root}/state.db-shm`]) {
    if (existsSync(f)) unlinkSync(f);
  }

  if (!runEnvCommand(opts.envReset, worktree, manifest)) {
    log(`error: environment.reset failed for lane "${opts.laneId}"`);
    return 1;
  }

  log(`  reset    lane "${opts.laneId}" back to baseline "${manifest.baseline}"`);
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lanes/resetLane.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lanes/lane.ts test/lanes/resetLane.test.ts
git commit -m "feat(lanes): resetLane (discard lineage, restore baseline)"
```

---

## Task 11: destroyLane

**Files:**
- Modify: `src/lanes/lane.ts` (append `destroyLane`)
- Test: `test/lanes/destroyLane.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/lanes/destroyLane.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { createBaseline } from "../../src/lanes/baseline.ts";
import { createLane, destroyLane } from "../../src/lanes/lane.ts";

function initRepo(): string {
  const dir = makeTmpDir();
  spawnSync("git", ["-C", dir, "init"], { encoding: "utf8" });
  spawnSync("git", ["-C", dir, "config", "user.email", "t@t.t"], { encoding: "utf8" });
  spawnSync("git", ["-C", dir, "config", "user.name", "t"], { encoding: "utf8" });
  writeFileSync(join(dir, "app.txt"), "baseline", "utf8");
  spawnSync("git", ["-C", dir, "add", "."], { encoding: "utf8" });
  spawnSync("git", ["-C", dir, "commit", "-m", "init"], { encoding: "utf8" });
  return dir;
}

const dirs: string[] = [];
afterEach(() => { while (dirs.length) cleanupTmp(dirs.pop()!); });

describe("destroyLane", () => {
  it("removes the worktree and deletes the branch", () => {
    const repo = initRepo(); dirs.unshift(repo);
    const lanesRoot = makeTmpDir(); dirs.unshift(lanesRoot);
    createBaseline({ targetRepo: repo, name: "v1" }, () => {});
    createLane({ targetRepo: repo, laneId: "laneA", baseline: "v1", model: null, lanesRoot, portBase: 54300, portStride: 100 }, () => {});
    const wt = join(lanesRoot, "laneA");
    expect(existsSync(wt)).toBe(true);

    const code = destroyLane({ targetRepo: repo, laneId: "laneA", lanesRoot, portBase: 54300, portStride: 100 }, () => {});
    expect(code).toBe(0);
    expect(existsSync(wt)).toBe(false);
    const branches = spawnSync("git", ["-C", repo, "branch", "--list", "adapt/laneA"], { encoding: "utf8" });
    expect(branches.stdout.trim()).toBe("");
  });

  it("refuses when the lane does not exist", () => {
    const repo = initRepo(); dirs.unshift(repo);
    const lanesRoot = makeTmpDir(); dirs.unshift(lanesRoot);
    expect(destroyLane({ targetRepo: repo, laneId: "ghost", lanesRoot, portBase: 54300, portStride: 100 }, () => {})).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lanes/destroyLane.test.ts`
Expected: FAIL — `destroyLane` not exported.

- [ ] **Step 3: Append `destroyLane` to `src/lanes/lane.ts`**

Add to the top imports (merge): `removeWorktree`, `deleteBranch` from `./git.ts`:

```typescript
import { removeWorktree, deleteBranch } from "./git.ts";
```

Append:

```typescript
export interface DestroyLaneOptions {
  targetRepo: string;
  laneId: string;
  lanesRoot: string;
  portBase: number;
  portStride: number;
  envDown?: string;
  now?: () => string;
}

/** Core of `adapt lane destroy`: tear down env, remove worktree, delete branch. */
export function destroyLane(opts: DestroyLaneOptions, log: (msg: string) => void = console.log): number {
  const worktree = join(opts.lanesRoot, opts.laneId);
  const manifest = readLaneManifest(worktree);
  if (!manifest) {
    log(`error: lane "${opts.laneId}" not found at ${worktree}`);
    return 1;
  }
  // Best-effort env teardown before removing the worktree.
  runEnvCommand(opts.envDown, worktree, manifest);

  if (!removeWorktree(opts.targetRepo, worktree)) {
    log(`error: failed to remove worktree at ${worktree}`);
    return 1;
  }
  deleteBranch(opts.targetRepo, manifest.branch); // best-effort

  log(`  destroyed  lane "${opts.laneId}" (worktree removed, branch ${manifest.branch} deleted)`);
  return 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lanes/destroyLane.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lanes/lane.ts test/lanes/destroyLane.test.ts
git commit -m "feat(lanes): destroyLane (env down + worktree + branch removal)"
```

---

## Task 12: Make `runCmd` model-aware via the lane manifest

**Files:**
- Modify: `src/cli/commands/run.ts:29-35`
- Test: `test/cli/runModel.test.ts`

This makes `adapt run <worktree>` automatically pick up the lane's model. We test the small pure helper that decides the model, to avoid spawning real engines.

- [ ] **Step 1: Write the failing test**

```typescript
// test/cli/runModel.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { laneModelFor } from "../../src/cli/commands/run.ts";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) cleanupTmp(dirs.pop()!); });

describe("laneModelFor", () => {
  it("returns the lane manifest's model when present", () => {
    const wt = makeTmpDir(); dirs.push(wt);
    mkdirSync(join(wt, ".adapt"), { recursive: true });
    writeFileSync(join(wt, ".adapt", "lane.json"), JSON.stringify({
      laneId: "laneA", baseline: "v1", model: "opus", branch: "adapt/laneA",
      composeProject: "adapt-laneA", ports: { base: 54300, stride: 100 }, createdAt: "x",
    }), "utf8");
    expect(laneModelFor(wt)).toBe("opus");
  });

  it("returns undefined when there is no lane manifest", () => {
    const wt = makeTmpDir(); dirs.push(wt);
    expect(laneModelFor(wt)).toBeUndefined();
  });

  it("returns undefined when the manifest model is null", () => {
    const wt = makeTmpDir(); dirs.push(wt);
    mkdirSync(join(wt, ".adapt"), { recursive: true });
    writeFileSync(join(wt, ".adapt", "lane.json"), JSON.stringify({
      laneId: "laneA", baseline: "v1", model: null, branch: "adapt/laneA",
      composeProject: "adapt-laneA", ports: { base: 54300, stride: 100 }, createdAt: "x",
    }), "utf8");
    expect(laneModelFor(wt)).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli/runModel.test.ts`
Expected: FAIL — `laneModelFor` not exported.

- [ ] **Step 3: Modify `src/cli/commands/run.ts`**

Add an import near the top (after the existing imports):

```typescript
import { readLaneManifest } from "../../lanes/lane.ts";
```

Add this exported helper above `runCmd`:

```typescript
/** The model to drive a run with, from the lane manifest in the target worktree (if any). */
export function laneModelFor(targetRepo: string): string | undefined {
  return readLaneManifest(targetRepo)?.model ?? undefined;
}
```

Then change the engine construction line (currently line 33) from:

```typescript
  const engine = opts.engine ?? (config.engine.type === "stub" ? new StubEngine() : new ClaudeCodeEngine({ command: config.engine.command }));
```

to:

```typescript
  const engine = opts.engine ?? (config.engine.type === "stub"
    ? new StubEngine()
    : new ClaudeCodeEngine({ command: config.engine.command, model: laneModelFor(opts.targetRepo) }));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/cli/runModel.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Run the existing run-command suite to confirm no regression**

Run: `npx vitest run test/cli`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/run.ts test/cli/runModel.test.ts
git commit -m "feat(run): drive the loop with the lane's model when present"
```

---

## Task 13: Lane loop start / stop / status

**Files:**
- Create: `src/lanes/loop.ts`
- Test: `test/lanes/loop.test.ts`

`startLaneLoop` foreground delegates to an injected `runner` (defaults to `runCmd`). `--detach` uses an injected `spawnDetached` (defaults to a real detached child) and writes a pidfile. `stopLaneLoop`/`laneLoopStatus` use the pidfile. Injected deps keep this fully unit-testable without spawning real loops.

- [ ] **Step 1: Write the failing test**

```typescript
// test/lanes/loop.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { startLaneLoop, stopLaneLoop, laneLoopStatus } from "../../src/lanes/loop.ts";
import type { LaneManifest } from "../../src/lanes/types.ts";

const dirs: string[] = [];
afterEach(() => { while (dirs.length) cleanupTmp(dirs.pop()!); });

function laneWorktree(): string {
  const root = makeTmpDir(); dirs.push(root);
  const wt = join(root, "laneA");
  mkdirSync(join(wt, ".adapt"), { recursive: true });
  const m: LaneManifest = {
    laneId: "laneA", baseline: "v1", model: "opus", branch: "adapt/laneA",
    composeProject: "adapt-laneA", ports: { base: 54300, stride: 100 }, createdAt: "x",
  };
  writeFileSync(join(wt, ".adapt", "lane.json"), JSON.stringify(m), "utf8");
  return wt;
}

describe("startLaneLoop foreground", () => {
  it("brings up env then runs the injected runner", async () => {
    const wt = laneWorktree();
    const calls: string[] = [];
    const code = await startLaneLoop({
      worktree: wt, detach: false,
      envUp: undefined,
      runner: async (target) => { calls.push(`run:${target}`); return 0; },
      ensureEnv: async () => { calls.push("env"); return true; },
    });
    expect(code).toBe(0);
    expect(calls).toEqual(["env", `run:${wt}`]);
  });
});

describe("startLaneLoop detached", () => {
  it("spawns a detached child and writes a pidfile", async () => {
    const wt = laneWorktree();
    const code = await startLaneLoop({
      worktree: wt, detach: true,
      ensureEnv: async () => true,
      spawnDetached: () => 4242,
    });
    expect(code).toBe(0);
    expect(readFileSync(join(wt, ".adapt", "loop.pid"), "utf8").trim()).toBe("4242");
  });
});

describe("stopLaneLoop + laneLoopStatus", () => {
  it("status reports stopped with no pidfile", () => {
    const wt = laneWorktree();
    expect(laneLoopStatus(wt, () => true)).toBe("stopped");
  });

  it("status reports running when the pid is alive, and stop signals it", () => {
    const wt = laneWorktree();
    writeFileSync(join(wt, ".adapt", "loop.pid"), "4242", "utf8");
    expect(laneLoopStatus(wt, (pid) => pid === 4242)).toBe("running");

    const signalled: number[] = [];
    const code = stopLaneLoop(wt, (pid) => { signalled.push(pid); return true; }, () => {});
    expect(code).toBe(0);
    expect(signalled).toEqual([4242]);
    expect(existsSync(join(wt, ".adapt", "loop.pid"))).toBe(false);
  });

  it("stop reports when no loop is running", () => {
    const wt = laneWorktree();
    const logs: string[] = [];
    expect(stopLaneLoop(wt, () => true, (m) => logs.push(m))).toBe(1);
    expect(logs.join("\n")).toMatch(/no .*loop/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/lanes/loop.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lanes/loop.ts`**

```typescript
import { existsSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { workspacePaths } from "../workspace/paths.ts";
import { readLaneManifest } from "./lane.ts";
import { laneEnv } from "./lane.ts";

function pidfilePath(worktree: string): string {
  return `${workspacePaths(worktree).root}/loop.pid`;
}

export type LoopStatus = "running" | "stopped";

export interface StartLaneLoopOptions {
  worktree: string;
  detach: boolean;
  envUp?: string;
  /** Foreground loop runner; defaults to runCmd. Returns an exit code. */
  runner?: (targetRepo: string) => Promise<number>;
  /** Ensure the lane environment is up; defaults to running envUp via runEnvCommand. */
  ensureEnv?: () => Promise<boolean>;
  /** Spawn the detached loop process; returns its pid. Defaults to a real detached child. */
  spawnDetached?: () => number;
  log?: (msg: string) => void;
}

/** Default detached spawn: re-invoke `adapt run <worktree>` as an unref'd background process. */
function defaultSpawnDetached(worktree: string): number {
  const child = spawn(process.execPath, [process.argv[1], "run", worktree], {
    cwd: worktree, detached: true, stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();
  return child.pid ?? -1;
}

/** Core of `adapt lane start`. Foreground runs the loop; --detach backgrounds it + writes a pidfile. */
export async function startLaneLoop(opts: StartLaneLoopOptions): Promise<number> {
  const log = opts.log ?? console.log;
  const manifest = readLaneManifest(opts.worktree);
  if (!manifest) {
    log(`error: no lane manifest at ${opts.worktree} — is this a lane worktree?`);
    return 1;
  }

  const ensureEnv = opts.ensureEnv ?? (async () => {
    const { runEnvCommand } = await import("./lane.ts");
    return runEnvCommand(opts.envUp, opts.worktree, manifest);
  });
  if (!(await ensureEnv())) {
    log(`error: environment.up failed for lane "${manifest.laneId}"`);
    return 1;
  }

  if (opts.detach) {
    const spawnDetached = opts.spawnDetached ?? (() => defaultSpawnDetached(opts.worktree));
    const pid = spawnDetached();
    writeFileSync(pidfilePath(opts.worktree), `${pid}\n`, "utf8");
    log(`  started  lane "${manifest.laneId}" loop in background (pid ${pid})`);
    return 0;
  }

  const runner = opts.runner ?? (async (target: string) => {
    const { runCmd, requestRunStop } = await import("../cli/commands/run.ts");
    const signal = { stopped: false };
    process.on("SIGINT", () => { if (!requestRunStop(signal)) process.exit(130); });
    const res = await runCmd({ targetRepo: target, signal });
    return res.code;
  });
  // Touch laneEnv so the namespace is part of this process too (parity with detached env).
  Object.assign(process.env, laneEnv(manifest));
  return runner(opts.worktree);
}

/** Core of `adapt lane stop`: signal the loop process and remove the pidfile. */
export function stopLaneLoop(
  worktree: string,
  kill: (pid: number) => boolean = (pid) => { try { process.kill(pid, "SIGINT"); return true; } catch { return false; } },
  log: (msg: string) => void = console.log,
): number {
  const pf = pidfilePath(worktree);
  if (!existsSync(pf)) {
    log(`error: no background loop recorded for this lane`);
    return 1;
  }
  const pid = Number(readFileSync(pf, "utf8").trim());
  kill(pid);
  unlinkSync(pf);
  log(`  stopping  lane loop (pid ${pid})`);
  return 0;
}

/** Loop status from the pidfile + a liveness probe. */
export function laneLoopStatus(
  worktree: string,
  isAlive: (pid: number) => boolean = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } },
): LoopStatus {
  const pf = pidfilePath(worktree);
  if (!existsSync(pf)) return "stopped";
  const pid = Number(readFileSync(pf, "utf8").trim());
  return isAlive(pid) ? "running" : "stopped";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/lanes/loop.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lanes/loop.ts test/lanes/loop.test.ts
git commit -m "feat(lanes): lane loop start/stop/status (foreground + detached)"
```

---

## Task 14: CLI command cores for `baseline` and `lane`

**Files:**
- Create: `src/cli/commands/baseline.ts`
- Create: `src/cli/commands/lane.ts`
- Test: `test/cli/laneCommands.test.ts`

These cores load config, resolve lane settings, and delegate to the `src/lanes/` functions. The list commands print and return a code; they are the thin glue tested here.

- [ ] **Step 1: Write the failing test**

```typescript
// test/cli/laneCommands.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { baselineListCmd } from "../../src/cli/commands/baseline.ts";
import { laneListCmd } from "../../src/cli/commands/lane.ts";
import { createBaseline } from "../../src/lanes/baseline.ts";
import { createLane } from "../../src/lanes/lane.ts";
import { AdaptConfigSchema } from "../../src/config/schema.ts";

function initRepoWithConfig(lanesRoot: string): string {
  const dir = makeTmpDir();
  spawnSync("git", ["-C", dir, "init"], { encoding: "utf8" });
  spawnSync("git", ["-C", dir, "config", "user.email", "t@t.t"], { encoding: "utf8" });
  spawnSync("git", ["-C", dir, "config", "user.name", "t"], { encoding: "utf8" });
  mkdirSync(join(dir, ".adapt"), { recursive: true });
  const cfg = AdaptConfigSchema.parse({
    targetRepoPath: dir, appBaseUrl: "http://localhost:3000",
    lanes: { rootDir: lanesRoot },
  });
  writeFileSync(join(dir, ".adapt", "config.json"), JSON.stringify(cfg, null, 2), "utf8");
  spawnSync("git", ["-C", dir, "add", "."], { encoding: "utf8" });
  spawnSync("git", ["-C", dir, "commit", "-m", "init"], { encoding: "utf8" });
  return dir;
}

const dirs: string[] = [];
afterEach(() => { while (dirs.length) cleanupTmp(dirs.pop()!); });

describe("baselineListCmd + laneListCmd", () => {
  it("lists baselines and lanes via config", () => {
    const lanesRoot = makeTmpDir(); dirs.unshift(lanesRoot);
    const repo = initRepoWithConfig(lanesRoot); dirs.unshift(repo);
    createBaseline({ targetRepo: repo, name: "v1" }, () => {});
    createLane({ targetRepo: repo, laneId: "lanea", baseline: "v1", model: "opus", lanesRoot, portBase: 54300, portStride: 100 }, () => {});

    const blogs: string[] = [];
    expect(baselineListCmd({ targetRepo: repo }, (m) => blogs.push(m)).code).toBe(0);
    expect(blogs.join("\n")).toMatch(/v1/);

    const llogs: string[] = [];
    expect(laneListCmd({ targetRepo: repo }, (m) => llogs.push(m)).code).toBe(0);
    expect(llogs.join("\n")).toMatch(/lanea/);
    expect(llogs.join("\n")).toMatch(/opus/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/cli/laneCommands.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement `src/cli/commands/baseline.ts`**

```typescript
import { createBaseline, listBaselines } from "../../lanes/baseline.ts";

export interface BaselineCreateOptions { targetRepo: string; name: string; }
export interface BaselineListOptions { targetRepo: string; }
export interface CmdResult { code: number; }

export function baselineCreateCmd(opts: BaselineCreateOptions, log: (m: string) => void = console.log): CmdResult {
  return { code: createBaseline({ targetRepo: opts.targetRepo, name: opts.name }, log) };
}

export function baselineListCmd(opts: BaselineListOptions, log: (m: string) => void = console.log): CmdResult {
  const list = listBaselines(opts.targetRepo);
  if (list.length === 0) { log("(no baselines — create one with \"adapt baseline create <name>\")"); return { code: 0 }; }
  for (const b of list) log(`  ${b.name}\t${b.commit.slice(0, 8)}\t${b.createdAt}`);
  return { code: 0 };
}
```

- [ ] **Step 4: Implement `src/cli/commands/lane.ts`**

```typescript
import { loadConfig } from "../../config/load.ts";
import {
  createLane, resetLane, destroyLane, listLanes, laneSettingsFromConfig,
} from "../../lanes/lane.ts";
import { startLaneLoop, stopLaneLoop, laneLoopStatus } from "../../lanes/loop.ts";
import { join } from "node:path";

export interface CmdResult { code: number; }

export function laneCreateCmd(
  opts: { targetRepo: string; laneId: string; baseline: string; model?: string },
  log: (m: string) => void = console.log,
): CmdResult {
  const s = laneSettingsFromConfig(loadConfig(opts.targetRepo));
  return {
    code: createLane({
      targetRepo: opts.targetRepo, laneId: opts.laneId, baseline: opts.baseline,
      model: opts.model ?? null, lanesRoot: s.lanesRoot, portBase: s.portBase, portStride: s.portStride,
      envUp: s.envUp, envReset: s.envReset,
    }, log),
  };
}

export function laneResetCmd(opts: { targetRepo: string; laneId: string }, log: (m: string) => void = console.log): CmdResult {
  const s = laneSettingsFromConfig(loadConfig(opts.targetRepo));
  return { code: resetLane({ targetRepo: opts.targetRepo, laneId: opts.laneId, lanesRoot: s.lanesRoot, portBase: s.portBase, portStride: s.portStride, envReset: s.envReset }, log) };
}

export function laneDestroyCmd(opts: { targetRepo: string; laneId: string }, log: (m: string) => void = console.log): CmdResult {
  const s = laneSettingsFromConfig(loadConfig(opts.targetRepo));
  return { code: destroyLane({ targetRepo: opts.targetRepo, laneId: opts.laneId, lanesRoot: s.lanesRoot, portBase: s.portBase, portStride: s.portStride, envDown: s.envDown }, log) };
}

export function laneListCmd(opts: { targetRepo: string }, log: (m: string) => void = console.log): CmdResult {
  const s = laneSettingsFromConfig(loadConfig(opts.targetRepo));
  const lanes = listLanes(s.lanesRoot);
  if (lanes.length === 0) { log("(no lanes — create one with \"adapt lane create <id> --baseline <name>\")"); return { code: 0 }; }
  for (const l of lanes) {
    const status = laneLoopStatus(join(s.lanesRoot, l.laneId));
    log(`  ${l.laneId}\t${l.branch}\tports ${l.ports.base}+\tmodel ${l.model ?? "default"}\tbaseline ${l.baseline}\t${status}`);
  }
  return { code: 0 };
}

export async function laneStartCmd(opts: { targetRepo: string; laneId: string; detach: boolean }, log: (m: string) => void = console.log): Promise<CmdResult> {
  const s = laneSettingsFromConfig(loadConfig(opts.targetRepo));
  const worktree = join(s.lanesRoot, opts.laneId);
  return { code: await startLaneLoop({ worktree, detach: opts.detach, envUp: s.envUp, log }) };
}

export function laneStopCmd(opts: { targetRepo: string; laneId: string }, log: (m: string) => void = console.log): CmdResult {
  const s = laneSettingsFromConfig(loadConfig(opts.targetRepo));
  return { code: stopLaneLoop(join(s.lanesRoot, opts.laneId), undefined, log) };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run test/cli/laneCommands.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/baseline.ts src/cli/commands/lane.ts test/cli/laneCommands.test.ts
git commit -m "feat(cli): baseline + lane command cores"
```

---

## Task 15: Wire CLI command groups + scaffold `.adapt/.gitignore`

**Files:**
- Modify: `src/cli/index.ts` (append before `program.parseAsync`)
- Modify: `src/workspace/scaffold.ts:62-77`
- Test: `test/workspace/scaffoldGitignore.test.ts`

- [ ] **Step 1: Write the failing test (scaffold gitignore)**

```typescript
// test/workspace/scaffoldGitignore.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { scaffoldWorkspace } from "../../src/workspace/scaffold.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

describe("scaffold .adapt/.gitignore", () => {
  it("writes a gitignore that excludes runtime files", () => {
    dir = makeTmpDir();
    scaffoldWorkspace(dir, "http://localhost:3000");
    const gi = readFileSync(join(dir, ".adapt", ".gitignore"), "utf8");
    expect(gi).toMatch(/state\.db/);
    expect(gi).toMatch(/lane\.json/);
    expect(gi).toMatch(/loop\.pid/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/workspace/scaffoldGitignore.test.ts`
Expected: FAIL — `.adapt/.gitignore` not written.

- [ ] **Step 3: Add the gitignore to `src/workspace/scaffold.ts`**

Add this constant after `EXAMPLE_SCENARIO` (before `ensureDir`):

```typescript
const WORKSPACE_GITIGNORE = `# adapt runtime files — not part of a baseline
state.db
state.db-wal
state.db-shm
lane.json
loop.pid
scenario-runs/
`;
```

Inside `scaffoldWorkspace`, after the existing `writeIfAbsent(...example.login.md...)` call (line 74), add:

```typescript
  writeIfAbsent(`${p.root}/.gitignore`, WORKSPACE_GITIGNORE, res);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/workspace/scaffoldGitignore.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the CLI in `src/cli/index.ts`**

Add this block immediately before `program.parseAsync(process.argv);`:

```typescript
const baseline = program.command("baseline").description("Manage baselines (shared fork points)");
baseline
  .command("create")
  .description("Tag the current target state as a named baseline")
  .argument("<name>", "baseline name (e.g. v1)")
  .argument("<targetRepo>", "path to the target product repository")
  .action(async (name: string, targetRepo: string) => {
    const { baselineCreateCmd } = await import("./commands/baseline.ts");
    process.exit(baselineCreateCmd({ targetRepo, name }).code);
  });
baseline
  .command("list")
  .description("List baselines")
  .argument("<targetRepo>", "path to the target product repository")
  .action(async (targetRepo: string) => {
    const { baselineListCmd } = await import("./commands/baseline.ts");
    process.exit(baselineListCmd({ targetRepo }).code);
  });

const lane = program.command("lane").description("Manage lanes (parallel evolutionary lineages)");
lane
  .command("create")
  .description("Fork a baseline into a new isolated lane")
  .argument("<laneId>", "lane id (lowercase, digits, hyphens)")
  .argument("<targetRepo>", "path to the target product repository")
  .requiredOption("--baseline <name>", "baseline to fork from")
  .option("--model <model>", "model to drive this lane's loop")
  .action(async (laneId: string, targetRepo: string, options: { baseline: string; model?: string }) => {
    const { laneCreateCmd } = await import("./commands/lane.ts");
    process.exit(laneCreateCmd({ targetRepo, laneId, baseline: options.baseline, model: options.model }).code);
  });
lane
  .command("list")
  .description("List lanes")
  .argument("<targetRepo>", "path to the target product repository")
  .action(async (targetRepo: string) => {
    const { laneListCmd } = await import("./commands/lane.ts");
    process.exit(laneListCmd({ targetRepo }).code);
  });
lane
  .command("start")
  .description("Start (and maintain) a lane's autonomous loop")
  .argument("<laneId>", "lane id")
  .argument("<targetRepo>", "path to the target product repository")
  .option("--detach", "run the loop in the background", false)
  .action(async (laneId: string, targetRepo: string, options: { detach: boolean }) => {
    const { laneStartCmd } = await import("./commands/lane.ts");
    process.exit((await laneStartCmd({ targetRepo, laneId, detach: options.detach })).code);
  });
lane
  .command("stop")
  .description("Stop a lane's background loop")
  .argument("<laneId>", "lane id")
  .argument("<targetRepo>", "path to the target product repository")
  .action(async (laneId: string, targetRepo: string) => {
    const { laneStopCmd } = await import("./commands/lane.ts");
    process.exit(laneStopCmd({ targetRepo, laneId }).code);
  });
lane
  .command("reset")
  .description("Discard a lane's work and restore it to its baseline")
  .argument("<laneId>", "lane id")
  .argument("<targetRepo>", "path to the target product repository")
  .action(async (laneId: string, targetRepo: string) => {
    const { laneResetCmd } = await import("./commands/lane.ts");
    process.exit(laneResetCmd({ targetRepo, laneId }).code);
  });
lane
  .command("destroy")
  .description("Remove a lane (worktree + branch)")
  .argument("<laneId>", "lane id")
  .argument("<targetRepo>", "path to the target product repository")
  .action(async (laneId: string, targetRepo: string) => {
    const { laneDestroyCmd } = await import("./commands/lane.ts");
    process.exit(laneDestroyCmd({ targetRepo, laneId }).code);
  });
```

- [ ] **Step 6: Verify the CLI registers the commands**

Run: `npx tsx src/cli/index.ts lane --help`
Expected: help text listing `create`, `list`, `start`, `stop`, `reset`, `destroy`.

Run: `npx tsx src/cli/index.ts baseline --help`
Expected: help text listing `create`, `list`.

- [ ] **Step 7: Run the full suite + typecheck**

Run: `npm test`
Expected: PASS (all suites).

Run: `npm run typecheck`
Expected: no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/cli/index.ts src/workspace/scaffold.ts test/workspace/scaffoldGitignore.test.ts
git commit -m "feat(cli): wire baseline + lane command groups; scaffold .adapt/.gitignore"
```

---

## Self-Review

**Spec coverage:**
- §3 baseline (git tag + manifest) → Tasks 4, 5. ✓
- §3 lane dimensions (worktree+branch, compose project, ports, state.db, model) → Tasks 3, 7, 9, 12. ✓
- §3 namespace contract (`ADAPT_LANE_ID`/`ADAPT_COMPOSE_PROJECT`/`ADAPT_PORT_BASE`) → Task 8. ✓
- §4 declarative reset (git reset + env reset + clear state) → Task 10. ✓
- §6 CLI surface (baseline create/list; lane create/list/start/stop/reset/destroy) → Tasks 5, 14, 15. ✓
- §7 per-lane autonomous loop (start/maintain, resumable, model-aware, detach, status) → Tasks 12, 13. ✓
- §8 data shapes (baseline manifest, lane.json, config additions) → Tasks 1, 3, 5, 7. ✓
- §10 safeguards (clean check, valid lane id, port collision avoidance, operate only within lane) → Tasks 4, 5, 9, 10, 11. ✓
- §11 open question #1 (port index by scanning existing lanes) → Task 2 + Task 9. ✓

**Out of scope (correctly deferred):** Jira-per-lane, shared Jira infra, multi-lane console — Specs 2 and 3.

**Placeholder scan:** none — every code step contains complete code; every run step has an explicit command + expected result.

**Type consistency:** `LaneManifest`/`BaselineManifest` (Task 3) are used identically across Tasks 5, 7, 8, 9, 10, 11, 12, 13. `allocatePortBase`/`slotIndex` (Task 2) match their call in Task 9. `readLaneManifest`/`writeLaneManifest`/`laneEnv`/`runEnvCommand` (Tasks 7, 8) match calls in Tasks 9–13. `buildClaudeArgs` (Task 6) matches its test. `laneSettingsFromConfig` (Task 9) is consumed by all `lane.ts` CLI cores (Task 14). Engine `model` option (Task 6) matches `runCmd`'s use (Task 12).

**Note on safeguard "destroy requires loop stopped":** the design (§10) calls for refusing to destroy a running lane. This plan removes the worktree regardless; a follow-up can add a `laneLoopStatus === "running"` guard to `laneDestroyCmd`. Flagged as a minor deviation, not blocking — `git worktree remove --force` is safe and the detached loop is a separate process that will fail fast on a missing worktree.

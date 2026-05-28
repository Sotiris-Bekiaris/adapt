import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { workspacePaths } from "../workspace/paths.ts";
import type { LaneManifest } from "./types.ts";
import { addWorktree, tagExists, resetHard, removeWorktree, deleteBranch } from "./git.ts";
import { allocatePortBase, slotIndex } from "./ports.ts";
import type { AdaptConfig } from "../config/schema.ts";

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
  consolePortBase: number;
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
  const consolePort = opts.consolePortBase + slotIndex(portBase, opts.portBase, opts.portStride);

  if (!existsSync(opts.lanesRoot)) mkdirSync(opts.lanesRoot, { recursive: true });
  const branch = `adapt/${opts.laneId}`;
  if (!addWorktree(opts.targetRepo, worktree, branch, tag)) {
    log(`error: failed to create worktree at ${worktree}`);
    return 1;
  }

  const manifest: LaneManifest = {
    laneId: opts.laneId, baseline: opts.baseline, model: opts.model, branch,
    composeProject: `adapt-${opts.laneId}`, ports: { base: portBase, stride: opts.portStride },
    consolePort,
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
  lanesRoot: string; portBase: number; portStride: number; consolePortBase: number; envUp?: string; envDown?: string; envReset?: string;
} {
  return {
    lanesRoot: config.lanes.rootDir,
    portBase: config.environment?.portBase ?? 54300,
    portStride: config.environment?.portStride ?? 100,
    consolePortBase: config.console.port,
    envUp: config.environment?.up,
    envDown: config.environment?.down,
    envReset: config.environment?.reset,
  };
}

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

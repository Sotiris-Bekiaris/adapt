import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { workspacePaths } from "../workspace/paths.ts";

/** Live control state for a lane loop, persisted in <worktree>/.adapt/control.json.
 *  maxCycles: a number bounds cycles; null means infinite; undefined means "unset"
 *  (fall back to config.run.maxCycles). */
export interface LaneControl {
  paused: boolean;
  maxCycles: number | null | undefined;
  stopRequested: boolean;
}

function controlPath(worktree: string): string {
  return join(workspacePaths(worktree).root, "control.json");
}

/** Read control state. Missing or malformed file → safe defaults (never throws). */
export function readControl(worktree: string): LaneControl {
  const path = controlPath(worktree);
  const out: LaneControl = { paused: false, maxCycles: undefined, stopRequested: false };
  if (!existsSync(path)) return out;
  try {
    const obj = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    if (typeof obj.paused === "boolean") out.paused = obj.paused;
    if (typeof obj.stopRequested === "boolean") out.stopRequested = obj.stopRequested;
    if ("maxCycles" in obj) {
      const v = obj.maxCycles;
      out.maxCycles = v === null ? null : (typeof v === "number" ? v : undefined);
    }
  } catch {
    // malformed → defaults
  }
  return out;
}

/** Read-modify-write a partial patch, atomically (temp file + rename). */
export function writeControl(worktree: string, patch: Partial<LaneControl>): void {
  const current = readControl(worktree);
  const next: LaneControl = { ...current, ...patch };
  const path = controlPath(worktree);
  const tmp = path + ".tmp";
  writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
  renameSync(tmp, path);
}

/** Reset stopRequested to false (called before a fresh start). No-op if file absent. */
export function clearStop(worktree: string): void {
  if (!existsSync(controlPath(worktree))) return;
  writeControl(worktree, { stopRequested: false });
}

/** Normalize a UI-supplied maxCycles: blank/0/negative/non-finite → null (infinite). */
export function normalizeMaxCycles(raw: number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.floor(raw);
}

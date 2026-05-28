import { loadConfig } from "../../config/load.ts";
import {
  createLane, resetLane, destroyLane, listLanes, laneSettingsFromConfig,
} from "../../lanes/lane.ts";
import { startLaneLoop, stopLaneLoop, laneLoopStatus } from "../../lanes/loop.ts";
import { join, resolve } from "node:path";

export interface CmdResult { code: number; }

/** Resolve the configured lanes root against the target repo (handles the relative default). */
function lanesRootFor(targetRepo: string, rootDir: string): string {
  return resolve(targetRepo, rootDir);
}

export function laneCreateCmd(
  opts: { targetRepo: string; laneId: string; baseline: string; model?: string },
  log: (m: string) => void = console.log,
): CmdResult {
  const s = laneSettingsFromConfig(loadConfig(opts.targetRepo));
  return {
    code: createLane({
      targetRepo: opts.targetRepo, laneId: opts.laneId, baseline: opts.baseline,
      model: opts.model ?? null, lanesRoot: lanesRootFor(opts.targetRepo, s.lanesRoot),
      portBase: s.portBase, portStride: s.portStride,
      envUp: s.envUp, envReset: s.envReset,
    }, log),
  };
}

export function laneResetCmd(opts: { targetRepo: string; laneId: string }, log: (m: string) => void = console.log): CmdResult {
  const s = laneSettingsFromConfig(loadConfig(opts.targetRepo));
  return { code: resetLane({ targetRepo: opts.targetRepo, laneId: opts.laneId, lanesRoot: lanesRootFor(opts.targetRepo, s.lanesRoot), portBase: s.portBase, portStride: s.portStride, envReset: s.envReset }, log) };
}

export function laneDestroyCmd(opts: { targetRepo: string; laneId: string }, log: (m: string) => void = console.log): CmdResult {
  const s = laneSettingsFromConfig(loadConfig(opts.targetRepo));
  return { code: destroyLane({ targetRepo: opts.targetRepo, laneId: opts.laneId, lanesRoot: lanesRootFor(opts.targetRepo, s.lanesRoot), portBase: s.portBase, portStride: s.portStride, envDown: s.envDown }, log) };
}

export function laneListCmd(opts: { targetRepo: string }, log: (m: string) => void = console.log): CmdResult {
  const s = laneSettingsFromConfig(loadConfig(opts.targetRepo));
  const lanesRoot = lanesRootFor(opts.targetRepo, s.lanesRoot);
  const lanes = listLanes(lanesRoot);
  if (lanes.length === 0) { log("(no lanes — create one with \"adapt lane create <id> --baseline <name>\")"); return { code: 0 }; }
  for (const l of lanes) {
    const status = laneLoopStatus(join(lanesRoot, l.laneId));
    log(`  ${l.laneId}\t${l.branch}\tports ${l.ports.base}+\tmodel ${l.model ?? "default"}\tbaseline ${l.baseline}\t${status}`);
  }
  return { code: 0 };
}

export async function laneStartCmd(opts: { targetRepo: string; laneId: string; detach: boolean }, log: (m: string) => void = console.log): Promise<CmdResult> {
  const s = laneSettingsFromConfig(loadConfig(opts.targetRepo));
  const worktree = join(lanesRootFor(opts.targetRepo, s.lanesRoot), opts.laneId);
  return { code: await startLaneLoop({ worktree, detach: opts.detach, envUp: s.envUp, log }) };
}

export function laneStopCmd(opts: { targetRepo: string; laneId: string }, log: (m: string) => void = console.log): CmdResult {
  const s = laneSettingsFromConfig(loadConfig(opts.targetRepo));
  return { code: stopLaneLoop(join(lanesRootFor(opts.targetRepo, s.lanesRoot), opts.laneId), undefined, log) };
}

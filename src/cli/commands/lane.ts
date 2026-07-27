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
      portBase: s.portBase, portStride: s.portStride, consolePortBase: s.consolePortBase,
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
  if (lanes.length === 0) {
    log(`(no lanes yet, looked in ${lanesRoot})`);
    log(`  A lane is a git worktree forked from a baseline. Create one:`);
    log(`    adapt lane create a ${opts.targetRepo} --baseline v1`);
    return { code: 0 };
  }
  log(`  ${"LANE".padEnd(14)}${"BRANCH".padEnd(20)}${"PORTS".padEnd(9)}${"MODEL".padEnd(16)}${"BASELINE".padEnd(14)}STATUS`);
  for (const l of lanes) {
    const status = laneLoopStatus(join(lanesRoot, l.laneId));
    log(
      `  ${l.laneId.padEnd(14)}${l.branch.padEnd(20)}${`${l.ports.base}+`.padEnd(9)}` +
      `${(l.model ?? "default").padEnd(16)}${l.baseline.padEnd(14)}${status}`,
    );
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

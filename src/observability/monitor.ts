import { join, resolve } from "node:path";
import { loadConfig } from "../config/load.ts";
import { laneSettingsFromConfig, listLanes } from "../lanes/lane.ts";
import { startLaneLoop, stopLaneLoop, laneLoopStatus } from "../lanes/loop.ts";
import { writeControl, clearStop, normalizeMaxCycles } from "../lanes/control.ts";
import { LaneRegistry } from "./laneRegistry.ts";
import { MonitorServer } from "./monitorServer.ts";
import type { ControlCommand } from "./monitorServer.ts";

export interface ControlDeps {
  lanesRoot: string;
  laneIds: () => string[];
  start: (worktree: string) => void;
  stop: (worktree: string) => void;
  pause: (worktree: string, paused: boolean) => void;
  setMaxCycles: (worktree: string, maxCycles: number | null) => void;
  waitStopped?: (worktree: string) => Promise<void>;
}

/** Pure dispatcher: maps a ControlCommand to side-effecting deps. Testable. */
export async function applyControl(cmd: ControlCommand, deps: ControlDeps): Promise<void> {
  const targets = cmd.lane === "*" ? deps.laneIds() : [cmd.lane];
  for (const laneId of targets) {
    const wt = join(deps.lanesRoot, laneId);
    switch (cmd.action) {
      case "pause": deps.pause(wt, true); break;
      case "continue": deps.pause(wt, false); break;
      case "stop": deps.stop(wt); break;
      case "start":
        if (cmd.maxCycles !== undefined) deps.setMaxCycles(wt, normalizeMaxCycles(cmd.maxCycles));
        deps.start(wt);
        break;
      case "restart":
        if (cmd.maxCycles !== undefined) deps.setMaxCycles(wt, normalizeMaxCycles(cmd.maxCycles));
        deps.stop(wt);
        await deps.waitStopped?.(wt);
        deps.start(wt);
        break;
      default: { const _exhaustive: never = cmd.action; void _exhaustive; }
    }
  }
}

/** Poll until the lane loop reports stopped, or a timeout elapses. Bounded so a
 *  hung process can't wedge a restart forever. */
async function waitLoopStopped(
  worktree: string,
  isStopped: (wt: string) => boolean,
  opts: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  const intervalMs = opts.intervalMs ?? 100;
  const sleep = opts.sleep ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isStopped(worktree)) return;
    await sleep(intervalMs);
  }
}

export interface MonitorHandle {
  port: number;
  stop: () => Promise<void>;
}

export interface MonitorOpts {
  targetRepo: string;
  port: number;
}

export async function startMonitor(opts: MonitorOpts): Promise<MonitorHandle> {
  const config = loadConfig(opts.targetRepo);
  const s = laneSettingsFromConfig(config);
  const lanesRoot = resolve(opts.targetRepo, s.lanesRoot);

  const controlDeps: ControlDeps = {
    lanesRoot,
    laneIds: () => listLanes(lanesRoot).map((m) => m.laneId),
    start: (wt) => { clearStop(wt); void startLaneLoop({ worktree: wt, detach: true, envUp: s.envUp, log: () => {} }); },
    stop: (wt) => { stopLaneLoop(wt, undefined, () => {}); },
    pause: (wt, paused) => writeControl(wt, { paused }),
    setMaxCycles: (wt, maxCycles) => writeControl(wt, { maxCycles }),
    waitStopped: (wt) => waitLoopStopped(wt, (w) => laneLoopStatus(w) === "stopped"),
  };

  let registry: LaneRegistry;
  const server = new MonitorServer({
    summaries: () => registry.summaries(),
    historyFor: (id) => registry.historyFor(id),
    control: (cmd) => { void applyControl(cmd, controlDeps); },
  });

  registry = new LaneRegistry({
    lanesRoot,
    consolePortBase: s.consolePortBase,
    portBase: s.portBase,
    portStride: s.portStride,
    onEvent: (e) => server.broadcastEvent(e),
    onChange: () => server.broadcastLanes(),
  });

  registry.start();
  const port = await server.start(opts.port);

  return {
    port,
    stop: async () => {
      registry.stop();
      await server.stop();
    },
  };
}

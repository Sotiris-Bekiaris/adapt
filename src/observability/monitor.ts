import { join, resolve } from "node:path";
import { loadConfig } from "../config/load.ts";
import { laneSettingsFromConfig, listLanes } from "../lanes/lane.ts";
import { startLaneLoop, stopLaneLoop } from "../lanes/loop.ts";
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
}

/** Pure dispatcher: maps a ControlCommand to side-effecting deps. Testable. */
export function applyControl(cmd: ControlCommand, deps: ControlDeps): void {
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
        deps.start(wt);
        break;
    }
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
  };

  let registry: LaneRegistry;
  const server = new MonitorServer({
    summaries: () => registry.summaries(),
    historyFor: (id) => registry.historyFor(id),
    control: (cmd) => applyControl(cmd, controlDeps),
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

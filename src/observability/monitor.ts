import { resolve } from "node:path";
import { loadConfig } from "../config/load.ts";
import { laneSettingsFromConfig } from "../lanes/lane.ts";
import { LaneRegistry } from "./laneRegistry.ts";
import { MonitorServer } from "./monitorServer.ts";

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

  let registry: LaneRegistry;
  const server = new MonitorServer({
    summaries: () => registry.summaries(),
    historyFor: (id) => registry.historyFor(id),
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

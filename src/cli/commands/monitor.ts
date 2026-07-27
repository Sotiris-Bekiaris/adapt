import { startMonitor } from "../../observability/monitor.ts";

export interface MonitorCmdOptions {
  targetRepo: string;
  port: number;
}

/** `adapt monitor`: watch all lanes live in one dashboard until Ctrl-C. */
export async function runMonitor(opts: MonitorCmdOptions, log = console.log): Promise<void> {
  const handle = await startMonitor({ targetRepo: opts.targetRepo, port: opts.port });
  log(`adapt monitor at http://127.0.0.1:${handle.port}  (Ctrl-C to stop)`);
  log(`Lanes stream live where a loop is running, and replay from each lane's decision log otherwise.`);
  log(`If the dashboard is empty:  adapt lane list ${opts.targetRepo}`);
  process.on("SIGINT", () => { void handle.stop().then(() => process.exit(0)); });
}

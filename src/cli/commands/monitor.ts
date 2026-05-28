import { startMonitor } from "../../observability/monitor.ts";

export interface MonitorCmdOptions {
  targetRepo: string;
  port: number;
}

/** `adapt monitor`: watch all lanes live in one dashboard until Ctrl-C. */
export async function runMonitor(opts: MonitorCmdOptions, log = console.log): Promise<void> {
  const handle = await startMonitor({ targetRepo: opts.targetRepo, port: opts.port });
  log(`adapt monitor at http://127.0.0.1:${handle.port}  (Ctrl-C to stop)`);
  process.on("SIGINT", () => { void handle.stop().then(() => process.exit(0)); });
}

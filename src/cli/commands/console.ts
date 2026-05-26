import { demoConsole } from "../../observability/console.ts";

export interface ConsoleCmdOptions {
  targetRepo: string;
  port: number;
}

/** `adapt console`: start mission control and keep it running until Ctrl-C. */
export async function runConsole(opts: ConsoleCmdOptions, log = console.log): Promise<void> {
  const handle = await demoConsole({ targetRepo: opts.targetRepo, port: opts.port, runStub: true });
  log(`adapt console at http://127.0.0.1:${handle.port}  (Ctrl-C to stop)`);
  process.on("SIGINT", () => { void handle.stop().then(() => process.exit(0)); });
}

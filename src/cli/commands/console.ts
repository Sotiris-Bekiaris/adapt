import { demoConsole } from "../../observability/console.ts";

export interface ConsoleCmdOptions {
  targetRepo: string;
  port: number;
}

/** `adapt console`: serve the single-run event console and keep it running until Ctrl-C.
 *  It replays one stub agent on startup so the page proves the event pipe end to end. */
export async function runConsole(opts: ConsoleCmdOptions, log = console.log): Promise<void> {
  const handle = await demoConsole({ targetRepo: opts.targetRepo, port: opts.port, runStub: true });
  log(`adapt console at http://127.0.0.1:${handle.port}  (Ctrl-C to stop)`);
  log(`The "demo" agent on the page is a stub, emitted once to prove the pipe works.`);
  log(`This console only shows events from its own process — it cannot attach to a running loop.`);
  log(`To watch a real loop, stop this and serve the console from the loop itself:`);
  log(`  adapt run ${opts.targetRepo} --console ${handle.port}`);
  process.on("SIGINT", () => { void handle.stop().then(() => process.exit(0)); });
}

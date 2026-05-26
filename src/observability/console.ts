import { EventBus } from "./eventBus.ts";
import { ObservabilityServer } from "./server.ts";
import { DecisionLog } from "./decisionLog.ts";
import { fromAgentEvent, type ConsoleEvent } from "./events.ts";
import { StubEngine } from "../engine/stubEngine.ts";
import { runAgent } from "../engine/runAgent.ts";

export interface DemoConsoleOptions {
  targetRepo: string;
  port: number;
  runStub?: boolean;
}

export interface ConsoleHandle {
  port: number;
  bus: EventBus<ConsoleEvent>;
  ranStub: Promise<void>;
  stop: () => Promise<void>;
}

/** Wire engine -> bus -> {decision log, server}. Optionally run one stub agent as a smoke signal. */
export async function demoConsole(opts: DemoConsoleOptions): Promise<ConsoleHandle> {
  const bus = new EventBus<ConsoleEvent>();
  const log = new DecisionLog(opts.targetRepo);
  bus.subscribe((e) => log.append(e));

  const server = new ObservabilityServer(bus);
  const port = await server.start(opts.port);

  let ranStub: Promise<void> = Promise.resolve();
  if (opts.runStub) {
    ranStub = runAgent(
      new StubEngine(),
      { role: "demo", prompt: "prove the console pipe works", cwd: opts.targetRepo },
      (e) => bus.publish(fromAgentEvent(e)),
    ).then(() => undefined);
  }

  return { port, bus, ranStub, stop: () => server.stop() };
}

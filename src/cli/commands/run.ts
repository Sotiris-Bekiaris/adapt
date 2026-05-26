import type { AgentEngine } from "../../engine/types.ts";
import { StubEngine } from "../../engine/stubEngine.ts";
import { ClaudeCodeEngine } from "../../engine/claudeCode.ts";
import { StateStore } from "../../orchestrator/store.ts";
import { loadConfig } from "../../config/load.ts";
import { workspacePaths } from "../../workspace/paths.ts";
import { runContinuous, type ContinuousSummary } from "../../orchestrator/run.ts";
import { EventBus } from "../../observability/eventBus.ts";
import { DecisionLog } from "../../observability/decisionLog.ts";
import { fromAgentEvent, fromOrchestratorEvent, type ConsoleEvent } from "../../observability/events.ts";

export interface RunCmdOptions {
  targetRepo: string;
  engine?: AgentEngine;
  log?: (msg: string) => void;
  signal?: { stopped: boolean };
}

export interface RunCmdResult { code: number; summary: ContinuousSummary; }

export function requestRunStop(signal: { stopped: boolean }, log: (msg: string) => void = console.error): boolean {
  if (signal.stopped) return false;
  signal.stopped = true;
  log("run: stopping after current cycle; press Ctrl-C again to force exit");
  return true;
}

/** Core of `adapt run`: the bounded continuous loop, events mirrored to the decision log. */
export async function runCmd(opts: RunCmdOptions): Promise<RunCmdResult> {
  const log = opts.log ?? console.log;
  const config = loadConfig(opts.targetRepo);
  const ws = workspacePaths(opts.targetRepo);
  const engine = opts.engine ?? (config.engine.type === "stub" ? new StubEngine() : new ClaudeCodeEngine({ command: config.engine.command }));
  const store = new StateStore(`${ws.root}/state.db`);

  const bus = new EventBus<ConsoleEvent>();
  const decisionLog = new DecisionLog(opts.targetRepo);
  bus.subscribe((e) => decisionLog.append(e));

  const summary = await (async () => {
    try {
      return await runContinuous({
        engine, store, config, targetRepo: opts.targetRepo,
        sink: (e) => bus.publish(fromAgentEvent(e)),
        emit: (e) => bus.publish(fromOrchestratorEvent(e)),
        signal: opts.signal,
      });
    } finally {
      store.close();
    }
  })();

  log(`run: ${summary.cycles} cycle(s), stopped by ${summary.stoppedBy}`);
  return { code: 0, summary };
}

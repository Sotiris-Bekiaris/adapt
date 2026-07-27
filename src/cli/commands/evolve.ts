import type { AgentEngine } from "../../engine/types.ts";
import { engineFor } from "./engineFor.ts";
import { StateStore } from "../../orchestrator/store.ts";
import { loadConfig } from "../../config/load.ts";
import { workspacePaths } from "../../workspace/paths.ts";
import { runEvolve, type EvolveSummary } from "../../orchestrator/evolve.ts";
import { commitWorkspace } from "../../orchestrator/git.ts";
import { EventBus } from "../../observability/eventBus.ts";
import { DecisionLog } from "../../observability/decisionLog.ts";
import { fromAgentEvent, fromOrchestratorEvent, type ConsoleEvent } from "../../observability/events.ts";

export interface EvolveCmdOptions {
  targetRepo: string;
  engine?: AgentEngine;
  log?: (msg: string) => void;
}

export interface EvolveCmdResult { code: number; summary: EvolveSummary; }

/** Core of `adapt evolve`: one full evolutionary pass, events mirrored to the decision log,
 *  workspace artifacts committed best-effort. */
export async function evolveCmd(opts: EvolveCmdOptions): Promise<EvolveCmdResult> {
  const log = opts.log ?? console.log;
  const config = loadConfig(opts.targetRepo);
  const ws = workspacePaths(opts.targetRepo);
  const engine = opts.engine ?? engineFor(config);
  const store = new StateStore(`${ws.root}/state.db`);

  const bus = new EventBus<ConsoleEvent>();
  const decisionLog = new DecisionLog(opts.targetRepo);
  bus.subscribe((e) => decisionLog.append(e));

  const summary = await runEvolve({
    engine, store, config, targetRepo: opts.targetRepo,
    sink: (e) => bus.publish(fromAgentEvent(e)),
    emit: (e) => bus.publish(fromOrchestratorEvent(e)),
  });

  store.close();
  const committed = commitWorkspace(opts.targetRepo, "adapt: evolve cycle (north-star, demands, scenarios)");

  log(`evolve: ${summary.stage.demands.length} demand(s), ${summary.stage.approved.length} approved, ` +
      `${summary.stage.scenariosCreated.length} new scenario(s); ` +
      `cycle ${summary.cycle.runs.length} run(s), ${summary.cycle.repaired.filter((r) => r.verified).length} verified` +
      `${committed ? " · artifacts committed" : ""}`);
  return { code: 0, summary };
}

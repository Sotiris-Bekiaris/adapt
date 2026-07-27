import type { AgentEngine } from "../../engine/types.ts";
import { engineFor } from "./engineFor.ts";
import { StateStore } from "../../orchestrator/store.ts";
import { loadConfig } from "../../config/load.ts";
import { workspacePaths } from "../../workspace/paths.ts";
import { runCycle, type CycleSummary } from "../../orchestrator/cycle.ts";
import { EventBus } from "../../observability/eventBus.ts";
import { DecisionLog } from "../../observability/decisionLog.ts";
import { fromAgentEvent, fromOrchestratorEvent, type ConsoleEvent } from "../../observability/events.ts";

export interface OrchestrateCmdOptions {
  targetRepo: string;
  engine?: AgentEngine;
  log?: (msg: string) => void;
}

export interface OrchestrateCmdResult { code: number; summary: CycleSummary; }

/** Core of `adapt orchestrate`: one bounded cycle, with all events mirrored to the decision log. */
export async function orchestrateCmd(opts: OrchestrateCmdOptions): Promise<OrchestrateCmdResult> {
  const log = opts.log ?? console.log;
  const config = loadConfig(opts.targetRepo);
  const ws = workspacePaths(opts.targetRepo);
  const engine = opts.engine ?? engineFor(config);
  const store = new StateStore(`${ws.root}/state.db`);

  const bus = new EventBus<ConsoleEvent>();
  const decisionLog = new DecisionLog(opts.targetRepo);
  bus.subscribe((e) => decisionLog.append(e));

  const summary = await runCycle({
    engine, store, config, targetRepo: opts.targetRepo,
    sink: (e) => bus.publish(fromAgentEvent(e)),
    emit: (e) => bus.publish(fromOrchestratorEvent(e)),
  });

  store.close();
  log(`cycle: ${summary.runs.length} run(s), ${summary.triage.created.length} new item(s), ` +
      `${summary.repaired.filter((r) => r.verified).length} verified, ${summary.repaired.filter((r) => r.parked).length} parked`);
  return { code: 0, summary };
}

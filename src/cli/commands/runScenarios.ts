import type { AgentEngine } from "../../engine/types.ts";
import { StubEngine } from "../../engine/stubEngine.ts";
import { ClaudeCodeEngine } from "../../engine/claudeCode.ts";
import { StateStore } from "../../orchestrator/store.ts";
import { Orchestrator } from "../../orchestrator/orchestrator.ts";
import { loadConfig } from "../../config/load.ts";
import { workspacePaths } from "../../workspace/paths.ts";
import { runReadyScenarios, type RunScenarioDeps } from "../../orchestrator/runScenario.ts";
import type { RunRecord } from "../../orchestrator/runRecord.ts";

export interface RunScenariosCmdOptions {
  targetRepo: string;
  scenarioId?: string;
  engine?: AgentEngine;
  log?: (msg: string) => void;
}

export interface RunScenariosCmdResult { code: number; records: RunRecord[]; }

/** Core of `adapt run-scenarios`. */
export async function runReadyScenariosCmd(opts: RunScenariosCmdOptions): Promise<RunScenariosCmdResult> {
  const log = opts.log ?? console.log;
  const config = loadConfig(opts.targetRepo);
  const ws = workspacePaths(opts.targetRepo);
  const engine = opts.engine ?? (config.engine.type === "stub" ? new StubEngine() : new ClaudeCodeEngine({ command: config.engine.command }));
  const store = new StateStore(`${ws.root}/state.db`);
  const orchestrator = new Orchestrator({
    targetRepo: opts.targetRepo, store, appBaseUrl: config.appBaseUrl,
    limits: config.limits,
  });
  const deps: RunScenarioDeps & { scenarioId?: string } = {
    engine, orchestrator, config, targetRepo: opts.targetRepo, sink: () => {}, scenarioId: opts.scenarioId,
  };
  const records = await runReadyScenarios(deps);
  for (const r of records) log(`  ${r.status.padEnd(12)} ${r.scenarioId}  ${r.scenarioTitle}`);
  log(`\n${records.length} scenario(s) run.`);
  store.close();
  return { code: 0, records };
}

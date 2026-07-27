import type { AgentEngine } from "../../engine/types.ts";
import { engineFor } from "./engineFor.ts";
import { StateStore } from "../../orchestrator/store.ts";
import { Orchestrator } from "../../orchestrator/orchestrator.ts";
import { loadConfig } from "../../config/load.ts";
import { workspacePaths } from "../../workspace/paths.ts";
import { runReadyScenarios, type RunScenarioDeps } from "../../orchestrator/runScenario.ts";
import type { RunRecord } from "../../orchestrator/runRecord.ts";

export interface RunScenariosCmdOptions {
  targetRepo: string;
  scenarioId?: string;
  /** Exit non-zero when any scenario did not pass. Off by default: in the loop, failures are input. */
  failOnFailure?: boolean;
  engine?: AgentEngine;
  log?: (msg: string) => void;
}

export interface RunScenariosCmdResult { code: number; records: RunRecord[]; }

/** Core of `adapt run-scenarios`. */
export async function runReadyScenariosCmd(opts: RunScenariosCmdOptions): Promise<RunScenariosCmdResult> {
  const log = opts.log ?? console.log;
  const config = loadConfig(opts.targetRepo);
  const ws = workspacePaths(opts.targetRepo);
  const engine = opts.engine ?? engineFor(config);
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

  if (records.length === 0) {
    // Nothing ran. Say why, because "0 scenario(s) run." is indistinguishable from a crash.
    if (opts.scenarioId) {
      log(`no scenario with id "${opts.scenarioId}" in ${ws.scenariosDir}`);
      log(`  Ids come from the "id:" field in each scenario's frontmatter, not the filename.`);
      store.close();
      return { code: 1, records };
    }
    log(`no runnable scenarios in ${ws.scenariosDir}`);
    log(`  adapt reads *.md from the top level of that directory only — files under examples/ are ignored.`);
    log(`  A scenario runs when its frontmatter status is ready, active, or regression.`);
    log(`  Seed one:  cp ${ws.scenariosDir}/examples/example.login.md ${ws.scenariosDir}/SCN-001.md`);
    store.close();
    return { code: 0, records };
  }

  const counts = new Map<string, number>();
  for (const r of records) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  const breakdown = [...counts].map(([status, n]) => `${n} ${status}`).join(", ");
  log(`\n${records.length} scenario(s) run — ${breakdown}.`);
  store.close();

  const anyNotPassed = records.some((r) => r.status !== "passed");
  return { code: opts.failOnFailure && anyNotPassed ? 1 : 0, records };
}

import { runDemandStage, type DemandStageSummary } from "../demand/demandStage.ts";
import { runCycle, type CycleDeps, type CycleSummary } from "./cycle.ts";

export type EvolveDeps = CycleDeps;

export interface EvolveSummary {
  stage: DemandStageSummary;
  cycle: CycleSummary;
}

/** One full evolutionary pass: demand stage (dream -> critique -> generate) then the Phase 1 cycle. */
export async function runEvolve(deps: EvolveDeps): Promise<EvolveSummary> {
  const stage = await runDemandStage({
    engine: deps.engine, config: deps.config, targetRepo: deps.targetRepo, sink: deps.sink, now: deps.now,
  });
  const cycle = await runCycle(deps);
  return { stage, cycle };
}

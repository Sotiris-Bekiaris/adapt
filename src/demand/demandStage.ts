import type { AgentEngine, AgentEvent } from "../engine/types.ts";
import type { AdaptConfig } from "../config/schema.ts";
import { runDream } from "./dream.ts";
import { runCritique } from "./critique.ts";
import { runGenerate } from "./generate.ts";
import type { Demand } from "./demand.ts";

export interface DemandStageDeps {
  engine: AgentEngine;
  config: AdaptConfig;
  targetRepo: string;
  sink: (e: AgentEvent) => void;
  now?: () => string;
}

export interface DemandStageSummary {
  ambitionAppended: boolean;
  demands: Demand[];
  approved: Demand[];
  scenariosCreated: { id: string; filename: string }[];
}

/** One demand-generation pass: dream -> critique -> generate scenarios for approved demands. */
export async function runDemandStage(deps: DemandStageDeps): Promise<DemandStageSummary> {
  const dream = await runDream(deps);
  const approved = await runCritique(deps);
  const scenariosCreated = await runGenerate(deps, approved);
  return { ambitionAppended: dream.ambitionAppended, demands: dream.demands, approved, scenariosCreated };
}

import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { AgentEngine, AgentEvent } from "../engine/types.ts";
import type { AdaptConfig } from "../config/schema.ts";
import { workspacePaths } from "../workspace/paths.ts";
import { runRole } from "../agents/runRole.ts";
import { mcpServersFor } from "../engine/mcp.ts";
import { criticPrompt, CriticVerdictSchema } from "../agents/prompts/critic.ts";
import { LocalDemandStore } from "./demandStore.ts";
import type { Demand } from "./demand.ts";

export interface CritiqueDeps {
  engine: AgentEngine;
  config: AdaptConfig;
  targetRepo: string;
  sink: (e: AgentEvent) => void;
}

/** Critic pass over every proposed demand. Returns the approved demands. */
export async function runCritique(deps: CritiqueDeps): Promise<Demand[]> {
  const { engine, config, targetRepo, sink } = deps;
  const ws = workspacePaths(targetRepo);
  const store = new LocalDemandStore(targetRepo);
  const northStar = existsSync(ws.northStar) ? readFileSync(ws.northStar, "utf8") : "";

  const approved: Demand[] = [];
  for (const demand of store.listByStatus("proposed")) {
    const resultPath = join(ws.demandsDir, `critic-${demand.id}.json`);
    const outcome = await runRole(
      engine,
      {
        role: "critic",
        prompt: criticPrompt({ demand, northStar, resultPath }),
        cwd: targetRepo,
        mcpServers: mcpServersFor("critic", config),
      },
      resultPath, CriticVerdictSchema, sink,
    );
    if (outcome.status !== "ok" || !outcome.value) continue; // no valid verdict → leave proposed, skip
    const decided: Demand = { ...demand, status: outcome.value.decision, critique: outcome.value.critique };
    store.update(decided);
    if (decided.status === "approved") approved.push(decided);
  }
  return approved;
}

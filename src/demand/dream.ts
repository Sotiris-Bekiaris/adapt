import { join } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { AgentEngine, AgentEvent } from "../engine/types.ts";
import type { AdaptConfig } from "../config/schema.ts";
import { workspacePaths } from "../workspace/paths.ts";
import { rebuildRegistry } from "../scenarios/registry.ts";
import { runRole } from "../agents/runRole.ts";
import { mcpServersFor } from "../engine/mcp.ts";
import { dreamerPrompt, DreamResultSchema } from "../agents/prompts/dreamer.ts";
import { LocalDemandStore } from "./demandStore.ts";
import { newDemand, type Demand } from "./demand.ts";
import { appendAmbition } from "./northStar.ts";
import { demandTitleKey } from "./dedupeDemand.ts";

export interface DreamDeps {
  engine: AgentEngine;
  config: AdaptConfig;
  targetRepo: string;
  sink: (e: AgentEvent) => void;
  now?: () => string;
}

/** One Dreamer pass: append an ambition (if proposed) and persist capped demands. */
export async function runDream(deps: DreamDeps): Promise<{ ambitionAppended: boolean; demands: Demand[] }> {
  const { engine, config, targetRepo, sink } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const ws = workspacePaths(targetRepo);
  const store = new LocalDemandStore(targetRepo);

  const northStar = existsSync(ws.northStar) ? readFileSync(ws.northStar, "utf8") : "";
  const scenarioSummary = rebuildRegistry(targetRepo).map((e) => `${e.id} ${e.title}`).join("\n") || "(none yet)";
  const resultPath = join(ws.demandsDir, "dream.json");

  const outcome = await runRole(
    engine,
    {
      role: "dreamer",
      prompt: dreamerPrompt({ northStar, scenarioSummary, resultPath, maxDemands: config.limits.maxDemandsPerCycle }),
      cwd: targetRepo,
      mcpServers: mcpServersFor("dreamer", config),
    },
    resultPath, DreamResultSchema, sink,
  );

  if (outcome.status !== "ok" || !outcome.value) return { ambitionAppended: false, demands: [] };

  let ambitionAppended = false;
  if (outcome.value.ambition) {
    appendAmbition(targetRepo, outcome.value.ambition, now);
    ambitionAppended = true;
  }

  const created: Demand[] = [];
  const seen = new Set(store.list().filter((d) => d.status !== "rejected").map((d) => demandTitleKey(d.title)));
  for (const d of outcome.value.demands) {
    if (created.length >= config.limits.maxDemandsPerCycle) break;
    const key = demandTitleKey(d.title);
    if (seen.has(key)) continue; // dedup against existing + already-created-this-pass
    seen.add(key);
    const demand = newDemand({ id: store.nextId(), title: d.title, rationale: d.rationale, proposedScenarios: d.proposedScenarios, createdAt: now() });
    store.create(demand);
    created.push(demand);
  }
  return { ambitionAppended, demands: created };
}

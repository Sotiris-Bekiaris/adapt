import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { AgentEngine, AgentEvent } from "../engine/types.ts";
import type { AdaptConfig } from "../config/schema.ts";
import { StateStore } from "./store.ts";
import { Orchestrator, type OrchestratorEvent } from "./orchestrator.ts";
import { workspacePaths } from "../workspace/paths.ts";
import { rebuildRegistry } from "../scenarios/registry.ts";
import { parseScenario, type ParsedScenario } from "../scenarios/parse.ts";
import { runReadyScenarios } from "./runScenario.ts";
import { triageFailures, type TriageSummary } from "./triage.ts";
import { implementWorkItem, verifyWorkItem, moveItemToNeedsAttention } from "./repair.ts";
import { LocalTracker } from "../tracker/localTracker.ts";
import type { RunRecord } from "./runRecord.ts";

export interface CycleDeps {
  engine: AgentEngine;
  store: StateStore;
  config: AdaptConfig;
  targetRepo: string;
  sink: (e: AgentEvent) => void;
  emit: (e: OrchestratorEvent) => void;
  now?: () => string;
  nowDate?: () => Date;
}

export interface CycleSummary {
  runs: RunRecord[];
  triage: TriageSummary;
  repaired: { itemId: string; verified: boolean; parked: boolean }[];
}

function loadScenario(targetRepo: string, id: string): ParsedScenario | undefined {
  const ws = workspacePaths(targetRepo);
  const entry = rebuildRegistry(targetRepo).find((e) => e.id === id);
  if (!entry) return undefined;
  return parseScenario(readFileSync(join(ws.scenariosDir, entry.filename), "utf8"), entry.filename);
}

/** Run one bounded autonomous pass: validate -> triage -> repair -> verify. No infinite loop. */
export async function runCycle(deps: CycleDeps): Promise<CycleSummary> {
  const { engine, store, config, targetRepo, sink, emit } = deps;
  const orchestrator = new Orchestrator({
    targetRepo, store, appBaseUrl: config.appBaseUrl, limits: config.limits,
    emit, clock: deps.now, now: deps.nowDate,
  });

  const runs = await runReadyScenarios({ engine, orchestrator, config, targetRepo, sink });
  const triage = await triageFailures({ engine, store, config, targetRepo, sink, now: deps.now });

  const repaired: CycleSummary["repaired"] = [];
  const repairDeps = { engine, orchestrator, config, targetRepo, sink };
  const tracker = new LocalTracker(targetRepo);

  for (const created of triage.created) {
    const scenario = loadScenario(targetRepo, created.scenarioId);
    if (!scenario) continue;

    if (!orchestrator.canAttempt(created.scenarioId, "fix")) {
      const parked = moveItemToNeedsAttention(tracker, created);
      repaired.push({ itemId: parked.id, verified: false, parked: true });
      continue;
    }

    const impl = await implementWorkItem(repairDeps, created, scenario);
    if (!impl.ok) {
      repaired.push({ itemId: created.id, verified: false, parked: false });
      continue;
    }
    const ver = await verifyWorkItem(repairDeps, impl.item, scenario);
    repaired.push({ itemId: created.id, verified: ver.verified, parked: ver.parked });
  }

  return { runs, triage, repaired };
}

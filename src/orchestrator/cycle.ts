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
import { implementWorkItem, verifyWorkItem, moveItemToNeedsAttention, type RepairDeps } from "./repair.ts";
import { LocalTracker } from "../tracker/localTracker.ts";
import type { WorkItem } from "../tracker/workItem.ts";
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

/** Run one bounded autonomous pass: recover -> validate -> triage -> repair (new + in-flight). No infinite loop. */
export async function runCycle(deps: CycleDeps): Promise<CycleSummary> {
  const { engine, store, config, targetRepo, sink, emit } = deps;
  const orchestrator = new Orchestrator({
    targetRepo, store, appBaseUrl: config.appBaseUrl, limits: config.limits,
    emit, clock: deps.now, now: deps.nowDate,
  });

  orchestrator.recoverIncomplete(); // clean up runs stranded by a crashed prior cycle

  const runs = await runReadyScenarios({ engine, orchestrator, config, targetRepo, sink });
  const triage = await triageFailures({ engine, store, config, targetRepo, sink, now: deps.now });

  const repaired: CycleSummary["repaired"] = [];
  const repairDeps = { engine, orchestrator, config, targetRepo, sink };
  const tracker = new LocalTracker(targetRepo);

  const createdIds = new Set(triage.created.map((c) => c.id));

  // 1. Drive the newly-created work-items.
  for (const created of triage.created) {
    const scenario = loadScenario(targetRepo, created.scenarioId);
    if (!scenario) continue;
    repaired.push(await driveItem(repairDeps, orchestrator, tracker, created, scenario));
  }

  // 2. Re-drive pre-existing in-flight items from earlier cycles (reopened -> re-implement,
  //    ready-for-verification -> re-verify after a prior inconclusive).
  for (const item of tracker.list()) {
    if (createdIds.has(item.id)) continue;
    if (item.status !== "reopened" && item.status !== "ready-for-verification") continue;
    const scenario = loadScenario(targetRepo, item.scenarioId);
    if (!scenario) continue;
    repaired.push(await driveItem(repairDeps, orchestrator, tracker, item, scenario));
  }

  return { runs, triage, repaired };
}

/** Drive a single work-item to its next state. ready-for-verification -> verify only;
 *  triaged/reopened -> implement (within fix attempts) then verify. */
async function driveItem(
  repairDeps: RepairDeps, orchestrator: Orchestrator, tracker: LocalTracker, item: WorkItem, scenario: ParsedScenario,
): Promise<{ itemId: string; verified: boolean; parked: boolean }> {
  if (item.status === "ready-for-verification") {
    const ver = await verifyWorkItem(repairDeps, item, scenario);
    return { itemId: item.id, verified: ver.verified, parked: ver.parked };
  }
  if (!orchestrator.canAttempt(item.scenarioId, "fix")) {
    const parked = moveItemToNeedsAttention(tracker, item);
    return { itemId: parked.id, verified: false, parked: true };
  }
  const impl = await implementWorkItem(repairDeps, item, scenario);
  if (!impl.ok) return { itemId: item.id, verified: false, parked: false };
  const ver = await verifyWorkItem(repairDeps, impl.item, scenario);
  return { itemId: item.id, verified: ver.verified, parked: ver.parked };
}

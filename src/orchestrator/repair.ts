import { join } from "node:path";
import type { AgentEngine, AgentEvent } from "../engine/types.ts";
import type { AdaptConfig } from "../config/schema.ts";
import type { Orchestrator } from "./orchestrator.ts";
import type { WorkItemStatus } from "../types.ts";
import { assertTransition } from "./stateMachine.ts";
import { WORK_ITEM_TRANSITIONS } from "./lifecycles.ts";
import { workspacePaths } from "../workspace/paths.ts";
import { runRole } from "../agents/runRole.ts";
import { mcpServersFor } from "../engine/mcp.ts";
import { LocalTracker } from "../tracker/localTracker.ts";
import type { WorkItem } from "../tracker/workItem.ts";
import type { ParsedScenario } from "../scenarios/parse.ts";
import { implementationPrompt, ImplResultSchema, type ImplResult } from "../agents/prompts/implementation.ts";
import { verificationPrompt, VerificationResultSchema } from "../agents/prompts/verification.ts";

export interface RepairDeps {
  engine: AgentEngine;
  orchestrator: Orchestrator;
  config: AdaptConfig;
  targetRepo: string;
  sink: (e: AgentEvent) => void;
}

/** Move a work-item to `to`, validating the transition, and persist it. Returns the updated item. */
function moveItem(tracker: LocalTracker, item: WorkItem, to: WorkItemStatus): WorkItem {
  assertTransition(WORK_ITEM_TRANSITIONS, item.status, to);
  const updated = { ...item, status: to };
  tracker.update(updated);
  return updated;
}

export function moveItemToNeedsAttention(tracker: LocalTracker, item: WorkItem): WorkItem {
  return moveItem(tracker, item, "needs-attention");
}

/** Implement a fix for a work-item on a branch. Never closes the item. */
export async function implementWorkItem(
  deps: RepairDeps, item: WorkItem, scenario: ParsedScenario,
): Promise<{ ok: boolean; item: WorkItem; result?: ImplResult }> {
  const { engine, orchestrator, config, targetRepo, sink } = deps;
  const ws = workspacePaths(targetRepo);
  const tracker = new LocalTracker(targetRepo);

  orchestrator.recordAttempt(item.scenarioId, "fix");
  let current = moveItem(tracker, item, "in-progress");

  const branch = `adapt/${item.id}`;
  const resultPath = join(ws.workItemsDir, `impl-${item.id}.json`);
  const outcome = await runRole(
    engine,
    {
      role: "implementation",
      prompt: implementationPrompt({ item: current, scenario, branch, resultPath, jiraEnabled: config.mcp.jira.enabled }),
      cwd: targetRepo,
      mcpServers: mcpServersFor("implementation", config),
    },
    resultPath, ImplResultSchema, sink,
  );

  if (outcome.status !== "ok" || !outcome.value) {
    return { ok: false, item: current };
  }

  current = moveItem(tracker, current, "in-review");
  current = moveItem(tracker, current, "ready-for-verification");
  return { ok: true, item: current, result: outcome.value };
}

/** Independently verify a fix by rerunning the scenario black-box. Owns the done/reopen decision.
 *  A missing/invalid result is inconclusive: the item is left at ready-for-verification for a later
 *  retry and no verification attempt is consumed (never a false "still-failing"). */
export async function verifyWorkItem(
  deps: RepairDeps, item: WorkItem, scenario: ParsedScenario,
): Promise<{ verified: boolean; item: WorkItem; parked: boolean; inconclusive: boolean }> {
  const { engine, orchestrator, config, targetRepo, sink } = deps;
  const ws = workspacePaths(targetRepo);
  const tracker = new LocalTracker(targetRepo);

  if (!orchestrator.canAttempt(item.scenarioId, "verification")) {
    return { verified: false, item: moveItem(tracker, item, "needs-attention"), parked: true, inconclusive: false };
  }

  const resultPath = join(ws.workItemsDir, `verify-${item.id}.json`);
  const outcome = await runRole(
    engine,
    {
      role: "verification",
      prompt: verificationPrompt({ item, scenario, appBaseUrl: config.appBaseUrl, resultPath, jiraEnabled: config.mcp.jira.enabled }),
      cwd: targetRepo,
      mcpServers: mcpServersFor("verification", config),
    },
    resultPath, VerificationResultSchema, sink,
  );

  // Infra failure (no valid verdict): inconclusive — retry next cycle, don't consume an attempt or reopen.
  if (outcome.status !== "ok" || !outcome.value) {
    return { verified: false, item, parked: false, inconclusive: true };
  }

  orchestrator.recordAttempt(item.scenarioId, "verification");

  if (outcome.value.verified) {
    const done = moveItem(tracker, item, "done");
    orchestrator["store"].setScenarioState(item.scenarioId, "regression");
    return { verified: true, item: done, parked: false, inconclusive: false };
  }

  let current = moveItem(tracker, item, "reopened");
  if (!orchestrator.canAttempt(item.scenarioId, "verification")) {
    current = moveItem(tracker, current, "needs-attention");
    return { verified: false, item: current, parked: true, inconclusive: false };
  }
  return { verified: false, item: current, parked: false, inconclusive: false };
}

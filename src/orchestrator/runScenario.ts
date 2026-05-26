import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { AgentEngine, AgentEvent } from "../engine/types.ts";
import type { Orchestrator } from "./orchestrator.ts";
import type { AdaptConfig } from "../config/schema.ts";
import { workspacePaths } from "../workspace/paths.ts";
import { parseScenario, type ParsedScenario } from "../scenarios/parse.ts";
import { rebuildRegistry } from "../scenarios/registry.ts";
import { RunRecordSchema, type RunRecord } from "./runRecord.ts";
import { runRole } from "../agents/runRole.ts";
import { runnerPrompt } from "../agents/prompts/runner.ts";
import { mcpServersFor } from "../engine/mcp.ts";
import { runHook } from "./hooks.ts";

export interface RunScenarioDeps {
  engine: AgentEngine;
  orchestrator: Orchestrator;
  config: AdaptConfig;
  targetRepo: string;
  sink: (e: AgentEvent) => void;
}

/** The only verdicts a runner agent may report. RunRecordSchema allows every RunStatus
 *  (incl. queued/running/archived), so we guard: anything else → inconclusive, never a throw. */
const RUNNER_VERDICTS: readonly string[] = ["passed", "failed", "blocked", "flaky", "invalid", "inconclusive"];

/** Scenario statuses that are eligible to be run by the runner. */
const RUNNABLE_STATUSES: readonly string[] = ["ready", "active", "regression"];

/** Run one scenario end-to-end. Always returns the finalized RunRecord (never throws on agent failure). */
export async function runScenario(deps: RunScenarioDeps, scenario: ParsedScenario): Promise<RunRecord> {
  const { engine, orchestrator, config, targetRepo, sink } = deps;
  const ws = workspacePaths(targetRepo);
  const run = orchestrator.createRun(scenario.meta.id, scenario.meta.title);

  const setup = runHook(scenario.meta.hooks?.setup ?? config.hooks.setup, targetRepo);
  if (!setup.ok) {
    return orchestrator.recordResult(run.runId, {
      status: "blocked",
      runnerNotes: `setup hook failed (exit ${setup.code}): ${setup.output.slice(0, 500)}`,
    });
  }

  orchestrator.advanceRun(run.runId, "running");
  const resultPath = join(ws.runsDir, `${run.runId}.agent.json`);
  const outcome = await runRole(
    engine,
    {
      role: "runner",
      prompt: runnerPrompt({ scenario, appBaseUrl: config.appBaseUrl, resultPath, runId: run.runId }),
      cwd: targetRepo,
      mcpServers: mcpServersFor("runner", config),
    },
    resultPath,
    RunRecordSchema,
    sink,
  );

  // Teardown always runs, even if the run failed.
  runHook(scenario.meta.hooks?.teardown ?? config.hooks.teardown, targetRepo);

  if (outcome.status !== "ok" || !outcome.value) {
    return orchestrator.recordResult(run.runId, {
      status: "inconclusive",
      runnerNotes: `runner produced no valid result (${outcome.status}${outcome.error ? `: ${outcome.error}` : ""})`,
    });
  }

  const v = outcome.value;
  const verdict = RUNNER_VERDICTS.includes(v.status) ? v.status : "inconclusive";
  const notes = verdict === v.status
    ? v.runnerNotes
    : `runner returned out-of-vocabulary status "${v.status}"; treated as inconclusive`;
  return orchestrator.recordResult(run.runId, {
    status: verdict,
    stepsExecuted: v.stepsExecuted,
    failureStep: v.failureStep,
    expectedOutcome: v.expectedOutcome,
    actualOutcome: v.actualOutcome,
    consoleErrors: v.consoleErrors,
    networkErrors: v.networkErrors,
    screenshots: v.screenshots,
    artifacts: v.artifacts,
    runnerNotes: notes,
  });
}

/**
 * Run runnable scenarios, or a single scenario by id (an explicit id runs regardless of status).
 * Without an id, only scenarios in a runnable status (ready/active/regression) are executed.
 */
export async function runReadyScenarios(deps: RunScenarioDeps & { scenarioId?: string }): Promise<RunRecord[]> {
  const ws = workspacePaths(deps.targetRepo);
  const entries = rebuildRegistry(deps.targetRepo);
  const selected = deps.scenarioId
    ? entries.filter((e) => e.id === deps.scenarioId)
    : entries.filter((e) => RUNNABLE_STATUSES.includes(e.status));
  const records: RunRecord[] = [];
  for (const e of selected) {
    const scenario = parseScenario(readFileSync(join(ws.scenariosDir, e.filename), "utf8"), e.filename);
    records.push(await runScenario(deps, scenario));
  }
  return records;
}

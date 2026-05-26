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
  return orchestrator.recordResult(run.runId, {
    status: v.status,
    failureStep: v.failureStep,
    expectedOutcome: v.expectedOutcome,
    actualOutcome: v.actualOutcome,
    consoleErrors: v.consoleErrors,
    networkErrors: v.networkErrors,
    screenshots: v.screenshots,
    artifacts: v.artifacts,
    runnerNotes: v.runnerNotes,
  });
}

/** Run every registered scenario (or one, by id). Returns the finalized records. */
export async function runReadyScenarios(deps: RunScenarioDeps & { scenarioId?: string }): Promise<RunRecord[]> {
  const ws = workspacePaths(deps.targetRepo);
  const entries = rebuildRegistry(deps.targetRepo);
  const selected = deps.scenarioId ? entries.filter((e) => e.id === deps.scenarioId) : entries;
  const records: RunRecord[] = [];
  for (const e of selected) {
    const scenario = parseScenario(readFileSync(join(ws.scenariosDir, e.filename), "utf8"), e.filename);
    records.push(await runScenario(deps, scenario));
  }
  return records;
}

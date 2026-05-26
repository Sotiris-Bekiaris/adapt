import type { AgentEngine } from "../../engine/types.ts";
import { StubEngine } from "../../engine/stubEngine.ts";
import { ClaudeCodeEngine } from "../../engine/claudeCode.ts";
import { StateStore } from "../../orchestrator/store.ts";
import { loadConfig } from "../../config/load.ts";
import { workspacePaths } from "../../workspace/paths.ts";
import { triageFailures, type TriageSummary } from "../../orchestrator/triage.ts";

export interface TriageCmdOptions {
  targetRepo: string;
  engine?: AgentEngine;
  log?: (msg: string) => void;
}

export interface TriageCmdResult { code: number; summary: TriageSummary; }

/** Core of `adapt triage-failures`. */
export async function triageFailuresCmd(opts: TriageCmdOptions): Promise<TriageCmdResult> {
  const log = opts.log ?? console.log;
  const config = loadConfig(opts.targetRepo);
  const ws = workspacePaths(opts.targetRepo);
  const engine = opts.engine ?? (config.engine.type === "stub" ? new StubEngine() : new ClaudeCodeEngine({ command: config.engine.command }));
  const store = new StateStore(`${ws.root}/state.db`);
  const summary = await triageFailures({ engine, store, config, targetRepo: opts.targetRepo, sink: () => {} });
  store.close();
  log(`triaged: ${summary.created.length} new, ${summary.deduped.length} deduped, ${summary.skipped.length} skipped`);
  for (const i of summary.created) log(`  ${i.id}  [${i.severity}] ${i.title}${i.jiraKey ? `  (${i.jiraKey})` : ""}`);
  return { code: 0, summary };
}

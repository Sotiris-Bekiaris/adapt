import { join } from "node:path";
import type { AgentEngine, AgentEvent } from "../engine/types.ts";
import type { AdaptConfig } from "../config/schema.ts";
import { workspacePaths } from "../workspace/paths.ts";
import { StateStore } from "./store.ts";
import { RunLedger } from "./runLedger.ts";
import { runRole } from "../agents/runRole.ts";
import { mcpServersFor } from "../engine/mcp.ts";
import { dedupeKey } from "../tracker/dedupe.ts";
import { LocalTracker } from "../tracker/localTracker.ts";
import { newWorkItem, type WorkItem } from "../tracker/workItem.ts";
import { triagePrompt, TriageResultSchema } from "../agents/prompts/triage.ts";

export interface TriageDeps {
  engine: AgentEngine;
  store: StateStore;
  config: AdaptConfig;
  targetRepo: string;
  sink: (e: AgentEvent) => void;
  now?: () => string;
}

export interface TriageSummary {
  created: WorkItem[];
  deduped: { itemId: string; runId: string }[];
  skipped: string[];
}

/** Convert un-triaged failed runs into deduped, classified work-items. */
export async function triageFailures(deps: TriageDeps): Promise<TriageSummary> {
  const { engine, store, config, targetRepo, sink } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const ws = workspacePaths(targetRepo);
  const tracker = new LocalTracker(targetRepo);
  const ledger = new RunLedger(targetRepo, store);

  const summary: TriageSummary = { created: [], deduped: [], skipped: [] };
  const linked = tracker.allLinkedRunIds();
  const candidates = store.findRunsByStatus("failed").filter((r) => !linked.has(r.runId));
  let createdCount = 0;

  for (const row of candidates) {
    const record = ledger.read(row.runId);
    const key = dedupeKey(record);

    const existing = tracker.findByDedupeKey(key);
    if (existing) {
      tracker.appendRun(existing.id, record.runId);
      summary.deduped.push({ itemId: existing.id, runId: record.runId });
      continue;
    }

    if (createdCount >= config.limits.maxItemsPerRun) {
      summary.skipped.push(record.runId);
      continue;
    }

    const resultPath = join(ws.workItemsDir, `triage-${record.runId}.json`);
    const outcome = await runRole(
      engine,
      {
        role: "triage",
        prompt: triagePrompt({ record, resultPath, jiraEnabled: config.mcp.jira.enabled, projectKey: config.jira.projectKey }),
        cwd: targetRepo,
        mcpServers: mcpServersFor("triage", config),
      },
      resultPath,
      TriageResultSchema,
      sink,
    );

    if (outcome.status !== "ok" || !outcome.value || !outcome.value.isActionable) {
      summary.skipped.push(record.runId);
      continue;
    }

    const item = newWorkItem({ id: tracker.nextId(), record, dedupeKey: key, createdAt: now(), triage: outcome.value });
    tracker.create(item);
    summary.created.push(item);
    createdCount++;
  }

  return summary;
}

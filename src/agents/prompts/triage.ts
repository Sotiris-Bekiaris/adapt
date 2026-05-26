import { z } from "zod";
import { CLASSIFICATIONS, SEVERITIES } from "../../tracker/workItem.ts";
import type { RunRecord } from "../../orchestrator/runRecord.ts";

export const TriageResultSchema = z.object({
  classification: z.enum(CLASSIFICATIONS),
  severity: z.enum(SEVERITIES),
  title: z.string().min(1),
  isActionable: z.boolean(),
  jiraKey: z.string().nullable().default(null),
  notes: z.string().default(""),
});
export type TriageResult = z.infer<typeof TriageResultSchema>;

export interface TriagePromptCtx {
  record: RunRecord;
  resultPath: string;
  jiraEnabled: boolean;
  projectKey: string;
}

export function triagePrompt(ctx: TriagePromptCtx): string {
  const { record, resultPath, jiraEnabled, projectKey } = ctx;
  const jiraInstruction = jiraEnabled
    ? `Because Jira is enabled, create a Jira issue in project ${projectKey} (type Bug) using the Jira MCP, with the title, the expected vs actual, reproduction = the scenario steps, and the evidence below. Put the created issue key in "jiraKey".`
    : `Jira is disabled. Set jiraKey: null. Do not attempt to create a Jira issue.`;
  return `You are a failure-triage analyst. A black-box run of a scenario FAILED. Decide whether this is a real,
actionable product bug, and classify it. You may use the Chrome DevTools MCP to inspect the failing page if helpful.
Do NOT modify any code.

FAILED RUN ${record.runId} — scenario ${record.scenarioId} "${record.scenarioTitle}"
Failing step: ${record.failureStep ?? "?"}
Expected: ${record.expectedOutcome ?? ""}
Actual:   ${record.actualOutcome ?? ""}
Console errors: ${JSON.stringify(record.consoleErrors)}
Network errors: ${JSON.stringify(record.networkErrors)}
Runner notes: ${record.runnerNotes ?? ""}

Classify it:
- classification: one of ${CLASSIFICATIONS.join(", ")}.
- severity: one of ${SEVERITIES.join(", ")}.
- isActionable: true only if this is a real product defect worth fixing (not a test-data/environment/flaky/invalid-scenario artifact).
- title: a concise issue title.

${jiraInstruction}

Write your verdict as a single JSON object to this exact path:
RESULT_FILE=${resultPath}
Shape: { "classification": "...", "severity": "...", "title": "...", "isActionable": true|false, "jiraKey": "KEY-123"|null, "notes": "..." }`;
}

import { z } from "zod";
import { RUN_STATUSES } from "../../types.ts";
import type { ParsedScenario } from "../../scenarios/parse.ts";
import type { WorkItem } from "../../tracker/workItem.ts";

export const VerificationResultSchema = z.object({
  verified: z.boolean(),
  status: z.enum(RUN_STATUSES),
  failureStep: z.number().int().nullable().default(null),
  actualOutcome: z.string().nullable().default(null),
  notes: z.string().default(""),
});
export type VerificationResult = z.infer<typeof VerificationResultSchema>;

export interface VerificationPromptCtx {
  item: WorkItem;
  scenario: ParsedScenario;
  appBaseUrl: string;
  resultPath: string;
  jiraEnabled: boolean;
}

export function verificationPrompt(ctx: VerificationPromptCtx): string {
  const { item, scenario, appBaseUrl, resultPath, jiraEnabled } = ctx;
  const jira = jiraEnabled && item.jiraKey
    ? `If verified, move Jira issue ${item.jiraKey} to "Done" via the Jira MCP. If still failing, move it back to "In Progress".`
    : `Jira is not in play; skip Jira updates.`;
  return `You are an INDEPENDENT verifier. A fix was just attempted for the work item below. Your job is to confirm,
black-box, whether the original user scenario now succeeds. Behave exactly like the user. Do NOT read the source code
or the fix diff — interact only through the browser (Playwright MCP) against the running app at ${appBaseUrl}.

WORK ITEM ${item.id} — ${item.title}${item.jiraKey ? ` (Jira ${item.jiraKey})` : ""}
SCENARIO ${scenario.meta.id}: ${scenario.meta.title}

${scenario.body}

Rerun the scenario faithfully. Decide:
- verified: true ONLY if the visible expected outcome is now genuinely achieved.
- status: the run verdict ("passed" when verified; otherwise "failed"/"blocked"/"flaky"/"inconclusive").
Capture the failing step + what you actually saw if it still fails.

${jira}

Write your result as a single JSON object to this exact path:
RESULT_FILE=${resultPath}
Shape: { "verified": true|false, "status": "passed|failed|...", "failureStep": <int|null>, "actualOutcome": "<text>|null", "notes": "<text>" }`;
}

import { z } from "zod";
import type { ParsedScenario } from "../../scenarios/parse.ts";
import type { WorkItem } from "../../tracker/workItem.ts";

export const ImplResultSchema = z.object({
  branch: z.string().min(1),
  summary: z.string(),
  testsPassed: z.boolean(),
});
export type ImplResult = z.infer<typeof ImplResultSchema>;

export interface ImplPromptCtx {
  item: WorkItem;
  scenario: ParsedScenario;
  branch: string;
  resultPath: string;
  jiraEnabled: boolean;
}

export function implementationPrompt(ctx: ImplPromptCtx): string {
  const { item, scenario, branch, resultPath, jiraEnabled } = ctx;
  const jira = jiraEnabled && item.jiraKey
    ? `Move the Jira issue ${item.jiraKey} to "Ready for Verification" (or "In Review") via the Jira MCP. Do NOT move it to Done.`
    : `Jira is not in play for this item; skip Jira updates.`;
  return `You are a software engineer fixing a tracked defect. You have full source access and may use the
Chrome DevTools MCP to inspect the running app while debugging.

WORK ITEM ${item.id} [${item.severity}] — ${item.title}${item.jiraKey ? ` (Jira ${item.jiraKey})` : ""}
Scenario ${scenario.meta.id}: ${scenario.meta.title}
Expected: ${item.expected ?? ""}
Actual:   ${item.actual ?? ""}

Scenario detail:
${scenario.body}

Do this:
1. Create and work on a git branch named exactly: ${branch}
2. Make the SMALLEST safe change that makes the user's expected outcome achievable. Add or update an automated test where practical.
3. Run the project's checks/tests.
4. ${jira}

Hard rules:
- Do NOT close the work item or move Jira to Done — verification is a separate, independent step.
- Do NOT weaken or edit the scenario to make it pass. Do NOT delete scenarios.
- Commit your change on the branch.

Write your result as a single JSON object to this exact path:
RESULT_FILE=${resultPath}
Shape: { "branch": "${branch}", "summary": "<what you changed>", "testsPassed": true|false }`;
}

import type { ParsedScenario } from "../../scenarios/parse.ts";

export interface RunnerPromptCtx {
  scenario: ParsedScenario;
  appBaseUrl: string;
  resultPath: string;
  runId: string;
}

/** Prompt for the black-box Scenario Runner agent. */
export function runnerPrompt(ctx: RunnerPromptCtx): string {
  const { scenario, appBaseUrl, resultPath, runId } = ctx;
  return `You are a black-box QA runner. You behave exactly like the user described below.
You do NOT have access to the source code. Do NOT read the repository. Interact only through the browser
(Playwright MCP) against the running app at ${appBaseUrl}.

SCENARIO ${scenario.meta.id}: ${scenario.meta.title}
Persona: ${scenario.meta.persona}

${scenario.body}

Execute the steps as this user would. Judge the outcome HONESTLY:
- "passed" ONLY if the visible expected outcome is genuinely achieved.
- "failed" if a step is impossible, an error appears, or the expected outcome is not visible.
- "blocked" if you cannot even begin (e.g., cannot reach the app / log in with the given data).
- "flaky" if behavior differs across repeats; "invalid" if the scenario references something that no longer exists.
Capture evidence: which step failed, what you actually saw vs expected, browser console errors, failed network requests.

When finished you MUST write your verdict as a single JSON object to this exact path:
RESULT_FILE=${resultPath}

The JSON must conform to the RunRecord schema:
{ "runId": "${runId}", "scenarioId": "${scenario.meta.id}", "scenarioTitle": ${JSON.stringify(scenario.meta.title)},
  "status": "passed|failed|blocked|flaky|invalid|inconclusive",
  "startedAt": "<iso>", "finishedAt": "<iso>", "appBaseUrl": "${appBaseUrl}",
  "appVersion": null, "environment": "local", "stepsExecuted": <int>, "failureStep": <int|null>,
  "expectedOutcome": "<text>", "actualOutcome": "<text>",
  "consoleErrors": [], "networkErrors": [], "screenshots": [], "artifacts": [],
  "linkedJiraIssue": null, "runnerNotes": "<short notes>" }
Write the file before you finish. Do not guess a pass.`;
}

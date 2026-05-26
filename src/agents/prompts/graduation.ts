import type { ParsedScenario } from "../../scenarios/parse.ts";

export interface GraduationPromptCtx {
  scenario: ParsedScenario;
  appBaseUrl: string;
  specPath: string;
}

/** Prompt for the Grad agent: freeze a proven scenario into a deterministic Playwright spec. */
export function graduationPrompt(ctx: GraduationPromptCtx): string {
  const { scenario, appBaseUrl, specPath } = ctx;
  return `You are the Graduation agent. The scenario below has passed reliably, many times. Freeze it into a
DETERMINISTIC Playwright test so it can run cheaply in CI without an LLM. You may read the source code and explore the
running app (Chrome DevTools MCP) to find robust selectors, but do NOT change product code or the scenario.

SCENARIO ${scenario.meta.id}: ${scenario.meta.title}
Persona: ${scenario.meta.persona}

${scenario.body}

Write a single Playwright test (TypeScript, @playwright/test) that drives the app at ${appBaseUrl} through the scenario's
steps and asserts the visible expected outcome. Prefer role/text/accessibility-based locators over brittle CSS. Add an
explicit wait for the success condition. The test must be self-contained and deterministic.

Write the test to this exact path:
SPEC_FILE=${specPath}
Write the file before you finish.`;
}

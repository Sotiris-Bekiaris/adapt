import { describe, it, expect } from "vitest";
import { runnerPrompt } from "../../src/agents/prompts/runner.ts";
import { parseScenario } from "../../src/scenarios/parse.ts";

const scenario = parseScenario(`---
id: SCN-001
title: A user can log in
status: ready
priority: high
persona: Returning user
tags: [auth]
source: human-seeded
---
As a returning user, log in and land on the home page.

## Expected outcome
- The home page is shown.
`, "auth.login.md");

describe("runnerPrompt", () => {
  it("includes the scenario, app URL, the RESULT_FILE contract, and a black-box instruction", () => {
    const p = runnerPrompt({ scenario, appBaseUrl: "http://localhost:3000", resultPath: "/repo/.adapt/scenario-runs/RUN-1.agent.json", runId: "RUN-1" });
    expect(p).toContain("SCN-001");
    expect(p).toContain("A user can log in");
    expect(p).toContain("http://localhost:3000");
    expect(p).toContain("RESULT_FILE=/repo/.adapt/scenario-runs/RUN-1.agent.json");
    expect(p.toLowerCase()).toContain("do not");        // black-box: no source access
    expect(p).toContain("passed");                       // verdict vocabulary
    expect(p).toContain("RUN-1");
  });
});

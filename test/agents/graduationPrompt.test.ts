import { describe, it, expect } from "vitest";
import { graduationPrompt } from "../../src/agents/prompts/graduation.ts";
import { parseScenario } from "../../src/scenarios/parse.ts";

const scenario = parseScenario(`---
id: SCN-001
title: A user can log in
status: regression
priority: high
persona: Returning user
tags: [auth]
source: agent-discovered
---
# Scenario
Log in and land on the home page.

## Expected outcome
- The home page is shown.
`, "auth.login.md");

describe("graduationPrompt", () => {
  it("names the scenario, the app URL, the SPEC_FILE path, and asks for a Playwright test", () => {
    const p = graduationPrompt({ scenario, appBaseUrl: "http://localhost:3000", specPath: "/repo/tests/adapt/SCN-001.spec.ts" });
    expect(p).toContain("SCN-001");
    expect(p).toContain("A user can log in");
    expect(p).toContain("http://localhost:3000");
    expect(p).toContain("SPEC_FILE=/repo/tests/adapt/SCN-001.spec.ts");
    expect(p.toLowerCase()).toContain("playwright");
  });
});

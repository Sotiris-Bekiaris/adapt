import { describe, it, expect } from "vitest";
import { verificationPrompt, VerificationResultSchema } from "../../src/agents/prompts/verification.ts";
import { parseScenario } from "../../src/scenarios/parse.ts";
import type { WorkItem } from "../../src/tracker/workItem.ts";

const scenario = parseScenario(`---
id: SCN-001
title: Login works
status: ready-for-verification
priority: high
persona: User
tags: [auth]
source: human-seeded
---
Log in and see the home page.
`, "auth.login.md");

const item: WorkItem = { id: "ITEM-001", title: "Login fails", scenarioId: "SCN-001", runIds: ["RUN-1"], expected: "home page", actual: "error toast", classification: "bug", severity: "high", dedupeKey: "k", status: "ready-for-verification", jiraKey: "ADAPT-7", labels: [], notes: "", createdAt: "t" };

describe("verification", () => {
  it("VerificationResultSchema validates and defaults", () => {
    const r = VerificationResultSchema.parse({ verified: true, status: "passed" });
    expect(r.failureStep).toBeNull();
    // adapt cannot verify a Jira transition, so the agent is not asked to report one back.
    expect(Object.keys(r)).not.toContain("jiraMovedTo");
  });
  it("prompt is black-box, names the scenario + app URL + RESULT_FILE, and the independence rule", () => {
    const p = verificationPrompt({ item, scenario, appBaseUrl: "http://localhost:3000", resultPath: "/r/.adapt/work-items/verify-ITEM-001.json", jiraEnabled: true });
    expect(p).toContain("SCN-001");
    expect(p).toContain("http://localhost:3000");
    expect(p).toContain("RESULT_FILE=/r/.adapt/work-items/verify-ITEM-001.json");
    expect(p.toLowerCase()).toContain("do not read");   // independent / black-box
    expect(p).toContain("ADAPT-7");
  });
});

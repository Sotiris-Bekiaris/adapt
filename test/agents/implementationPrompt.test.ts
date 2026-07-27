import { describe, it, expect } from "vitest";
import { implementationPrompt, ImplResultSchema } from "../../src/agents/prompts/implementation.ts";
import { parseScenario } from "../../src/scenarios/parse.ts";
import type { WorkItem } from "../../src/tracker/workItem.ts";

const scenario = parseScenario(`---
id: SCN-001
title: Login works
status: failed
priority: high
persona: User
tags: [auth]
source: human-seeded
---
Log in and see the home page.
`, "auth.login.md");

const item: WorkItem = { id: "ITEM-001", title: "Login fails on submit", scenarioId: "SCN-001", runIds: ["RUN-1"], expected: "home page", actual: "error toast", classification: "bug", severity: "high", dedupeKey: "k", status: "triaged", jiraKey: "ADAPT-7", labels: [], notes: "", createdAt: "t" };

describe("implementation", () => {
  it("ImplResultSchema validates and reports only what adapt consumes", () => {
    const r = ImplResultSchema.parse({ branch: "adapt/ITEM-001", summary: "fixed null guard", testsPassed: true });
    expect(r.branch).toBe("adapt/ITEM-001");
    expect(r.testsPassed).toBe(true);
    // adapt cannot verify a Jira transition, so the agent is not asked to report one back.
    expect(Object.keys(r)).not.toContain("jiraMovedTo");
  });
  it("prompt names the work-item, scenario, branch, RESULT_FILE, and the do-not-close rule", () => {
    const p = implementationPrompt({ item, scenario, branch: "adapt/ITEM-001", resultPath: "/r/.adapt/work-items/impl-ITEM-001.json", jiraEnabled: true });
    expect(p).toContain("ITEM-001");
    expect(p).toContain("SCN-001");
    expect(p).toContain("adapt/ITEM-001");
    expect(p).toContain("RESULT_FILE=/r/.adapt/work-items/impl-ITEM-001.json");
    expect(p.toLowerCase()).toContain("do not close");
    expect(p).toContain("ADAPT-7");
  });
});

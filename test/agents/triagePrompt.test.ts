import { describe, it, expect } from "vitest";
import { triagePrompt, TriageResultSchema } from "../../src/agents/prompts/triage.ts";

const record = {
  runId: "RUN-1", scenarioId: "SCN-001", scenarioTitle: "Login works", status: "failed", startedAt: "t", finishedAt: "t",
  appBaseUrl: "http://x", appVersion: null, environment: "local", stepsExecuted: 3, failureStep: 2,
  expectedOutcome: "home page", actualOutcome: "error toast", consoleErrors: ["TypeError"], networkErrors: [],
  screenshots: [], artifacts: [], linkedJiraIssue: null, runnerNotes: "",
} as any;

describe("triage", () => {
  it("TriageResultSchema validates a verdict and defaults jiraKey/notes", () => {
    const v = TriageResultSchema.parse({ classification: "bug", severity: "high", title: "Login fails", isActionable: true });
    expect(v.jiraKey).toBeNull();
    expect(v.notes).toBe("");
  });
  it("prompt includes the evidence, the RESULT_FILE contract, and a Jira instruction when enabled", () => {
    const p = triagePrompt({ record, resultPath: "/r/.adapt/work-items/triage-RUN-1.json", jiraEnabled: true, projectKey: "ADAPT" });
    expect(p).toContain("SCN-001");
    expect(p).toContain("error toast");
    expect(p).toContain("RESULT_FILE=/r/.adapt/work-items/triage-RUN-1.json");
    expect(p.toLowerCase()).toContain("jira");
    expect(p).toContain("ADAPT");
  });
  it("prompt omits Jira creation when disabled", () => {
    const p = triagePrompt({ record, resultPath: "/x.json", jiraEnabled: false, projectKey: "" });
    expect(p).toContain("jiraKey: null");
  });
});

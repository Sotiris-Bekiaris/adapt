import { describe, it, expect } from "vitest";
import { WorkItemSchema, newWorkItem } from "../../src/tracker/workItem.ts";
import type { RunRecord } from "../../src/orchestrator/runRecord.ts";

const record: RunRecord = {
  runId: "RUN-1", scenarioId: "SCN-001", scenarioTitle: "Login works", status: "failed",
  startedAt: "t", finishedAt: "t", appBaseUrl: "http://x", appVersion: null, environment: "local",
  stepsExecuted: 3, failureStep: 2, expectedOutcome: "home page", actualOutcome: "error toast",
  consoleErrors: ["TypeError x"], networkErrors: [], screenshots: [], artifacts: [], linkedJiraIssue: null, runnerNotes: "",
};

describe("WorkItem", () => {
  it("newWorkItem builds a valid triaged item from a run + triage verdict", () => {
    const item = newWorkItem({
      id: "ITEM-001", record, dedupeKey: "k", createdAt: "2026-05-26T10:00:00.000Z",
      triage: { classification: "bug", severity: "high", title: "Login fails on submit", isActionable: true, jiraKey: "ADAPT-12", notes: "" },
    });
    expect(WorkItemSchema.safeParse(item).success).toBe(true);
    expect(item.runIds).toEqual(["RUN-1"]);
    expect(item.status).toBe("triaged");
    expect(item.jiraKey).toBe("ADAPT-12");
    expect(item.expected).toBe("home page");
    expect(item.actual).toBe("error toast");
  });

  it("rejects an unknown classification", () => {
    expect(WorkItemSchema.safeParse({ id: "ITEM-001", title: "x", scenarioId: "SCN-001", runIds: ["RUN-1"], expected: null, actual: null, classification: "weird", severity: "low", dedupeKey: "k", status: "open", jiraKey: null, labels: [], notes: "", createdAt: "t" }).success).toBe(false);
  });
});

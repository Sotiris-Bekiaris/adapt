import { describe, it, expect } from "vitest";
import { dedupeKey } from "../../src/tracker/dedupe.ts";

const base = {
  runId: "RUN-1", scenarioId: "SCN-001", scenarioTitle: "x", status: "failed", startedAt: "t", finishedAt: "t",
  appBaseUrl: "http://x", appVersion: null, environment: "local", stepsExecuted: 3, failureStep: 2,
  expectedOutcome: "home", actualOutcome: "Error TOAST  shown", consoleErrors: ["TypeError: x is undefined"],
  networkErrors: [], screenshots: [], artifacts: [], runnerNotes: "",
} as any;

describe("dedupeKey", () => {
  it("is identical for the same failure regardless of whitespace/case in actualOutcome", () => {
    const a = dedupeKey(base);
    const b = dedupeKey({ ...base, runId: "RUN-2", actualOutcome: "error toast shown" });
    expect(a).toBe(b);
  });
  it("differs when the failing step differs", () => {
    expect(dedupeKey(base)).not.toBe(dedupeKey({ ...base, failureStep: 3 }));
  });
  it("differs when the first console error differs", () => {
    expect(dedupeKey(base)).not.toBe(dedupeKey({ ...base, consoleErrors: ["ReferenceError: y"] }));
  });
  it("incorporates the scenario id", () => {
    expect(dedupeKey(base)).not.toBe(dedupeKey({ ...base, scenarioId: "SCN-002" }));
  });
});

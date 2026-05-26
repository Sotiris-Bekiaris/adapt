import { describe, it, expect } from "vitest";
import { RunRecordSchema, newRunRecord } from "../../src/orchestrator/runRecord.ts";

describe("RunRecord", () => {
  it("newRunRecord builds a valid queued record with sensible defaults", () => {
    const r = newRunRecord({
      runId: "RUN-1", scenarioId: "SCN-001", scenarioTitle: "Login",
      appBaseUrl: "http://localhost:3000", startedAt: "2026-05-25T10:00:00.000Z",
    });
    expect(RunRecordSchema.safeParse(r).success).toBe(true);
    expect(r.status).toBe("queued");
    expect(r.consoleErrors).toEqual([]);
    expect(r.finishedAt).toBeNull();
  });

  it("rejects an invalid status", () => {
    const r = { ...newRunRecord({ runId: "RUN-1", scenarioId: "SCN-001", scenarioTitle: "x", appBaseUrl: "http://localhost:3000", startedAt: "2026-05-25T10:00:00.000Z" }), status: "weird" };
    expect(RunRecordSchema.safeParse(r).success).toBe(false);
  });
});

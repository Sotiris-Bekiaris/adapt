import { describe, it, expect } from "vitest";
import { makeRunId, defaultClock } from "../../src/orchestrator/ids.ts";

describe("ids", () => {
  it("makeRunId embeds a compact timestamp and a sequence", () => {
    const id = makeRunId(new Date("2026-05-25T10:15:00.000Z"), 1);
    expect(id).toBe("RUN-20260525T101500-1");
  });

  it("defaultClock returns an ISO string", () => {
    expect(defaultClock()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

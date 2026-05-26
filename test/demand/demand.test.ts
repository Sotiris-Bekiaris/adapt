import { describe, it, expect } from "vitest";
import { DemandSchema, newDemand } from "../../src/demand/demand.ts";

describe("Demand", () => {
  it("newDemand builds a proposed demand", () => {
    const d = newDemand({ id: "DMD-001", title: "Add CSV export", rationale: "users ask for it", proposedScenarios: ["Export the project list as CSV"], createdAt: "t" });
    expect(DemandSchema.safeParse(d).success).toBe(true);
    expect(d.status).toBe("proposed");
    expect(d.source).toBe("dreamer");
    expect(d.critique).toBeNull();
  });
  it("rejects an id that is not DMD-<number>", () => {
    expect(DemandSchema.safeParse({ id: "X1", title: "t", rationale: "", proposedScenarios: [], source: "dreamer", status: "proposed", critique: null, createdAt: "t" }).success).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { DemandSchema, newDemand, DEMAND_STATUSES } from "../../src/demand/demand.ts";

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

describe("duplicate status", () => {
  it("includes 'duplicate' as a valid status", () => {
    expect(DEMAND_STATUSES).toContain("duplicate");
  });

  it("newDemand defaults duplicateOf to null", () => {
    const d = newDemand({ id: "DMD-001", title: "t", rationale: "r", proposedScenarios: [], createdAt: "t" });
    expect(d.duplicateOf).toBeNull();
  });

  it("DemandSchema accepts a duplicate demand naming what it overlaps", () => {
    const d = DemandSchema.parse({
      id: "DMD-002", title: "t", rationale: "r", proposedScenarios: [], source: "dreamer",
      status: "duplicate", critique: null, createdAt: "t", duplicateOf: "SCN-005",
    });
    expect(d.status).toBe("duplicate");
    expect(d.duplicateOf).toBe("SCN-005");
  });

  it("DemandSchema defaults duplicateOf to null when absent (back-compat)", () => {
    const d = DemandSchema.parse({
      id: "DMD-003", title: "t", rationale: "r", proposedScenarios: [], source: "dreamer",
      status: "proposed", critique: null, createdAt: "t",
    });
    expect(d.duplicateOf).toBeNull();
  });
});

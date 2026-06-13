import { describe, it, expect } from "vitest";
import { criticPrompt, CriticVerdictSchema } from "../../src/agents/prompts/critic.ts";
import { newDemand } from "../../src/demand/demand.ts";

describe("critic", () => {
  it("CriticVerdictSchema validates and defaults critique + duplicateOf", () => {
    const v = CriticVerdictSchema.parse({ decision: "approved" });
    expect(v.critique).toBe("");
    expect(v.duplicateOf).toBeNull();
  });

  it("CriticVerdictSchema accepts a duplicate verdict", () => {
    const v = CriticVerdictSchema.parse({ decision: "duplicate", duplicateOf: "SCN-009" });
    expect(v.decision).toBe("duplicate");
    expect(v.duplicateOf).toBe("SCN-009");
  });

  it("prompt presents the demand, north-star, corpus, RESULT_FILE, and the duplicate option", () => {
    const demand = newDemand({ id: "DMD-001", title: "Add CSV export", rationale: "users ask", proposedScenarios: ["Export list as CSV"], createdAt: "t" });
    const p = criticPrompt({
      demand, northStar: "Be the best CRM.", corpus: "Existing scenarios:\nSCN-009 · Export contacts [export]",
      resultPath: "/r/.adapt/demands/critic-DMD-001.json",
    });
    expect(p).toContain("DMD-001");
    expect(p).toContain("Add CSV export");
    expect(p).toContain("Be the best CRM");
    expect(p).toContain("SCN-009 · Export contacts");
    expect(p).toContain("RESULT_FILE=/r/.adapt/demands/critic-DMD-001.json");
    expect(p.toLowerCase()).toContain("approved");
    expect(p.toLowerCase()).toContain("duplicate");
  });
});

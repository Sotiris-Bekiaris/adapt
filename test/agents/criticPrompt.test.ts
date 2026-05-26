import { describe, it, expect } from "vitest";
import { criticPrompt, CriticVerdictSchema } from "../../src/agents/prompts/critic.ts";
import { newDemand } from "../../src/demand/demand.ts";

describe("critic", () => {
  it("CriticVerdictSchema validates and defaults critique", () => {
    const v = CriticVerdictSchema.parse({ decision: "approved" });
    expect(v.critique).toBe("");
  });
  it("prompt presents the demand, the north-star, and the RESULT_FILE", () => {
    const demand = newDemand({ id: "DMD-001", title: "Add CSV export", rationale: "users ask", proposedScenarios: ["Export list as CSV"], createdAt: "t" });
    const p = criticPrompt({ demand, northStar: "Be the best CRM.", resultPath: "/r/.adapt/demands/critic-DMD-001.json" });
    expect(p).toContain("DMD-001");
    expect(p).toContain("Add CSV export");
    expect(p).toContain("Be the best CRM");
    expect(p).toContain("RESULT_FILE=/r/.adapt/demands/critic-DMD-001.json");
    expect(p.toLowerCase()).toContain("approved");
  });
});

import { describe, it, expect } from "vitest";
import { generatorPrompt } from "../../src/agents/prompts/generator.ts";
import { newDemand } from "../../src/demand/demand.ts";

describe("generatorPrompt", () => {
  it("names the demand, the assigned IDs, the scenarios dir, and the black-box/format rules", () => {
    const demand = newDemand({ id: "DMD-003", title: "CSV export", rationale: "users ask", proposedScenarios: ["Export the project list as CSV"], createdAt: "t" });
    const p = generatorPrompt({ demand, scenariosDir: "/r/.adapt/scenarios", assignedIds: ["SCN-006", "SCN-007"] });
    expect(p).toContain("DMD-003");
    expect(p).toContain("CSV export");
    expect(p).toContain("SCN-006");
    expect(p).toContain("SCN-007");
    expect(p).toContain("/r/.adapt/scenarios");
    expect(p).toContain("agent-discovered");
    expect(p).toContain("status: ready");
    expect(p.toLowerCase()).toContain("black-box");
  });
});

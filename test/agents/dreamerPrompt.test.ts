import { describe, it, expect } from "vitest";
import { dreamerPrompt, DreamResultSchema } from "../../src/agents/prompts/dreamer.ts";

describe("dreamer", () => {
  it("DreamResultSchema validates and defaults ambition to null + demands to []", () => {
    const r = DreamResultSchema.parse({});
    expect(r.ambition).toBeNull();
    expect(r.demands).toEqual([]);
  });
  it("prompt includes the north-star, the scenario summary, the cap, and the RESULT_FILE", () => {
    const p = dreamerPrompt({ northStar: "# North Star\nBe the best CRM.", scenarioSummary: "SCN-001 Login", resultPath: "/r/.adapt/demands/dream.json", maxDemands: 3 });
    expect(p).toContain("Be the best CRM");
    expect(p).toContain("SCN-001 Login");
    expect(p).toContain("RESULT_FILE=/r/.adapt/demands/dream.json");
    expect(p).toContain("3");
    expect(p.toLowerCase()).toContain("ambition");
  });
});

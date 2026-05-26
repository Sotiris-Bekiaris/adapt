import { describe, it, expect } from "vitest";
import { workspacePaths } from "../../src/workspace/paths.ts";

describe("workspacePaths", () => {
  it("derives all workspace paths from a target repo dir", () => {
    const p = workspacePaths("/repo");
    expect(p.root).toBe("/repo/.adapt");
    expect(p.configFile).toBe("/repo/.adapt/config.json");
    expect(p.northStar).toBe("/repo/.adapt/north-star.md");
    expect(p.scenariosDir).toBe("/repo/.adapt/scenarios");
    expect(p.scenarioIndex).toBe("/repo/.adapt/scenarios/index.json");
    expect(p.runsDir).toBe("/repo/.adapt/scenario-runs");
    expect(p.workItemsDir).toBe("/repo/.adapt/work-items");
    expect(p.verificationReportsDir).toBe("/repo/.adapt/verification-reports");
    expect(p.decisionLogDir).toBe("/repo/.adapt/decision-log");
    expect(p.demandsDir).toBe("/repo/.adapt/demands");
  });

  it("resolves relative target dirs to absolute", () => {
    const p = workspacePaths(".");
    expect(p.root.startsWith("/")).toBe(true);
    expect(p.root.endsWith("/.adapt")).toBe(true);
  });
});

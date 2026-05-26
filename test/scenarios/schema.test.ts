import { describe, it, expect } from "vitest";
import { ScenarioMetaSchema } from "../../src/scenarios/schema.ts";

const valid = {
  id: "SCN-001",
  title: "Create a new project",
  status: "active",
  priority: "high",
  persona: "Project manager",
  tags: ["projects", "create-flow"],
  source: "human-seeded",
};

describe("ScenarioMetaSchema", () => {
  it("accepts valid frontmatter and defaults optional fields", () => {
    const m = ScenarioMetaSchema.parse(valid);
    expect(m.lastResult).toBe("unknown");
    expect(m.lastRunId).toBeNull();
    expect(m.linkedIssues).toEqual([]);
  });

  it("rejects an id that is not SCN-<number>", () => {
    expect(ScenarioMetaSchema.safeParse({ ...valid, id: "X1" }).success).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(ScenarioMetaSchema.safeParse({ ...valid, status: "bogus" }).success).toBe(false);
  });

  it("accepts optional setup/teardown hooks", () => {
    const m = ScenarioMetaSchema.parse({ ...valid, hooks: { setup: "npm run seed", teardown: "npm run clean" } });
    expect(m.hooks?.setup).toBe("npm run seed");
  });
});

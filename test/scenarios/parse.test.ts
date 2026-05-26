import { describe, it, expect } from "vitest";
import { parseScenario, ScenarioParseError } from "../../src/scenarios/parse.ts";

const file = `---
id: SCN-001
title: Create a new project
status: active
priority: high
persona: Project manager
tags: [projects, create-flow]
source: human-seeded
---

# Scenario

As a project manager, create a new project and verify it appears in the list.

## Expected outcome

- The project appears in the project list.
`;

describe("parseScenario", () => {
  it("returns validated meta and the markdown body", () => {
    const s = parseScenario(file, "projects.create.md");
    expect(s.meta.id).toBe("SCN-001");
    expect(s.meta.priority).toBe("high");
    expect(s.body).toContain("verify it appears in the list");
    expect(s.filename).toBe("projects.create.md");
  });

  it("throws ScenarioParseError on invalid frontmatter", () => {
    const bad = file.replace("id: SCN-001", "id: nope");
    expect(() => parseScenario(bad, "bad.md")).toThrow(ScenarioParseError);
  });

  it("throws ScenarioParseError when frontmatter is absent", () => {
    expect(() => parseScenario("# just markdown", "x.md")).toThrow(ScenarioParseError);
  });
});

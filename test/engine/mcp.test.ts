import { describe, it, expect } from "vitest";
import { mcpServersFor } from "../../src/engine/mcp.ts";
import { AdaptConfigSchema } from "../../src/config/schema.ts";

const cfg = (over = {}) => AdaptConfigSchema.parse({ targetRepoPath: "/r", appBaseUrl: "http://localhost:3000", mcp: over });

describe("mcpServersFor", () => {
  it("runner gets playwright only (never jira)", () => {
    expect(mcpServersFor("runner", cfg({ jira: { enabled: true } }))).toEqual(["playwright"]);
  });
  it("verification gets playwright + jira when both enabled", () => {
    expect(mcpServersFor("verification", cfg({ jira: { enabled: true } }))).toEqual(["playwright", "jira"]);
  });
  it("triage and implementation get chrome-devtools + jira", () => {
    expect(mcpServersFor("triage", cfg({ jira: { enabled: true } }))).toEqual(["chrome-devtools", "jira"]);
    expect(mcpServersFor("implementation", cfg({ jira: { enabled: true } }))).toEqual(["chrome-devtools", "jira"]);
  });
  it("omits a server when its config toggle is off", () => {
    expect(mcpServersFor("runner", cfg({ playwright: { enabled: false } }))).toEqual([]);
    expect(mcpServersFor("triage", cfg({ jira: { enabled: false } }))).toEqual(["chrome-devtools"]);
  });
  it("dreamer and generator get chrome-devtools; critic gets nothing; none get jira", () => {
    expect(mcpServersFor("dreamer", cfg({ jira: { enabled: true } }))).toEqual(["chrome-devtools"]);
    expect(mcpServersFor("generator", cfg({ jira: { enabled: true } }))).toEqual(["chrome-devtools"]);
    expect(mcpServersFor("critic", cfg({ jira: { enabled: true } }))).toEqual([]);
  });
  it("attaches no jira server under the defaults (Jira is opt-in)", () => {
    expect(mcpServersFor("triage", cfg())).toEqual(["chrome-devtools"]);
    expect(mcpServersFor("verification", cfg())).toEqual(["playwright"]);
    expect(mcpServersFor("implementation", cfg())).toEqual(["chrome-devtools"]);
  });
  it("graduation gets chrome-devtools and never jira", () => {
    expect(mcpServersFor("graduation", cfg({ jira: { enabled: true } }))).toEqual(["chrome-devtools"]);
  });
});

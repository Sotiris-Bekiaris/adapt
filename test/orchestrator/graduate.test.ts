import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { StateStore } from "../../src/orchestrator/store.ts";
import { AdaptConfigSchema } from "../../src/config/schema.ts";
import { graduateProven } from "../../src/orchestrator/graduate.ts";
import { parseScenario } from "../../src/scenarios/parse.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function ctx(over = {}) {
  dir = makeTmpDir();
  mkdirSync(join(dir, ".adapt", "scenarios"), { recursive: true });
  writeFileSync(join(dir, ".adapt", "scenarios", "SCN-001.md"), `---\nid: SCN-001\ntitle: Login\nstatus: regression\npriority: high\npersona: User\ntags: [auth]\nsource: agent-discovered\n---\n# Scenario\nLog in.\n`, "utf8");
  const store = new StateStore(":memory:");
  const config = AdaptConfigSchema.parse({ targetRepoPath: dir, appBaseUrl: "http://x", limits: { gradPassThreshold: 3, ...over } });
  return { dir: dir!, store, config };
}

function gradEngine(write = true) {
  return new StubEngine({ script: (s) => {
    if (write) {
      const p = s.prompt.match(/SPEC_FILE=(.+)/)![1]!.trim();
      writeFileSync(p, `import { test, expect } from "@playwright/test";\ntest("SCN-001", async ({ page }) => { await page.goto("/"); });\n`, "utf8");
    }
    return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
  }});
}

describe("graduateProven", () => {
  it("does nothing when no scenario has reached the pass threshold", async () => {
    const c = ctx();
    c.store.incrementScenarioPasses("SCN-001"); // 1 < 3
    const grad = await graduateProven({ engine: gradEngine(), store: c.store, config: c.config, targetRepo: c.dir, sink: () => {} });
    expect(grad).toEqual([]);
  });

  it("graduates a proven scenario: writes the spec, marks it graduated", async () => {
    const c = ctx();
    c.store.incrementScenarioPasses("SCN-001");
    c.store.incrementScenarioPasses("SCN-001");
    c.store.incrementScenarioPasses("SCN-001"); // 3 >= 3
    const grad = await graduateProven({ engine: gradEngine(), store: c.store, config: c.config, targetRepo: c.dir, sink: () => {} });
    expect(grad).toEqual(["SCN-001"]);
    expect(existsSync(join(c.dir, "tests", "adapt", "SCN-001.spec.ts"))).toBe(true);
    const meta = parseScenario(readFileSync(join(c.dir, ".adapt", "scenarios", "SCN-001.md"), "utf8"), "SCN-001.md").meta;
    expect(meta.status).toBe("graduated");
  });

  it("does not graduate (or mark) when the agent writes no spec", async () => {
    const c = ctx();
    for (let i = 0; i < 3; i++) c.store.incrementScenarioPasses("SCN-001");
    const grad = await graduateProven({ engine: gradEngine(false), store: c.store, config: c.config, targetRepo: c.dir, sink: () => {} });
    expect(grad).toEqual([]);
    const meta = parseScenario(readFileSync(join(c.dir, ".adapt", "scenarios", "SCN-001.md"), "utf8"), "SCN-001.md").meta;
    expect(meta.status).toBe("regression"); // unchanged
  });
});

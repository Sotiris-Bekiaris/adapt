import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { AdaptConfigSchema } from "../../src/config/schema.ts";
import { newDemand, type Demand } from "../../src/demand/demand.ts";
import { runGenerate, nextScenarioNumber } from "../../src/demand/generate.ts";
import { rebuildRegistry } from "../../src/scenarios/registry.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function ctx(over = {}) {
  dir = makeTmpDir();
  mkdirSync(join(dir, ".adapt", "scenarios"), { recursive: true });
  mkdirSync(join(dir, ".adapt", "demands"), { recursive: true });
  const config = AdaptConfigSchema.parse({ targetRepoPath: dir, appBaseUrl: "http://x", limits: { maxScenariosPerDemand: 2, ...over } });
  return { dir: dir!, config };
}

const approved = (id: string): Demand => ({ ...newDemand({ id, title: `${id} feature`, rationale: "r", proposedScenarios: ["do a thing"], createdAt: "t" }), status: "approved" });

function scenarioFile(id: string): string {
  return `---\nid: ${id}\ntitle: ${id} scenario\nstatus: ready\npriority: medium\npersona: User\ntags: [gen]\nsource: agent-discovered\n---\n# Scenario\nDo a thing and see the result.\n`;
}

function genEngine(count: number, opts: { malformed?: boolean } = {}) {
  return new StubEngine({ script: (s) => {
    const dirMatch = s.prompt.match(/directory:\s*(\S+)/)![1];
    const ids = [...s.prompt.matchAll(/SCN-\d+/g)].map((m) => m[0]);
    const unique = [...new Set(ids)];
    for (let i = 0; i < Math.min(count, unique.length); i++) {
      const id = unique[i]!;
      const content = opts.malformed ? "no frontmatter here" : scenarioFile(id);
      writeFileSync(join(dirMatch, `${id}.md`), content, "utf8");
    }
    return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
  }});
}

describe("nextScenarioNumber", () => {
  it("is 1 when there are no top-level scenarios", () => {
    const c = ctx();
    expect(nextScenarioNumber(c.dir)).toBe(1);
  });
  it("is max+1 of existing top-level scenario ids", () => {
    const c = ctx();
    writeFileSync(join(c.dir, ".adapt", "scenarios", "SCN-005.md"), scenarioFile("SCN-005"), "utf8");
    expect(nextScenarioNumber(c.dir)).toBe(6);
  });
});

describe("runGenerate", () => {
  it("creates validated scenario files for an approved demand and registers them", async () => {
    const c = ctx();
    const created = await runGenerate({ engine: genEngine(2), config: c.config, targetRepo: c.dir, sink: () => {} }, [approved("DMD-001")]);
    expect(created.map((s) => s.id)).toEqual(["SCN-001", "SCN-002"]);
    expect(existsSync(join(c.dir, ".adapt", "scenarios", "SCN-001.md"))).toBe(true);
    expect(rebuildRegistry(c.dir).map((e) => e.id)).toEqual(["SCN-001", "SCN-002"]);
  });

  it("caps scenarios per demand at maxScenariosPerDemand", async () => {
    const c = ctx({ maxScenariosPerDemand: 1 });
    const created = await runGenerate({ engine: genEngine(5), config: c.config, targetRepo: c.dir, sink: () => {} }, [approved("DMD-001")]);
    expect(created.length).toBe(1);
  });

  it("deletes a malformed generated file and does not register it (registry stays valid)", async () => {
    const c = ctx();
    const created = await runGenerate({ engine: genEngine(1, { malformed: true }), config: c.config, targetRepo: c.dir, sink: () => {} }, [approved("DMD-001")]);
    expect(created.length).toBe(0);
    expect(existsSync(join(c.dir, ".adapt", "scenarios", "SCN-001.md"))).toBe(false);
    expect(() => rebuildRegistry(c.dir)).not.toThrow();
  });

  it("gives each demand a distinct ID block (no collisions)", async () => {
    const c = ctx();
    const created = await runGenerate({ engine: genEngine(2), config: c.config, targetRepo: c.dir, sink: () => {} }, [approved("DMD-001"), approved("DMD-002")]);
    const ids = created.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("SCN-001");
    expect(ids).toContain("SCN-003");
  });
});

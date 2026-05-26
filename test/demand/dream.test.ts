import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { AdaptConfigSchema } from "../../src/config/schema.ts";
import { runDream } from "../../src/demand/dream.ts";
import { LocalDemandStore } from "../../src/demand/demandStore.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function ctx(over = {}) {
  dir = makeTmpDir();
  mkdirSync(join(dir, ".adapt", "scenarios"), { recursive: true });
  mkdirSync(join(dir, ".adapt", "demands"), { recursive: true });
  writeFileSync(join(dir, ".adapt", "north-star.md"), "# North Star\nBe great.\n", "utf8");
  const config = AdaptConfigSchema.parse({ targetRepoPath: dir, appBaseUrl: "http://x", limits: { maxDemandsPerCycle: 2, ...over } });
  return { dir: dir!, config };
}

function dreamEngine(ambition: string | null, n: number) {
  return new StubEngine({ script: (s) => {
    const path = s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim();
    const demands = Array.from({ length: n }, (_, i) => ({ title: `Demand ${i + 1}`, rationale: "r", proposedScenarios: ["do a thing"] }));
    writeFileSync(path, JSON.stringify({ ambition, demands }), "utf8");
    return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
  }});
}

describe("runDream", () => {
  it("persists demands and appends the ambition to north-star", async () => {
    const c = ctx();
    const res = await runDream({ engine: dreamEngine("Reach higher", 2), config: c.config, targetRepo: c.dir, sink: () => {}, now: () => "2026-05-26T10:00:00.000Z" });
    expect(res.ambitionAppended).toBe(true);
    expect(res.demands.length).toBe(2);
    expect(new LocalDemandStore(c.dir).list().length).toBe(2);
    expect(readFileSync(join(c.dir, ".adapt", "north-star.md"), "utf8")).toContain("Reach higher");
  });

  it("caps demands at maxDemandsPerCycle", async () => {
    const c = ctx({ maxDemandsPerCycle: 1 });
    const res = await runDream({ engine: dreamEngine(null, 5), config: c.config, targetRepo: c.dir, sink: () => {}, now: () => "t" });
    expect(res.demands.length).toBe(1);
    expect(res.ambitionAppended).toBe(false);
  });

  it("returns empty + appends nothing when the dreamer writes no result", async () => {
    const c = ctx();
    const noop = new StubEngine({ script: (s) => [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }] });
    const res = await runDream({ engine: noop, config: c.config, targetRepo: c.dir, sink: () => {}, now: () => "t" });
    expect(res.demands).toEqual([]);
    expect(res.ambitionAppended).toBe(false);
  });
});

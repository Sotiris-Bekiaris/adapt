import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { AdaptConfigSchema } from "../../src/config/schema.ts";
import { runDemandStage } from "../../src/demand/demandStage.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function ctx() {
  dir = makeTmpDir();
  mkdirSync(join(dir, ".adapt", "scenarios"), { recursive: true });
  mkdirSync(join(dir, ".adapt", "demands"), { recursive: true });
  writeFileSync(join(dir, ".adapt", "north-star.md"), "# North Star\nBe great.\n", "utf8");
  const config = AdaptConfigSchema.parse({ targetRepoPath: dir, appBaseUrl: "http://x", limits: { maxDemandsPerCycle: 2, maxScenariosPerDemand: 1 } });
  return { dir: dir!, config };
}

function demandEngine() {
  return new StubEngine({ script: (s) => {
    const path = (s.prompt.match(/RESULT_FILE=(.+)/) || [])[1]?.trim();
    if (s.role === "dreamer") {
      writeFileSync(path!, JSON.stringify({ ambition: "Reach higher", demands: [
        { title: "Good feature", rationale: "r", proposedScenarios: ["do x"] },
        { title: "Bloat feature", rationale: "r", proposedScenarios: ["do y"] },
      ] }), "utf8");
    } else if (s.role === "critic") {
      const approve = s.prompt.includes("DMD-001");
      writeFileSync(path!, JSON.stringify({ decision: approve ? "approved" : "rejected", critique: "c" }), "utf8");
    } else if (s.role === "generator") {
      const genDir = s.prompt.match(/directory:\s*(\S+)/)![1]!;
      const id = s.prompt.match(/SCN-\d+/)![0];
      writeFileSync(join(genDir, `${id}.md`), `---\nid: ${id}\ntitle: ${id}\nstatus: ready\npriority: medium\npersona: User\ntags: [gen]\nsource: agent-discovered\n---\n# Scenario\nDo a thing.\n`, "utf8");
    }
    return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
  }});
}

describe("runDemandStage", () => {
  it("dreams, critiques, and generates scenarios for approved demands only", async () => {
    const c = ctx();
    const sum = await runDemandStage({ engine: demandEngine(), config: c.config, targetRepo: c.dir, sink: () => {}, now: () => "2026-05-26T10:00:00.000Z" });
    expect(sum.ambitionAppended).toBe(true);
    expect(sum.demands.length).toBe(2);
    expect(sum.approved.map((d) => d.id)).toEqual(["DMD-001"]);
    expect(sum.scenariosCreated.length).toBe(1);
    expect(readFileSync(join(c.dir, ".adapt", "north-star.md"), "utf8")).toContain("Reach higher");
  });
});

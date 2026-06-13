import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import { AdaptConfigSchema } from "../../src/config/schema.ts";
import { LocalDemandStore } from "../../src/demand/demandStore.ts";
import { newDemand } from "../../src/demand/demand.ts";
import { runCritique } from "../../src/demand/critique.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function ctx() {
  dir = makeTmpDir();
  mkdirSync(join(dir, ".adapt", "demands"), { recursive: true });
  mkdirSync(join(dir, ".adapt", "scenarios"), { recursive: true });
  writeFileSync(join(dir, ".adapt", "north-star.md"), "# North Star\nBe great.\n", "utf8");
  const config = AdaptConfigSchema.parse({ targetRepoPath: dir, appBaseUrl: "http://x" });
  const store = new LocalDemandStore(dir);
  return { dir: dir!, config, store };
}

function seedScenario(dir: string) {
  writeFileSync(join(dir, ".adapt", "scenarios", "SCN-001.md"), `---
id: SCN-001
title: Export contacts as CSV
status: ready
priority: medium
persona: User
tags: [export]
source: human-seeded
---
Export and verify the file.
`, "utf8");
}

// Approves DMD-001, rejects DMD-002, marks DMD-003 duplicate of SCN-001.
function criticEngine() {
  return new StubEngine({ script: (s) => {
    const path = s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim();
    let verdict: Record<string, unknown>;
    if (s.prompt.includes("PROPOSED DEMAND DMD-001")) verdict = { decision: "approved", critique: "good", duplicateOf: null };
    else if (s.prompt.includes("PROPOSED DEMAND DMD-003")) verdict = { decision: "duplicate", critique: "already have it", duplicateOf: "SCN-001" };
    else verdict = { decision: "rejected", critique: "bloat", duplicateOf: null };
    writeFileSync(path, JSON.stringify(verdict), "utf8");
    return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
  }});
}

describe("runCritique", () => {
  it("approves, rejects, and marks duplicates; only approved are returned", async () => {
    const c = ctx();
    seedScenario(c.dir);
    c.store.create(newDemand({ id: "DMD-001", title: "good", rationale: "r", proposedScenarios: [], createdAt: "t" }));
    c.store.create(newDemand({ id: "DMD-002", title: "bloat", rationale: "r", proposedScenarios: [], createdAt: "t" }));
    c.store.create(newDemand({ id: "DMD-003", title: "export contacts to a CSV file", rationale: "r", proposedScenarios: [], createdAt: "t" }));

    const approved = await runCritique({ engine: criticEngine(), config: c.config, targetRepo: c.dir, sink: () => {} });

    expect(approved.map((d) => d.id)).toEqual(["DMD-001"]);
    expect(c.store.listByStatus("rejected").map((d) => d.id)).toEqual(["DMD-002"]);
    const dup = c.store.list().find((d) => d.id === "DMD-003")!;
    expect(dup.status).toBe("duplicate");
    expect(dup.duplicateOf).toBe("SCN-001");
  });

  it("feeds the existing scenario corpus into the critic prompt", async () => {
    const c = ctx();
    seedScenario(c.dir);
    c.store.create(newDemand({ id: "DMD-001", title: "good", rationale: "r", proposedScenarios: [], createdAt: "t" }));
    let seenPrompt = "";
    const engine = new StubEngine({ script: (s) => {
      seenPrompt = s.prompt;
      const path = s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim();
      writeFileSync(path, JSON.stringify({ decision: "approved", critique: "", duplicateOf: null }), "utf8");
      return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
    }});
    await runCritique({ engine, config: c.config, targetRepo: c.dir, sink: () => {} });
    expect(seenPrompt).toContain("SCN-001");
    expect(seenPrompt).toContain("Export contacts as CSV");
  });
});

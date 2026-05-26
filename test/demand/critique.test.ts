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
  writeFileSync(join(dir, ".adapt", "north-star.md"), "# North Star\nBe great.\n", "utf8");
  const config = AdaptConfigSchema.parse({ targetRepoPath: dir, appBaseUrl: "http://x" });
  const store = new LocalDemandStore(dir);
  return { dir: dir!, config, store };
}

function criticEngine() {
  return new StubEngine({ script: (s) => {
    const path = s.prompt.match(/RESULT_FILE=(.+)/)![1]!.trim();
    const approve = s.prompt.includes("DMD-001");
    writeFileSync(path, JSON.stringify({ decision: approve ? "approved" : "rejected", critique: "because" }), "utf8");
    return [{ kind: "agent.exit", role: s.role, at: "t", exitCode: 0 }];
  }});
}

describe("runCritique", () => {
  it("approves/rejects each proposed demand and returns the approved ones", async () => {
    const c = ctx();
    c.store.create(newDemand({ id: "DMD-001", title: "good", rationale: "r", proposedScenarios: [], createdAt: "t" }));
    c.store.create(newDemand({ id: "DMD-002", title: "bloat", rationale: "r", proposedScenarios: [], createdAt: "t" }));
    const approved = await runCritique({ engine: criticEngine(), config: c.config, targetRepo: c.dir, sink: () => {} });
    expect(approved.map((d) => d.id)).toEqual(["DMD-001"]);
    expect(c.store.listByStatus("approved").map((d) => d.id)).toEqual(["DMD-001"]);
    expect(c.store.listByStatus("rejected").map((d) => d.id)).toEqual(["DMD-002"]);
    expect(c.store.list().find((d) => d.id === "DMD-001")!.critique).toBe("because");
  });

  it("only critiques proposed demands (skips already-decided)", async () => {
    const c = ctx();
    c.store.create({ ...newDemand({ id: "DMD-001", title: "done", rationale: "r", proposedScenarios: [], createdAt: "t" }), status: "approved" });
    const approved = await runCritique({ engine: criticEngine(), config: c.config, targetRepo: c.dir, sink: () => {} });
    expect(approved).toEqual([]); // nothing in "proposed"
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { rebuildRegistry, readRegistry } from "../../src/scenarios/registry.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function writeScenario(repo: string, name: string, id: string) {
  const scn = join(repo, ".adapt", "scenarios");
  mkdirSync(scn, { recursive: true });
  writeFileSync(join(scn, name), `---
id: ${id}
title: ${id} title
status: ready
priority: medium
persona: User
tags: [smoke]
source: human-seeded
---
body`, "utf8");
}

describe("scenario registry", () => {
  it("rebuilds index.json from scenario files, sorted by id", () => {
    dir = makeTmpDir();
    writeScenario(dir, "b.md", "SCN-002");
    writeScenario(dir, "a.md", "SCN-001");
    const entries = rebuildRegistry(dir);
    expect(entries.map((e) => e.id)).toEqual(["SCN-001", "SCN-002"]);
    expect(entries[0]!.filename).toBe("a.md");
    expect(existsSync(join(dir, ".adapt", "scenarios", "index.json"))).toBe(true);
  });

  it("readRegistry returns [] when index.json is absent", () => {
    dir = makeTmpDir();
    expect(readRegistry(dir)).toEqual([]);
  });

  it("throws on a duplicate scenario id", () => {
    dir = makeTmpDir();
    writeScenario(dir, "a.md", "SCN-001");
    writeScenario(dir, "b.md", "SCN-001");
    expect(() => rebuildRegistry(dir!)).toThrow(/duplicate/i);
  });
});

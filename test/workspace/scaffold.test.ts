import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { scaffoldWorkspace } from "../../src/workspace/scaffold.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

describe("scaffoldWorkspace", () => {
  it("creates the .adapt tree, config.example.json, north-star, and an example scenario", () => {
    dir = makeTmpDir();
    const r = scaffoldWorkspace(dir, "http://localhost:3000");
    expect(existsSync(join(dir, ".adapt", "config.example.json"))).toBe(true);
    expect(existsSync(join(dir, ".adapt", "north-star.md"))).toBe(true);
    expect(existsSync(join(dir, ".adapt", "scenario-runs"))).toBe(true);
    expect(existsSync(join(dir, ".adapt", "scenarios", "examples", "example.login.md"))).toBe(true);
    expect(r.created.length).toBeGreaterThan(0);
  });

  it("does not overwrite an existing north-star.md", () => {
    dir = makeTmpDir();
    mkdirSync(join(dir, ".adapt"), { recursive: true });
    writeFileSync(join(dir, ".adapt", "north-star.md"), "MY VISION", "utf8");
    scaffoldWorkspace(dir, "http://localhost:3000");
    expect(readFileSync(join(dir, ".adapt", "north-star.md"), "utf8")).toBe("MY VISION");
  });

  it("the scaffolded example scenario parses successfully", async () => {
    dir = makeTmpDir();
    scaffoldWorkspace(dir, "http://localhost:3000");
    const { parseScenario } = await import("../../src/scenarios/parse.ts");
    const p = join(dir, ".adapt", "scenarios", "examples", "example.login.md");
    expect(() => parseScenario(readFileSync(p, "utf8"), "example.login.md")).not.toThrow();
  });
});

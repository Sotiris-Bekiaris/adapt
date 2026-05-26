import { describe, it, expect, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { commitWorkspace } from "../../src/orchestrator/git.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

describe("commitWorkspace", () => {
  it("returns false (no throw) when the target is not a git repo", () => {
    dir = makeTmpDir();
    mkdirSync(join(dir, ".adapt"), { recursive: true });
    writeFileSync(join(dir, ".adapt", "north-star.md"), "x", "utf8");
    expect(commitWorkspace(dir, "msg")).toBe(false);
  });

  it("commits .adapt changes in a real git repo", () => {
    dir = makeTmpDir();
    spawnSync("git", ["-C", dir, "init"], { encoding: "utf8" });
    spawnSync("git", ["-C", dir, "config", "user.email", "t@t.t"], { encoding: "utf8" });
    spawnSync("git", ["-C", dir, "config", "user.name", "t"], { encoding: "utf8" });
    mkdirSync(join(dir, ".adapt"), { recursive: true });
    writeFileSync(join(dir, ".adapt", "north-star.md"), "x", "utf8");
    expect(commitWorkspace(dir, "adapt: evolve")).toBe(true);
    const log = spawnSync("git", ["-C", dir, "log", "--oneline"], { encoding: "utf8" });
    expect(log.stdout).toContain("adapt: evolve");
  });
});

import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { appendAmbition } from "../../src/demand/northStar.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

describe("appendAmbition", () => {
  it("appends an ambition section, preserving prior content", () => {
    dir = makeTmpDir();
    mkdirSync(join(dir, ".adapt"), { recursive: true });
    writeFileSync(join(dir, ".adapt", "north-star.md"), "# North Star\n\nMy vision.\n", "utf8");
    appendAmbition(dir, "Add real-time collaboration", () => "2026-05-26T10:00:00.000Z");
    appendAmbition(dir, "Add an analytics dashboard", () => "2026-05-26T11:00:00.000Z");
    const text = readFileSync(join(dir, ".adapt", "north-star.md"), "utf8");
    expect(text).toContain("My vision.");
    expect(text).toContain("## Ambition 2026-05-26T10:00:00.000Z");
    expect(text).toContain("Add real-time collaboration");
    expect(text).toContain("Add an analytics dashboard");
    expect(text.indexOf("real-time")).toBeLessThan(text.indexOf("analytics"));
  });

  it("creates the file with a heading if it does not exist", () => {
    dir = makeTmpDir();
    mkdirSync(join(dir, ".adapt"), { recursive: true });
    appendAmbition(dir, "First ambition", () => "t");
    const text = readFileSync(join(dir, ".adapt", "north-star.md"), "utf8");
    expect(text).toContain("# North Star");
    expect(text).toContain("First ambition");
  });
});

import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { runInit } from "../../src/cli/commands/init.ts";
import { StubEngine } from "../../src/engine/stubEngine.ts";
import type { AgentSpec, AgentEvent } from "../../src/engine/types.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

describe("runInit", () => {
  it("scaffolds the workspace and writes a fallback north-star when the Scout cannot produce one", async () => {
    dir = makeTmpDir();
    // StubEngine echoes the prompt but doesn't write files, so fallback kicks in
    const engine = new StubEngine();
    const log = vi.fn();
    const code = await runInit({ targetRepo: dir, appBaseUrl: "http://localhost:3000", engine }, log);
    expect(code).toBe(0);
    expect(existsSync(join(dir, ".adapt", "config.example.json"))).toBe(true);
    const ns = join(dir, ".adapt", "north-star.md");
    expect(existsSync(ns)).toBe(true);
    expect(readFileSync(ns, "utf8")).toContain("# North Star");
    expect(readFileSync(ns, "utf8")).toContain("Scout agent could not inspect this repo");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("adapt workspace ready"));
  });

  it("writes the fallback north-star even when the engine rejects", async () => {
    dir = makeTmpDir();
    const engine = new StubEngine({
      script: (_spec: AgentSpec): AgentEvent[] => {
        throw new Error("simulated engine crash");
      },
    });
    const log = vi.fn();
    const code = await runInit({ targetRepo: dir, appBaseUrl: "http://localhost:3000", engine }, log);
    expect(code).toBe(0);
    const ns = join(dir, ".adapt", "north-star.md");
    expect(existsSync(ns)).toBe(true);
    expect(readFileSync(ns, "utf8")).toContain("Scout agent could not inspect this repo");
  });

  it("returns a non-zero code for a non-existent target repo", async () => {
    const log = vi.fn();
    const code = await runInit({ targetRepo: "/no/such/dir/here", appBaseUrl: "http://localhost:3000" }, log);
    expect(code).toBe(1);
  });
});

import { describe, it, expect, afterEach, vi } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { runInit } from "../../src/cli/commands/init.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

describe("runInit", () => {
  it("scaffolds the workspace and reports created paths", () => {
    dir = makeTmpDir();
    const log = vi.fn();
    const code = runInit({ targetRepo: dir, appBaseUrl: "http://localhost:3000" }, log);
    expect(code).toBe(0);
    expect(existsSync(join(dir, ".adapt", "config.example.json"))).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("adapt workspace ready"));
  });

  it("returns a non-zero code for a non-existent target repo", () => {
    const log = vi.fn();
    const code = runInit({ targetRepo: "/no/such/dir/here", appBaseUrl: "http://localhost:3000" }, log);
    expect(code).toBe(1);
  });
});

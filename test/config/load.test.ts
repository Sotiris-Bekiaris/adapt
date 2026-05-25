import { describe, it, expect, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { makeTmpDir, cleanupTmp } from "../helpers/tmp.ts";
import { loadConfig, ConfigError } from "../../src/config/load.ts";

let dir: string | undefined;
afterEach(() => { if (dir) cleanupTmp(dir); dir = undefined; });

function writeConfig(repo: string, json: unknown) {
  mkdirSync(join(repo, ".adapt"), { recursive: true });
  writeFileSync(join(repo, ".adapt", "config.json"), JSON.stringify(json), "utf8");
}

describe("loadConfig", () => {
  it("loads and validates a config file", () => {
    dir = makeTmpDir();
    writeConfig(dir, { targetRepoPath: dir, appBaseUrl: "http://localhost:3000" });
    const cfg = loadConfig(dir);
    expect(cfg.appBaseUrl).toBe("http://localhost:3000");
    expect(cfg.limits.maxFixAttempts).toBe(2);
  });

  it("throws ConfigError when the file is missing", () => {
    dir = makeTmpDir();
    expect(() => loadConfig(dir!)).toThrow(ConfigError);
    expect(() => loadConfig(dir!)).toThrow(/not found/i);
  });

  it("throws ConfigError with field detail on invalid config", () => {
    dir = makeTmpDir();
    writeConfig(dir, { appBaseUrl: "nope" });
    expect(() => loadConfig(dir!)).toThrow(ConfigError);
  });
});

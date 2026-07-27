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

  it("defaults to the local tracker: jira off, no project key needed", () => {
    dir = makeTmpDir();
    writeConfig(dir, { targetRepoPath: dir, appBaseUrl: "http://localhost:3000" });
    const cfg = loadConfig(dir);
    expect(cfg.mcp.jira.enabled).toBe(false);
    expect(cfg.jira.projectKey).toBe("");
  });

  it("rejects the jira MCP server enabled with an empty projectKey", () => {
    dir = makeTmpDir();
    writeConfig(dir, { targetRepoPath: dir, appBaseUrl: "http://x", mcp: { jira: { enabled: true } } });
    expect(() => loadConfig(dir!)).toThrow(ConfigError);
    expect(() => loadConfig(dir!)).toThrow(/projectKey/);
  });

  it("accepts Jira once mcp.jira.enabled and a projectKey are both set", () => {
    dir = makeTmpDir();
    writeConfig(dir, {
      targetRepoPath: dir, appBaseUrl: "http://x",
      jira: { projectKey: "ADAPT" }, mcp: { jira: { enabled: true } },
    });
    expect(loadConfig(dir).jira.projectKey).toBe("ADAPT");
  });

  it("ignores retired Jira keys in an older config instead of failing on them", () => {
    dir = makeTmpDir();
    // jira.enabled/baseUrl/defaultIssueType/transitions were removed once it was clear nothing read
    // them. A config written before that must still load — and must not read as "Jira is on".
    writeConfig(dir, {
      targetRepoPath: dir, appBaseUrl: "http://x",
      jira: {
        enabled: true, baseUrl: "http://localhost:8080", projectKey: "OLD",
        defaultIssueType: "Bug", transitions: { done: "Done" },
      },
    });
    const cfg = loadConfig(dir);
    expect(cfg.mcp.jira.enabled).toBe(false);
    expect(cfg.jira).toEqual({ projectKey: "OLD" });
  });
});

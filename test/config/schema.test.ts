import { describe, it, expect } from "vitest";
import { AdaptConfigSchema, defaultConfig } from "../../src/config/schema.ts";

describe("AdaptConfigSchema", () => {
  it("accepts a minimal valid config and applies defaults", () => {
    const parsed = AdaptConfigSchema.parse({
      targetRepoPath: "/repo",
      appBaseUrl: "http://localhost:3000",
    });
    expect(parsed.engine.type).toBe("claude-code");
    expect(parsed.console.port).toBe(4399);
    expect(parsed.limits.maxFixAttempts).toBe(2);
    expect(parsed.jira.enabled).toBe(false);
    expect(parsed.mcp.playwright.enabled).toBe(true);
  });

  it("rejects a non-url appBaseUrl", () => {
    const r = AdaptConfigSchema.safeParse({ targetRepoPath: "/repo", appBaseUrl: "not-a-url" });
    expect(r.success).toBe(false);
  });

  it("rejects missing targetRepoPath", () => {
    const r = AdaptConfigSchema.safeParse({ appBaseUrl: "http://localhost:3000" });
    expect(r.success).toBe(false);
  });

  it("defaults the demand caps", () => {
    const parsed = AdaptConfigSchema.parse({ targetRepoPath: "/repo", appBaseUrl: "http://localhost:3000" });
    expect(parsed.limits.maxDemandsPerCycle).toBe(3);
    expect(parsed.limits.maxScenariosPerDemand).toBe(2);
  });

  it("defaults the graduation knobs", () => {
    const c = AdaptConfigSchema.parse({ targetRepoPath: "/repo", appBaseUrl: "http://localhost:3000" });
    expect(c.limits.gradPassThreshold).toBe(3);
    expect(c.playwrightTestDir).toBe("tests/adapt");
  });

  it("defaultConfig() produces a parseable example", () => {
    const r = AdaptConfigSchema.safeParse(defaultConfig("/repo", "http://localhost:3000"));
    expect(r.success).toBe(true);
  });
});

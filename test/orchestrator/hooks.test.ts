import { describe, it, expect } from "vitest";
import { runHook } from "../../src/orchestrator/hooks.ts";

describe("runHook", () => {
  it("treats an undefined command as a no-op success", () => {
    const r = runHook(undefined, process.cwd());
    expect(r.ran).toBe(false);
    expect(r.ok).toBe(true);
  });
  it("runs a shell command and captures output", () => {
    const r = runHook("echo seeded", process.cwd());
    expect(r.ran).toBe(true);
    expect(r.ok).toBe(true);
    expect(r.output).toContain("seeded");
  });
  it("reports a nonzero exit as not-ok with the code", () => {
    const r = runHook("exit 3", process.cwd());
    expect(r.ok).toBe(false);
    expect(r.code).toBe(3);
  });
});

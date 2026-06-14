import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readControl, writeControl, clearStop, normalizeMaxCycles } from "../../src/lanes/control.ts";

function wt(): string {
  const d = mkdtempSync(join(tmpdir(), "control-"));
  mkdirSync(join(d, ".adapt"), { recursive: true });
  return d;
}

describe("lane control file", () => {
  it("returns defaults when the file is missing", () => {
    const d = wt();
    expect(readControl(d)).toEqual({ paused: false, maxCycles: undefined, stopRequested: false });
    rmSync(d, { recursive: true, force: true });
  });

  it("returns defaults when the file is malformed", () => {
    const d = wt();
    writeFileSync(join(d, ".adapt", "control.json"), "{ not json", "utf8");
    expect(readControl(d)).toEqual({ paused: false, maxCycles: undefined, stopRequested: false });
    rmSync(d, { recursive: true, force: true });
  });

  it("write merges a patch and read reflects it", () => {
    const d = wt();
    writeControl(d, { paused: true });
    expect(readControl(d).paused).toBe(true);
    writeControl(d, { maxCycles: 5 });
    const c = readControl(d);
    expect(c.paused).toBe(true);
    expect(c.maxCycles).toBe(5);
    rmSync(d, { recursive: true, force: true });
  });

  it("distinguishes explicit null (infinite) from unset", () => {
    const d = wt();
    writeControl(d, { maxCycles: null });
    expect(readControl(d).maxCycles).toBeNull();
    rmSync(d, { recursive: true, force: true });
  });

  it("clearStop resets only stopRequested", () => {
    const d = wt();
    writeControl(d, { paused: true, stopRequested: true });
    clearStop(d);
    const c = readControl(d);
    expect(c.stopRequested).toBe(false);
    expect(c.paused).toBe(true);
    rmSync(d, { recursive: true, force: true });
  });

  it("writes atomically (no leftover temp file)", () => {
    const d = wt();
    writeControl(d, { paused: true });
    const raw = readFileSync(join(d, ".adapt", "control.json"), "utf8");
    expect(JSON.parse(raw).paused).toBe(true);
    rmSync(d, { recursive: true, force: true });
  });

  it("normalizeMaxCycles maps blank/0/negative to null", () => {
    expect(normalizeMaxCycles(0)).toBeNull();
    expect(normalizeMaxCycles(-3)).toBeNull();
    expect(normalizeMaxCycles(NaN)).toBeNull();
    expect(normalizeMaxCycles(null)).toBeNull();
    expect(normalizeMaxCycles(undefined)).toBeNull();
    expect(normalizeMaxCycles(7)).toBe(7);
  });
});

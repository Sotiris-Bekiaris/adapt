import { describe, it, expect } from "vitest";
import { runContinuous } from "../../src/orchestrator/run.ts";
import type { LaneControl } from "../../src/lanes/control.ts";
import type { AdaptConfig } from "../../src/config/schema.ts";

function cfg(over: Partial<AdaptConfig["run"]> = {}): AdaptConfig {
  return {
    run: { maxCycles: null, maxWallClockSeconds: null, pauseSeconds: 0, maxConsecutiveErrors: 3, ...over },
  } as unknown as AdaptConfig;
}

function baseDeps(control: LaneControl, extra: Record<string, unknown> = {}) {
  return {
    engine: {} as never,
    store: {} as never,
    config: cfg(),
    targetRepo: "/tmp/x",
    sink: () => {},
    emit: () => {},
    readControl: () => control,
    sleep: async () => {},
    clockMs: () => 0,
    ...extra,
  };
}

describe("runContinuous control handling", () => {
  it("stops with reason 'control' when stopRequested is set before any cycle", async () => {
    const control: LaneControl = { paused: false, maxCycles: undefined, stopRequested: true };
    const summary = await runContinuous(baseDeps(control) as never);
    expect(summary.stoppedBy).toBe("control");
    expect(summary.cycles).toBe(0);
  });

  it("config maxCycles=0 bounds the loop immediately", async () => {
    const control: LaneControl = { paused: false, maxCycles: undefined, stopRequested: false };
    const deps = baseDeps(control, { config: cfg({ maxCycles: 0 }) });
    const summary = await runContinuous(deps as never);
    expect(summary.stoppedBy).toBe("maxCycles");
    expect(summary.cycles).toBe(0);
  });

  it("a paused loop holds then stops when stopRequested flips true", async () => {
    let reads = 0;
    const deps = baseDeps({ paused: true, maxCycles: undefined, stopRequested: false }, {
      readControl: () => {
        reads++;
        return { paused: true, maxCycles: undefined, stopRequested: reads >= 3 };
      },
    });
    const events: string[] = [];
    (deps as { emit: (e: { type: string }) => void }).emit = (e) => events.push(e.type);
    const summary = await runContinuous(deps as never);
    expect(summary.stoppedBy).toBe("control");
    expect(events).toContain("cycle.paused");
  });
});

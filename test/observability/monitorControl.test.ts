import { describe, it, expect } from "vitest";
import { applyControl } from "../../src/observability/monitor.ts";

function makeCalls() {
  const calls: string[] = [];
  return {
    calls,
    deps: {
      lanesRoot: "/lanes",
      laneIds: () => ["a", "b"],
      start: (wt: string) => calls.push(`start:${wt}`),
      stop: (wt: string) => calls.push(`stop:${wt}`),
      pause: (wt: string, p: boolean) => calls.push(`pause:${wt}:${p}`),
      setMaxCycles: (wt: string, m: number | null) => calls.push(`max:${wt}:${m}`),
    },
  };
}

describe("applyControl", () => {
  it("pause writes paused=true to the lane worktree", async () => {
    const { calls, deps } = makeCalls();
    await applyControl({ lane: "a", action: "pause" }, deps);
    expect(calls).toEqual(["pause:/lanes/a:true"]);
  });

  it("continue writes paused=false", async () => {
    const { calls, deps } = makeCalls();
    await applyControl({ lane: "a", action: "continue" }, deps);
    expect(calls).toEqual(["pause:/lanes/a:false"]);
  });

  it("start with maxCycles sets the limit then starts", async () => {
    const { calls, deps } = makeCalls();
    await applyControl({ lane: "a", action: "start", maxCycles: 5 }, deps);
    expect(calls).toEqual(["max:/lanes/a:5", "start:/lanes/a"]);
  });

  it("'*' fans an action out to every lane", async () => {
    const { calls, deps } = makeCalls();
    await applyControl({ lane: "*", action: "stop" }, deps);
    expect(calls).toEqual(["stop:/lanes/a", "stop:/lanes/b"]);
  });

  it("restart sets maxCycles, stops, waits, then starts in order", async () => {
    const calls: string[] = [];
    await applyControl({ lane: "a", action: "restart", maxCycles: 3 }, {
      lanesRoot: "/lanes",
      laneIds: () => ["a"],
      start: (wt: string) => calls.push(`start:${wt}`),
      stop: (wt: string) => calls.push(`stop:${wt}`),
      pause: () => {},
      setMaxCycles: (wt: string, m: number | null) => calls.push(`max:${wt}:${m}`),
      waitStopped: async (wt: string) => { calls.push(`wait:${wt}`); },
    });
    expect(calls).toEqual(["max:/lanes/a:3", "stop:/lanes/a", "wait:/lanes/a", "start:/lanes/a"]);
  });
});

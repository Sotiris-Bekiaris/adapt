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
  it("pause writes paused=true to the lane worktree", () => {
    const { calls, deps } = makeCalls();
    applyControl({ lane: "a", action: "pause" }, deps);
    expect(calls).toEqual(["pause:/lanes/a:true"]);
  });

  it("continue writes paused=false", () => {
    const { calls, deps } = makeCalls();
    applyControl({ lane: "a", action: "continue" }, deps);
    expect(calls).toEqual(["pause:/lanes/a:false"]);
  });

  it("start with maxCycles sets the limit then starts", () => {
    const { calls, deps } = makeCalls();
    applyControl({ lane: "a", action: "start", maxCycles: 5 }, deps);
    expect(calls).toEqual(["max:/lanes/a:5", "start:/lanes/a"]);
  });

  it("'*' fans an action out to every lane", () => {
    const { calls, deps } = makeCalls();
    applyControl({ lane: "*", action: "stop" }, deps);
    expect(calls).toEqual(["stop:/lanes/a", "stop:/lanes/b"]);
  });
});

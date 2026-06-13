import { describe, it, expect } from "vitest";
import { buildCycles } from "../../src/observability/public/cycles.js";

// Minimal ConsoleEvent factories.
const cycleStart = (n: number, at = "2026-06-13T10:00:0" + n + ".000Z") =>
  ({ channel: "orchestrator", role: "orchestrator", kind: "cycle.start", at, data: { cycle: n } });
const cycleDone = (n: number) =>
  ({ channel: "orchestrator", role: "orchestrator", kind: "cycle.completed", at: "t", data: { cycle: n } });
const cycleErr = (n: number) =>
  ({ channel: "orchestrator", role: "orchestrator", kind: "cycle.error", at: "t", data: { cycle: n, message: "boom" } });
const aStart = (role: string, prompt: string) =>
  ({ channel: "agent", role, kind: "agent.start", at: "t", data: { prompt } });
const aText = (role: string, text: string) =>
  ({ channel: "agent", role, kind: "agent.text", at: "t", text });
const aErr = (role: string) =>
  ({ channel: "agent", role, kind: "agent.error", at: "t", text: "err" });
const aExit = (role: string) =>
  ({ channel: "agent", role, kind: "agent.exit", at: "t", exitCode: 0 });
const orchNoise = (kind: string) =>
  ({ channel: "orchestrator", role: "orchestrator", kind, at: "t", data: {} });

describe("buildCycles", () => {
  it("groups a multi-agent cycle into ordered steps", () => {
    const cycles = buildCycles([
      cycleStart(1),
      aStart("dreamer", "dream"), aText("dreamer", "idea: cache"), aExit("dreamer"),
      aStart("generator", "gen"), aText("generator", "patch +42 -3"), aExit("generator"),
      cycleDone(1),
    ]);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].cycle).toBe(1);
    expect(cycles[0].status).toBe("done");
    expect(cycles[0].steps.map((s) => s.role)).toEqual(["dreamer", "generator"]);
    expect(cycles[0].steps.map((s) => s.index)).toEqual([1, 2]);
  });

  it("captures input prompt, output, and summary per step", () => {
    const [c] = buildCycles([
      cycleStart(1),
      aStart("critic", "review this patch"),
      aText("critic", "looks risky"),
      aText("critic", "REJECT: no tests"),
      aExit("critic"),
      cycleDone(1),
    ]);
    const step = c.steps[0];
    expect(step.input).toBe("review this patch");
    expect(step.output).toBe("looks riskyREJECT: no tests");
    expect(step.summary).toBe("REJECT: no tests");
  });

  it("treats a repeated role as separate numbered steps", () => {
    const [c] = buildCycles([
      cycleStart(1),
      aStart("critic", "p1"), aExit("critic"),
      aStart("critic", "p2"), aExit("critic"),
      cycleDone(1),
    ]);
    expect(c.steps).toHaveLength(2);
    expect(c.steps.map((s) => s.index)).toEqual([1, 2]);
    expect(c.steps.map((s) => s.input)).toEqual(["p1", "p2"]);
  });

  it("marks a cycle that errored", () => {
    const [c] = buildCycles([cycleStart(1), aStart("dreamer", "x"), aExit("dreamer"), cycleErr(1)]);
    expect(c.status).toBe("error");
  });

  it("marks a step that errored", () => {
    const [c] = buildCycles([
      cycleStart(1), aStart("dreamer", "x"), aErr("dreamer"), aExit("dreamer"), cycleDone(1),
    ]);
    expect(c.steps[0].status).toBe("error");
  });

  it("leaves an unfinished cycle and step as running", () => {
    const [c] = buildCycles([cycleStart(2), aStart("dreamer", "x"), aText("dreamer", "thinking")]);
    expect(c.status).toBe("running");
    expect(c.steps[0].status).toBe("running");
  });

  it("puts events before the first cycle.start in a pre-cycle bucket", () => {
    const cycles = buildCycles([
      aStart("demo", "p"), aText("demo", "hi"), aExit("demo"),
      cycleStart(1), aStart("dreamer", "x"), aExit("dreamer"), cycleDone(1),
    ]);
    expect(cycles).toHaveLength(2);
    expect(cycles[0].cycle).toBe(null);
    expect(cycles[0].steps[0].role).toBe("demo");
    expect(cycles[1].cycle).toBe(1);
  });

  it("falls back to the terminal event kind when a step has no text", () => {
    const [c] = buildCycles([cycleStart(1), aStart("scout", "x"), aExit("scout"), cycleDone(1)]);
    expect(c.steps[0].summary).toBe("agent.exit");
  });

  it("ignores non-cycle orchestrator events inside a step", () => {
    const [c] = buildCycles([
      cycleStart(1),
      aStart("scout", "x"),
      orchNoise("run.transition"),
      aExit("scout"),
      cycleDone(1),
    ]);
    const step = c.steps[0];
    expect(step.output).toBe("");
    expect(step.summary).toBe("agent.exit"); // terminal agent event, not run.transition
    expect(step.events.some((e) => e.kind === "run.transition")).toBe(false);
  });
});

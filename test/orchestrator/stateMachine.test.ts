import { describe, it, expect } from "vitest";
import { canTransition, assertTransition, IllegalTransitionError } from "../../src/orchestrator/stateMachine.ts";
import { RUN_TRANSITIONS } from "../../src/orchestrator/lifecycles.ts";

describe("state machine", () => {
  it("allows a legal transition", () => {
    expect(canTransition(RUN_TRANSITIONS, "queued", "running")).toBe(true);
  });

  it("rejects an illegal transition", () => {
    expect(canTransition(RUN_TRANSITIONS, "queued", "passed")).toBe(false);
  });

  it("assertTransition throws IllegalTransitionError with both states named", () => {
    expect(() => assertTransition(RUN_TRANSITIONS, "queued", "passed")).toThrow(IllegalTransitionError);
    expect(() => assertTransition(RUN_TRANSITIONS, "queued", "passed")).toThrow(/queued.*passed/);
  });

  it("treats an unknown from-state as no legal transitions", () => {
    expect(canTransition(RUN_TRANSITIONS, "bogus" as any, "running")).toBe(false);
  });
});

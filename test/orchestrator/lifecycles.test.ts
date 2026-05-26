import { describe, it, expect } from "vitest";
import { RUN_TRANSITIONS, WORK_ITEM_TRANSITIONS, SCENARIO_TRANSITIONS } from "../../src/orchestrator/lifecycles.ts";

describe("lifecycle transition tables", () => {
  it("runs go queued -> running -> failed, and failed -> archived", () => {
    expect(RUN_TRANSITIONS.queued).toContain("running");
    expect(RUN_TRANSITIONS.running).toContain("failed");
    expect(RUN_TRANSITIONS.failed).toContain("archived");
  });

  it("inconclusive runs may retry back to queued", () => {
    expect(RUN_TRANSITIONS.inconclusive).toContain("queued");
  });

  it("a run can be blocked before it starts (setup hook failure)", () => {
    expect(RUN_TRANSITIONS.queued).toContain("blocked");
  });

  it("work-items support the reopen path", () => {
    expect(WORK_ITEM_TRANSITIONS["ready-for-verification"]).toContain("done");
    expect(WORK_ITEM_TRANSITIONS["ready-for-verification"]).toContain("reopened");
    expect(WORK_ITEM_TRANSITIONS.reopened).toContain("in-progress");
  });

  it("work-items can be parked in needs-attention from key states", () => {
    expect(WORK_ITEM_TRANSITIONS.triaged).toContain("needs-attention");
    expect(WORK_ITEM_TRANSITIONS["ready-for-verification"]).toContain("needs-attention");
    expect(WORK_ITEM_TRANSITIONS.reopened).toContain("needs-attention");
    expect(WORK_ITEM_TRANSITIONS["needs-attention"]).toEqual([]);
  });

  it("scenarios can pass into the regression pool and fail into item-created", () => {
    expect(SCENARIO_TRANSITIONS.passed).toContain("regression");
    expect(SCENARIO_TRANSITIONS.failed).toContain("item-created");
  });

  it("scenarios can graduate (terminal in the LLM loop)", () => {
    expect(SCENARIO_TRANSITIONS.regression).toContain("graduated");
    expect(SCENARIO_TRANSITIONS.passed).toContain("graduated");
    expect(SCENARIO_TRANSITIONS["graduated"]).toEqual([]);
  });

  it("terminal-ish states exist with no required onward transition", () => {
    expect(RUN_TRANSITIONS.archived).toEqual([]);
    expect(WORK_ITEM_TRANSITIONS.done).toEqual([]);
  });
});

import type { RunStatus, WorkItemStatus, ScenarioStatus } from "../types.ts";

type Transitions<S extends string> = Record<S, S[]>;

// Run lifecycle (blueprint §14)
export const RUN_TRANSITIONS: Transitions<RunStatus> = {
  queued: ["running"],
  running: ["passed", "failed", "blocked", "flaky", "invalid", "inconclusive"],
  passed: ["archived"],
  failed: ["archived"],
  blocked: ["archived"],
  flaky: ["archived", "queued"],
  invalid: ["archived"],
  inconclusive: ["queued", "archived"],
  archived: [],
};

// Work-item lifecycle (blueprint §14)
export const WORK_ITEM_TRANSITIONS: Transitions<WorkItemStatus> = {
  open: ["triaged"],
  triaged: ["in-progress"],
  "in-progress": ["in-review"],
  "in-review": ["ready-for-verification"],
  "ready-for-verification": ["done", "reopened"],
  reopened: ["in-progress"],
  done: [],
};

// Scenario lifecycle (blueprint §14)
export const SCENARIO_TRANSITIONS: Transitions<ScenarioStatus> = {
  draft: ["ready"],
  ready: ["active", "running"],
  active: ["running"],
  running: ["passed", "failed", "blocked", "invalid"],
  passed: ["regression", "ready"],
  regression: ["ready", "running"],
  failed: ["item-created"],
  "item-created": ["awaiting-fix"],
  "awaiting-fix": ["ready-for-verification"],
  "ready-for-verification": ["verified", "failed"],
  verified: ["regression"],
  blocked: ["needs-product-review", "ready"],
  invalid: ["needs-product-review"],
  "needs-product-review": ["ready", "deprecated"],
  deprecated: [],
};

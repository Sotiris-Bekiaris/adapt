// Lifecycle enums shared across plans. Single source of truth — Plans 2 and 3 import from here.

export const SCENARIO_STATUSES = [
  "draft", "ready", "active", "running", "passed", "regression",
  "failed", "item-created", "awaiting-fix", "ready-for-verification",
  "verified", "blocked", "invalid", "needs-product-review", "deprecated",
] as const;
export type ScenarioStatus = (typeof SCENARIO_STATUSES)[number];

export const RUN_STATUSES = [
  "queued", "running", "passed", "failed", "blocked", "flaky",
  "invalid", "inconclusive", "archived",
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const WORK_ITEM_STATUSES = [
  "open", "triaged", "in-progress", "in-review",
  "ready-for-verification", "done", "reopened",
] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];

export const PRIORITIES = ["low", "medium", "high", "critical"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const SCENARIO_SOURCES = ["human-seeded", "agent-discovered"] as const;
export type ScenarioSource = (typeof SCENARIO_SOURCES)[number];

export const WORKSPACE_DIRNAME = ".adapt";

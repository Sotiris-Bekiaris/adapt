import { z } from "zod";
import { SCENARIO_STATUSES, PRIORITIES, SCENARIO_SOURCES, RUN_STATUSES } from "../types.ts";

export const ScenarioMetaSchema = z.object({
  id: z.string().regex(/^SCN-\d+$/, "id must look like SCN-001"),
  title: z.string().min(1),
  status: z.enum(SCENARIO_STATUSES),
  priority: z.enum(PRIORITIES),
  persona: z.string().min(1),
  tags: z.array(z.string()).default([]),
  source: z.enum(SCENARIO_SOURCES),
  lastResult: z.enum(["unknown", ...RUN_STATUSES]).default("unknown"),
  lastRunId: z.string().nullable().default(null),
  linkedIssues: z.array(z.string()).default([]),
  hooks: z.object({
    setup: z.string().optional(),
    teardown: z.string().optional(),
  }).optional(),
});

export type ScenarioMeta = z.infer<typeof ScenarioMetaSchema>;

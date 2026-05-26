import { z } from "zod";
import { WORK_ITEM_STATUSES } from "../types.ts";
import type { RunRecord } from "../orchestrator/runRecord.ts";

export const CLASSIFICATIONS = ["bug", "environment", "test-data", "invalid-scenario", "flaky", "needs-human"] as const;
export const SEVERITIES = ["low", "medium", "high", "critical"] as const;

export const WorkItemSchema = z.object({
  id: z.string().regex(/^ITEM-\d+$/, "id must look like ITEM-001"),
  title: z.string().min(1),
  scenarioId: z.string(),
  runIds: z.array(z.string()).min(1),
  expected: z.string().nullable(),
  actual: z.string().nullable(),
  classification: z.enum(CLASSIFICATIONS),
  severity: z.enum(SEVERITIES),
  dedupeKey: z.string(),
  status: z.enum(WORK_ITEM_STATUSES),
  jiraKey: z.string().nullable(),
  labels: z.array(z.string()),
  notes: z.string(),
  createdAt: z.string(),
});

export type WorkItem = z.infer<typeof WorkItemSchema>;

export interface TriageVerdict {
  classification: (typeof CLASSIFICATIONS)[number];
  severity: (typeof SEVERITIES)[number];
  title: string;
  isActionable: boolean;
  jiraKey: string | null;
  notes: string;
}

export function newWorkItem(args: {
  id: string; record: RunRecord; dedupeKey: string; createdAt: string; triage: TriageVerdict;
}): WorkItem {
  const { id, record, dedupeKey, createdAt, triage } = args;
  return {
    id,
    title: triage.title,
    scenarioId: record.scenarioId,
    runIds: [record.runId],
    expected: record.expectedOutcome,
    actual: record.actualOutcome,
    classification: triage.classification,
    severity: triage.severity,
    dedupeKey,
    status: "triaged",
    jiraKey: triage.jiraKey,
    labels: [],
    notes: triage.notes,
    createdAt,
  };
}

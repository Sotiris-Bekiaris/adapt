import { z } from "zod";
import { RUN_STATUSES } from "../types.ts";

export const RunRecordSchema = z.object({
  runId: z.string(),
  scenarioId: z.string(),
  scenarioTitle: z.string(),
  status: z.enum(RUN_STATUSES),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  appBaseUrl: z.string(),
  appVersion: z.string().nullable(),     // target commit SHA when known
  environment: z.string(),
  stepsExecuted: z.number().int().nonnegative(),
  failureStep: z.number().int().nullable(),
  expectedOutcome: z.string().nullable(),
  actualOutcome: z.string().nullable(),
  consoleErrors: z.array(z.string()),
  networkErrors: z.array(z.string()),
  screenshots: z.array(z.string()),
  artifacts: z.array(z.string()),
  runnerNotes: z.string().nullable(),
});

export type RunRecord = z.infer<typeof RunRecordSchema>;

export function newRunRecord(init: {
  runId: string; scenarioId: string; scenarioTitle: string;
  appBaseUrl: string; startedAt: string; appVersion?: string | null; environment?: string;
}): RunRecord {
  return {
    runId: init.runId,
    scenarioId: init.scenarioId,
    scenarioTitle: init.scenarioTitle,
    status: "queued",
    startedAt: init.startedAt,
    finishedAt: null,
    appBaseUrl: init.appBaseUrl,
    appVersion: init.appVersion ?? null,
    environment: init.environment ?? "local",
    stepsExecuted: 0,
    failureStep: null,
    expectedOutcome: null,
    actualOutcome: null,
    consoleErrors: [],
    networkErrors: [],
    screenshots: [],
    artifacts: [],
    runnerNotes: null,
  };
}

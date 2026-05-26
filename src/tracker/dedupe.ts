import type { RunRecord } from "../orchestrator/runRecord.ts";

function norm(s: string | null | undefined, max = 120): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, max);
}

/** Deterministic key identifying a root failure: scenario + failing step + normalized
 *  actual outcome + first console & network error signatures. Same root → same key. */
export function dedupeKey(run: RunRecord): string {
  return [
    run.scenarioId,
    String(run.failureStep ?? "-"),
    norm(run.actualOutcome),
    norm(run.consoleErrors[0], 80),
    norm(run.networkErrors[0], 80),
  ].join(" | ");
}

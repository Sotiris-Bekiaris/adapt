// Type declarations for the plain-JS browser module cycles.js, so the
// TypeScript test (and any future TS consumer) type-checks under strict mode.

export interface CycleStep {
  index: number;
  role: string;
  status: "running" | "done" | "error";
  input: string | null;
  output: string;
  summary: string;
  events: ReadonlyArray<Record<string, unknown>>;
}

export interface Cycle {
  cycle: number | null;
  status: "running" | "done" | "error";
  startedAt: string | null;
  steps: CycleStep[];
}

export function buildCycles(events: ReadonlyArray<Record<string, unknown>>): Cycle[];

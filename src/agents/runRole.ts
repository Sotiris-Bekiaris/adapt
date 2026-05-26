import { existsSync, readFileSync, rmSync } from "node:fs";
import type { ZodType } from "zod";
import type { AgentEngine, AgentEvent, AgentSpec } from "../engine/types.ts";
import { runAgent } from "../engine/runAgent.ts";

export interface RoleOutcome<T> {
  status: "ok" | "missing" | "invalid";
  value?: T;
  error?: string;
  exitCode: number;
}

/**
 * Run an agent for a role, then read + validate the result file it was asked to write.
 * Clears any stale result file first so a prior run's output can't be mistaken for this one.
 */
export async function runRole<T>(
  engine: AgentEngine,
  spec: AgentSpec,
  resultFile: string,
  schema: ZodType<T>,
  sink: (e: AgentEvent) => void,
): Promise<RoleOutcome<T>> {
  if (existsSync(resultFile)) rmSync(resultFile);

  const res = await runAgent(engine, spec, sink);

  if (!existsSync(resultFile)) return { status: "missing", exitCode: res.exitCode };

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(resultFile, "utf8"));
  } catch (e) {
    return { status: "invalid", error: `result is not JSON: ${(e as Error).message}`, exitCode: res.exitCode };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success) return { status: "invalid", error: parsed.error.message, exitCode: res.exitCode };
  return { status: "ok", value: parsed.data, exitCode: res.exitCode };
}

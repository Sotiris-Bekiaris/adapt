import type { AgentEngine, AgentEvent } from "../engine/types.ts";
import type { AdaptConfig } from "../config/schema.ts";
import { StateStore } from "./store.ts";
import type { OrchestratorEvent } from "./orchestrator.ts";
import { runEvolve, type EvolveSummary } from "./evolve.ts";

export type StopReason = "maxCycles" | "wallClock" | "errors" | "signal";

export interface ContinuousDeps {
  engine: AgentEngine;
  store: StateStore;
  config: AdaptConfig;
  targetRepo: string;
  sink: (e: AgentEvent) => void;
  emit: (e: OrchestratorEvent) => void;
  now?: () => string;
  nowDate?: () => Date;
  sleep?: (ms: number) => Promise<void>;
  clockMs?: () => number;
  signal?: { stopped: boolean };
}

export interface ContinuousSummary {
  cycles: number;
  stoppedBy: StopReason;
  evolveSummaries: EvolveSummary[];
}

/** Loop runEvolve until a guardrail trips. Deterministic; injectable sleep/clock/signal for tests. */
export async function runContinuous(deps: ContinuousDeps): Promise<ContinuousSummary> {
  const r = deps.config.run;
  const now = deps.now ?? (() => new Date().toISOString());
  const clockMs = deps.clockMs ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((res) => setTimeout(res, ms)));
  const startMs = clockMs();
  const wallClockExceeded = () => (clockMs() - startMs) / 1000 >= r.maxWallClockSeconds;
  const pauseBetweenCycles = async (): Promise<StopReason | undefined> => {
    const pauseMs = r.pauseSeconds * 1000;
    if (pauseMs === 0) {
      await sleep(0);
      if (deps.signal?.stopped) return "signal";
      if (wallClockExceeded()) return "wallClock";
      return undefined;
    }

    let remainingMs = pauseMs;
    while (remainingMs > 0) {
      if (deps.signal?.stopped) return "signal";
      if (wallClockExceeded()) return "wallClock";
      const chunkMs = Math.min(250, remainingMs);
      await sleep(chunkMs);
      remainingMs -= chunkMs;
    }
    if (deps.signal?.stopped) return "signal";
    if (wallClockExceeded()) return "wallClock";
    return undefined;
  };

  const evolveSummaries: EvolveSummary[] = [];
  let cycles = 0;
  let consecutiveErrors = 0;

  while (true) {
    if (deps.signal?.stopped) return { cycles, stoppedBy: "signal", evolveSummaries };
    if (cycles >= r.maxCycles) return { cycles, stoppedBy: "maxCycles", evolveSummaries };
    if (wallClockExceeded()) return { cycles, stoppedBy: "wallClock", evolveSummaries };

    deps.emit({ type: "cycle.start", at: now(), cycle: cycles + 1 });
    let errored = false;
    try {
      const summary = await runEvolve({
        engine: deps.engine, store: deps.store, config: deps.config, targetRepo: deps.targetRepo,
        sink: deps.sink, emit: deps.emit, now: deps.now, nowDate: deps.nowDate,
      });
      evolveSummaries.push(summary);
      consecutiveErrors = 0;
      deps.emit({ type: "cycle.completed", at: now(), cycle: cycles + 1 });
    } catch (e) {
      errored = true;
      consecutiveErrors++;
      deps.emit({ type: "cycle.error", at: now(), cycle: cycles + 1, message: (e as Error).message });
    }
    cycles++;

    if (errored && consecutiveErrors >= r.maxConsecutiveErrors) {
      return { cycles, stoppedBy: "errors", evolveSummaries };
    }
    if (cycles >= r.maxCycles) return { cycles, stoppedBy: "maxCycles", evolveSummaries };
    if (wallClockExceeded()) return { cycles, stoppedBy: "wallClock", evolveSummaries };
    if (deps.signal?.stopped) return { cycles, stoppedBy: "signal", evolveSummaries };
    const stoppedBy = await pauseBetweenCycles();
    if (stoppedBy) return { cycles, stoppedBy, evolveSummaries };
  }
}

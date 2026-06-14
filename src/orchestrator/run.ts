import type { AgentEngine, AgentEvent } from "../engine/types.ts";
import type { AdaptConfig } from "../config/schema.ts";
import { StateStore } from "./store.ts";
import type { OrchestratorEvent } from "./orchestrator.ts";
import { runEvolve, type EvolveSummary } from "./evolve.ts";
import { readControl, type LaneControl } from "../lanes/control.ts";

export type StopReason = "maxCycles" | "wallClock" | "errors" | "signal" | "control";

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
  /** Control-file reader; defaults to the real fs reader. Injectable for tests. */
  readControl?: (worktree: string) => LaneControl;
}

export interface ContinuousSummary {
  cycles: number;
  stoppedBy: StopReason;
  evolveSummaries: EvolveSummary[];
}

/** Loop runEvolve until a guardrail trips. Deterministic; injectable sleep/clock/signal/control for tests. */
export async function runContinuous(deps: ContinuousDeps): Promise<ContinuousSummary> {
  const r = deps.config.run;
  const now = deps.now ?? (() => new Date().toISOString());
  const clockMs = deps.clockMs ?? (() => Date.now());
  const sleep = deps.sleep ?? ((ms) => new Promise<void>((res) => setTimeout(res, ms)));
  const readCtl = deps.readControl ?? readControl;
  const startMs = clockMs();
  const wallClockExceeded = () =>
    r.maxWallClockSeconds !== null && (clockMs() - startMs) / 1000 >= r.maxWallClockSeconds;

  const effectiveMaxCycles = (ctl: LaneControl): number | null =>
    ctl.maxCycles !== undefined ? ctl.maxCycles : r.maxCycles;

  const pauseBetweenCycles = async (): Promise<StopReason | undefined> => {
    const pauseMs = r.pauseSeconds * 1000;
    let remainingMs = pauseMs;
    do {
      if (deps.signal?.stopped) return "signal";
      if (wallClockExceeded()) return "wallClock";
      const chunkMs = pauseMs === 0 ? 0 : Math.min(250, remainingMs);
      await sleep(chunkMs);
      remainingMs -= chunkMs;
    } while (remainingMs > 0);
    if (deps.signal?.stopped) return "signal";
    if (wallClockExceeded()) return "wallClock";
    return undefined;
  };

  const evolveSummaries: EvolveSummary[] = [];
  let cycles = 0;
  let consecutiveErrors = 0;

  while (true) {
    if (deps.signal?.stopped) return { cycles, stoppedBy: "signal", evolveSummaries };

    let control = readCtl(deps.targetRepo);

    if (control.paused) {
      deps.emit({ type: "cycle.paused", at: now(), cycle: cycles });
      while (control.paused) {
        if (deps.signal?.stopped) return { cycles, stoppedBy: "signal", evolveSummaries };
        if (control.stopRequested) return { cycles, stoppedBy: "control", evolveSummaries };
        if (wallClockExceeded()) return { cycles, stoppedBy: "wallClock", evolveSummaries };
        await sleep(250);
        control = readCtl(deps.targetRepo);
      }
      deps.emit({ type: "cycle.resumed", at: now(), cycle: cycles });
    }

    if (control.stopRequested) return { cycles, stoppedBy: "control", evolveSummaries };
    const maxCycles = effectiveMaxCycles(control);
    if (maxCycles !== null && cycles >= maxCycles) return { cycles, stoppedBy: "maxCycles", evolveSummaries };
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

    if (deps.signal?.stopped) return { cycles, stoppedBy: "signal", evolveSummaries };
    if (errored && consecutiveErrors >= r.maxConsecutiveErrors) {
      return { cycles, stoppedBy: "errors", evolveSummaries };
    }
    if (maxCycles !== null && cycles >= maxCycles) return { cycles, stoppedBy: "maxCycles", evolveSummaries };
    if (wallClockExceeded()) return { cycles, stoppedBy: "wallClock", evolveSummaries };
    const stoppedBy = await pauseBetweenCycles();
    if (stoppedBy) return { cycles, stoppedBy, evolveSummaries };
  }
}

import { assertTransition } from "./stateMachine.ts";
import { RUN_TRANSITIONS } from "./lifecycles.ts";
import { newRunRecord, type RunRecord } from "./runRecord.ts";
import { RunLedger } from "./runLedger.ts";
import { makeRunId } from "./ids.ts";
import { StateStore, type AttemptKind } from "./store.ts";
import type { RunStatus } from "../types.ts";

export interface OrchestratorLimits {
  maxFixAttempts: number;
  maxVerificationAttempts: number;
  maxItemsPerRun: number;
  maxCycleSeconds: number;
}

export interface OrchestratorEvent {
  type: string;
  at: string;
  [k: string]: unknown;
}

export interface OrchestratorOptions {
  targetRepo: string;
  store: StateStore;
  appBaseUrl: string;
  limits: OrchestratorLimits;
  clock?: () => string;
  now?: () => Date;
  emit?: (e: OrchestratorEvent) => void;
}

export class Orchestrator {
  private store: StateStore;
  private ledger: RunLedger;
  private appBaseUrl: string;
  private limits: OrchestratorLimits;
  private clock: () => string;
  private now: () => Date;
  private emitFn: (e: OrchestratorEvent) => void;
  private seq = 0;
  private records = new Map<string, RunRecord>();

  constructor(opts: OrchestratorOptions) {
    this.store = opts.store;
    this.ledger = new RunLedger(opts.targetRepo, opts.store);
    this.appBaseUrl = opts.appBaseUrl;
    this.limits = opts.limits;
    this.clock = opts.clock ?? (() => new Date().toISOString());
    this.now = opts.now ?? (() => new Date());
    this.emitFn = opts.emit ?? (() => {});
  }

  private emit(type: string, extra: Record<string, unknown> = {}): void {
    this.emitFn({ type, at: this.clock(), ...extra });
  }

  createRun(scenarioId: string, scenarioTitle: string): RunRecord {
    const runId = makeRunId(this.now(), ++this.seq);
    const rec = newRunRecord({ runId, scenarioId, scenarioTitle, appBaseUrl: this.appBaseUrl, startedAt: this.clock() });
    this.records.set(runId, rec);
    this.ledger.write(rec);
    this.emit("run.created", { runId, scenarioId });
    return rec;
  }

  advanceRun(runId: string, to: RunStatus): RunRecord {
    const rec = this.requireRecord(runId);
    assertTransition(RUN_TRANSITIONS, rec.status, to);
    const next = { ...rec, status: to };
    this.records.set(runId, next);
    this.ledger.write(next);
    this.emit("run.transition", { runId, from: rec.status, to });
    return next;
  }

  recordResult(runId: string, result: Partial<RunRecord> & { status: RunStatus }): RunRecord {
    const rec = this.requireRecord(runId);
    assertTransition(RUN_TRANSITIONS, rec.status, result.status);
    const next: RunRecord = { ...rec, ...result, finishedAt: this.clock() };
    this.records.set(runId, next);
    this.ledger.write(next);
    this.emit("run.result", { runId, status: next.status });
    return next;
  }

  canAttempt(scenarioId: string, kind: AttemptKind): boolean {
    const limit = kind === "fix" ? this.limits.maxFixAttempts : this.limits.maxVerificationAttempts;
    return this.store.getAttempts(scenarioId, kind) < limit;
  }

  recordAttempt(scenarioId: string, kind: AttemptKind): number {
    const n = this.store.incrementAttempt(scenarioId, kind);
    this.emit("attempt.recorded", { scenarioId, kind, count: n });
    return n;
  }

  /** Runs left in 'running' by a crashed process become 'inconclusive'. Returns recovered run ids. */
  recoverIncomplete(): string[] {
    const stranded = this.store.findRunsByStatus("running");
    const ids: string[] = [];
    for (const row of stranded) {
      // Rewrite the ledger file (source of truth, §10) AND re-index the store via ledger.write,
      // so the two never disagree after recovery.
      const recovered: RunRecord = { ...this.ledger.read(row.runId), status: "inconclusive", finishedAt: this.clock() };
      this.ledger.write(recovered);
      this.records.set(row.runId, recovered);
      this.emit("run.recovered", { runId: row.runId });
      ids.push(row.runId);
    }
    return ids;
  }

  private requireRecord(runId: string): RunRecord {
    const rec = this.records.get(runId);
    if (!rec) throw new Error(`Unknown run ${runId}`);
    return rec;
  }
}

import Database from "better-sqlite3";
import type { RunStatus, ScenarioStatus } from "../types.ts";

export interface RunRow {
  runId: string;
  scenarioId: string;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
}

export type AttemptKind = "fix" | "verification";

export class StateStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        runId TEXT PRIMARY KEY,
        scenarioId TEXT NOT NULL,
        status TEXT NOT NULL,
        startedAt TEXT NOT NULL,
        finishedAt TEXT
      );
      CREATE TABLE IF NOT EXISTS scenario_state (
        scenarioId TEXT PRIMARY KEY,
        state TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attempts (
        scenarioId TEXT NOT NULL,
        kind TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (scenarioId, kind)
      );
      CREATE TABLE IF NOT EXISTS scenario_passes (
        scenarioId TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  upsertRun(row: RunRow): void {
    this.db.prepare(`
      INSERT INTO runs (runId, scenarioId, status, startedAt, finishedAt)
      VALUES (@runId, @scenarioId, @status, @startedAt, @finishedAt)
      ON CONFLICT(runId) DO UPDATE SET
        status=excluded.status, finishedAt=excluded.finishedAt
    `).run(row);
  }

  getRun(runId: string): RunRow | undefined {
    return this.db.prepare(`SELECT * FROM runs WHERE runId = ?`).get(runId) as RunRow | undefined;
  }

  listRuns(): RunRow[] {
    return this.db.prepare(`SELECT * FROM runs ORDER BY startedAt`).all() as RunRow[];
  }

  findRunsByStatus(status: RunStatus): RunRow[] {
    return this.db.prepare(`SELECT * FROM runs WHERE status = ? ORDER BY startedAt`).all(status) as RunRow[];
  }

  getScenarioState(scenarioId: string): ScenarioStatus {
    const row = this.db.prepare(`SELECT state FROM scenario_state WHERE scenarioId = ?`).get(scenarioId) as
      | { state: ScenarioStatus } | undefined;
    return row?.state ?? "ready";
  }

  setScenarioState(scenarioId: string, state: ScenarioStatus): void {
    this.db.prepare(`
      INSERT INTO scenario_state (scenarioId, state) VALUES (?, ?)
      ON CONFLICT(scenarioId) DO UPDATE SET state = excluded.state
    `).run(scenarioId, state);
  }

  incrementAttempt(scenarioId: string, kind: AttemptKind): number {
    this.db.prepare(`
      INSERT INTO attempts (scenarioId, kind, count) VALUES (?, ?, 1)
      ON CONFLICT(scenarioId, kind) DO UPDATE SET count = count + 1
    `).run(scenarioId, kind);
    return this.getAttempts(scenarioId, kind);
  }

  getAttempts(scenarioId: string, kind: AttemptKind): number {
    const row = this.db.prepare(`SELECT count FROM attempts WHERE scenarioId = ? AND kind = ?`)
      .get(scenarioId, kind) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  getScenarioPasses(scenarioId: string): number {
    const row = this.db.prepare(`SELECT count FROM scenario_passes WHERE scenarioId = ?`).get(scenarioId) as
      | { count: number } | undefined;
    return row?.count ?? 0;
  }

  incrementScenarioPasses(scenarioId: string): number {
    this.db.prepare(`
      INSERT INTO scenario_passes (scenarioId, count) VALUES (?, 1)
      ON CONFLICT(scenarioId) DO UPDATE SET count = count + 1
    `).run(scenarioId);
    return this.getScenarioPasses(scenarioId);
  }

  resetScenarioPasses(scenarioId: string): void {
    this.db.prepare(`
      INSERT INTO scenario_passes (scenarioId, count) VALUES (?, 0)
      ON CONFLICT(scenarioId) DO UPDATE SET count = 0
    `).run(scenarioId);
  }

  /** Flip every run left at status="running" (orphaned by a killed loop) to
   *  "inconclusive" and reset its scenario to "ready" so the next cycle re-runs
   *  it cleanly. Returns the affected runIds. */
  reapOrphanedRuns(): string[] {
    const rows = this.findRunsByStatus("running");
    const reap = this.db.transaction((items: RunRow[]) => {
      for (const row of items) {
        this.upsertRun({ ...row, status: "inconclusive" });
        this.setScenarioState(row.scenarioId, "ready");
      }
    });
    reap(rows);
    return rows.map((r) => r.runId);
  }

  close(): void {
    this.db.close();
  }
}

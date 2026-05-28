import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WebSocket } from "ws";
import type { ConsoleEvent } from "./events.ts";
import { laneLoopStatus } from "../lanes/loop.ts";
import { workspacePaths } from "../workspace/paths.ts";

export type LaneStatus = "running" | "stopped";

export interface LaneInfo {
  laneId: string;
  model: string | null;
  baseline: string;
  worktree: string;
  consolePort: number;
}

export interface LaneSourceDeps {
  /** Lane loop status probe; defaults to laneLoopStatus. */
  statusProbe?: (worktree: string) => LaneStatus;
  /** WS client factory; defaults to a `ws` package client. */
  connectWs?: (
    url: string,
    onEvent: (e: ConsoleEvent) => void,
    onClose: () => void,
  ) => { close(): void };
  /** Read the lane's decision-log NDJSON; defaults to reading all *.ndjson files. */
  readLog?: (worktree: string) => ConsoleEvent[];
}

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 5000;

/** Default WS client using the `ws` package. */
function defaultConnectWs(
  url: string,
  onEvent: (e: ConsoleEvent) => void,
  onClose: () => void,
): { close(): void } {
  const sock = new WebSocket(url);
  sock.on("message", (raw: unknown) => {
    try {
      const e = JSON.parse(String(raw)) as ConsoleEvent;
      onEvent(e);
    } catch {
      // Skip malformed frames.
    }
  });
  sock.on("error", () => {
    // Swallow; a close follows and drives reconnect.
  });
  sock.on("close", () => onClose());
  return {
    close() {
      try {
        sock.close();
      } catch {
        // ignore
      }
    },
  };
}

/** Default decision-log reader: every *.ndjson under the lane's decision-log dir. */
function defaultReadLog(worktree: string): ConsoleEvent[] {
  const dir = workspacePaths(worktree).decisionLogDir;
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".ndjson"))
    .sort();
  const out: ConsoleEvent[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(join(dir, file), "utf8");
    } catch {
      continue;
    }
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      try {
        out.push(JSON.parse(trimmed) as ConsoleEvent);
      } catch {
        // Skip malformed lines.
      }
    }
  }
  return out;
}

/** Is this an orchestrator cycle event carrying a numeric cycle? */
function cycleOf(e: ConsoleEvent): number | null {
  if (e.kind !== "cycle.start" && e.kind !== "cycle.completed") return null;
  const c = (e.data as { cycle?: unknown } | undefined)?.cycle;
  return typeof c === "number" ? c : null;
}

/** One lane's connection lifecycle: live WS client when running, historical log reader otherwise. */
export class LaneSource {
  readonly info: LaneInfo;
  private readonly statusProbe: (worktree: string) => LaneStatus;
  private readonly connectWs: NonNullable<LaneSourceDeps["connectWs"]>;
  private readonly readLog: (worktree: string) => ConsoleEvent[];

  private socket: { close(): void } | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = RECONNECT_MIN_MS;
  private stopped = false;
  private latestCycle = 0;
  private onEvent: ((e: ConsoleEvent) => void) | null = null;

  constructor(info: LaneInfo, deps: LaneSourceDeps = {}) {
    this.info = info;
    this.statusProbe = deps.statusProbe ?? laneLoopStatus;
    this.connectWs = deps.connectWs ?? defaultConnectWs;
    this.readLog = deps.readLog ?? defaultReadLog;
  }

  status(): LaneStatus {
    return this.statusProbe(this.info.worktree);
  }

  cycle(): number {
    return this.latestCycle;
  }

  start(onEvent: (e: ConsoleEvent) => void): void {
    this.onEvent = onEvent;
    this.stopped = false;
    if (this.status() !== "running") return;
    this.connect();
  }

  /** Ensure a live connection exists when the lane is running. Safe to call on every scan:
   *  no-op when stopped, already connected, or a reconnect is already scheduled. This is what
   *  picks up a lane that was stopped when first seen and later started its loop. */
  refresh(): void {
    if (this.stopped || this.socket || this.reconnectTimer) return;
    if (!this.onEvent) return;
    if (this.status() !== "running") return;
    this.connect();
  }

  readHistory(): ConsoleEvent[] {
    const events = this.readLog(this.info.worktree);
    for (const e of events) {
      e.lane = this.info.laneId;
      const c = cycleOf(e);
      if (c !== null && c > this.latestCycle) this.latestCycle = c;
    }
    return events;
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  private connect(): void {
    if (this.stopped) return;
    const url = `ws://127.0.0.1:${this.info.consolePort}/ws`;
    this.socket = this.connectWs(
      url,
      (e) => this.handleEvent(e),
      () => this.handleClose(),
    );
  }

  private handleEvent(e: ConsoleEvent): void {
    e.lane = this.info.laneId;
    const c = cycleOf(e);
    if (c !== null && c > this.latestCycle) this.latestCycle = c;
    // A successful frame means the connection is healthy; reset backoff.
    this.reconnectDelay = RECONNECT_MIN_MS;
    this.onEvent?.(e);
  }

  private handleClose(): void {
    this.socket = null;
    if (this.stopped) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      if (this.status() !== "running") return;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
      this.connect();
    }, this.reconnectDelay);
  }
}

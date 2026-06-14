import { join } from "node:path";
import type { ConsoleEvent } from "./events.ts";
import { LaneSource, type LaneInfo, type LaneStatus } from "./laneSource.ts";
import { listLanes } from "../lanes/lane.ts";
import { slotIndex } from "../lanes/ports.ts";
import { readControl } from "../lanes/control.ts";

export interface LaneSummary {
  laneId: string;
  model: string | null;
  baseline: string;
  status: LaneStatus;
  cycle: number;
  paused: boolean;
  maxCycles: number | null;
}

export interface LaneRegistryOpts {
  lanesRoot: string;
  consolePortBase: number; // config.console.port
  portBase: number; // config.environment?.portBase ?? 54300
  portStride: number; // config.environment?.portStride ?? 100
  onEvent: (e: ConsoleEvent) => void; // tagged live events from running lanes
  onChange: (summaries: LaneSummary[]) => void; // called when lane set or any status/cycle changes
  scanIntervalMs?: number; // default 2000
  makeSource?: (info: LaneInfo) => LaneSource; // injectable for tests
}

const DEFAULT_SCAN_INTERVAL_MS = 2000;

/** Aggregates per-lane sources by scanning lanesRoot, diffing on an interval. Read-only. */
export class LaneRegistry {
  private readonly opts: LaneRegistryOpts;
  private readonly scanIntervalMs: number;
  private readonly makeSource: (info: LaneInfo) => LaneSource;
  private readonly sources = new Map<string, LaneSource>();
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastEmit = "";

  constructor(opts: LaneRegistryOpts) {
    this.opts = opts;
    this.scanIntervalMs = opts.scanIntervalMs ?? DEFAULT_SCAN_INTERVAL_MS;
    this.makeSource = opts.makeSource ?? ((info) => new LaneSource(info));
  }

  start(): void {
    this.scan();
    this.interval = setInterval(() => this.scan(), this.scanIntervalMs);
  }

  summaries(): LaneSummary[] {
    const out: LaneSummary[] = [];
    for (const source of this.sources.values()) {
      const ctl = readControl(source.info.worktree);
      out.push({
        laneId: source.info.laneId,
        model: source.info.model,
        baseline: source.info.baseline,
        status: source.status(),
        cycle: source.cycle(),
        paused: ctl.paused,
        maxCycles: ctl.maxCycles ?? null,
      });
    }
    return out;
  }

  historyFor(laneId: string): ConsoleEvent[] {
    const source = this.sources.get(laneId);
    return source ? source.readHistory() : [];
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    for (const source of this.sources.values()) source.stop();
    this.sources.clear();
  }

  private scan(): void {
    const manifests = listLanes(this.opts.lanesRoot);
    const seen = new Set<string>();

    for (const manifest of manifests) {
      seen.add(manifest.laneId);
      const existing = this.sources.get(manifest.laneId);
      if (existing) {
        // Connect lanes that were stopped when first seen and have since started.
        existing.refresh();
        continue;
      }
      const consolePort =
        manifest.consolePort ??
        this.opts.consolePortBase +
          slotIndex(manifest.ports.base, this.opts.portBase, this.opts.portStride);
      const info: LaneInfo = {
        laneId: manifest.laneId,
        model: manifest.model,
        baseline: manifest.baseline,
        worktree: join(this.opts.lanesRoot, manifest.laneId),
        consolePort,
      };
      const source = this.makeSource(info);
      source.start(this.opts.onEvent);
      this.sources.set(manifest.laneId, source);
    }

    // Drop lanes no longer present.
    for (const [laneId, source] of this.sources) {
      if (seen.has(laneId)) continue;
      source.stop();
      this.sources.delete(laneId);
    }

    const summaries = this.summaries();
    const fingerprint = JSON.stringify(summaries);
    if (fingerprint !== this.lastEmit) {
      this.lastEmit = fingerprint;
      this.opts.onChange(summaries);
    }
  }
}

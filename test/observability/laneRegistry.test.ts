import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LaneRegistry } from "../../src/observability/laneRegistry.ts";

function lanesRootWith(laneId: string, control?: object): string {
  const root = mkdtempSync(join(tmpdir(), "registry-"));
  const adapt = join(root, laneId, ".adapt");
  mkdirSync(adapt, { recursive: true });
  writeFileSync(join(adapt, "lane.json"), JSON.stringify({
    laneId, baseline: "v1", model: null, branch: `adapt/${laneId}`,
    composeProject: `adapt-${laneId}`, ports: { base: 55000, stride: 100 },
    consolePort: 4399, createdAt: "2026-06-14T00:00:00.000Z",
  }), "utf8");
  if (control) writeFileSync(join(adapt, "control.json"), JSON.stringify(control), "utf8");
  return root;
}

function fakeSource(info: { worktree: string }) {
  return {
    info, start() {}, stop() {}, refresh() {},
    status: () => "stopped", cycle: () => 0, readHistory: () => [],
  };
}

describe("LaneRegistry summaries", () => {
  it("includes paused + maxCycles read from control.json", () => {
    const root = lanesRootWith("a", { paused: true, maxCycles: 7, stopRequested: false });
    const reg = new LaneRegistry({
      lanesRoot: root, consolePortBase: 4399, portBase: 55000, portStride: 100,
      onEvent: () => {}, onChange: () => {},
      makeSource: (info) => fakeSource(info) as never,
    });
    reg.start();
    const summary = reg.summaries().find((s) => s.laneId === "a")!;
    expect(summary.paused).toBe(true);
    expect(summary.maxCycles).toBe(7);
    reg.stop();
    rmSync(root, { recursive: true, force: true });
  });

  it("defaults paused=false, maxCycles=null when no control file", () => {
    const root = lanesRootWith("a");
    const reg = new LaneRegistry({
      lanesRoot: root, consolePortBase: 4399, portBase: 55000, portStride: 100,
      onEvent: () => {}, onChange: () => {},
      makeSource: (info) => fakeSource(info) as never,
    });
    reg.start();
    const summary = reg.summaries().find((s) => s.laneId === "a")!;
    expect(summary.paused).toBe(false);
    expect(summary.maxCycles).toBeNull();
    reg.stop();
    rmSync(root, { recursive: true, force: true });
  });
});

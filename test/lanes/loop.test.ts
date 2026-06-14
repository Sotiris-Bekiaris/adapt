import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startLaneLoop, laneLoopStatus } from "../../src/lanes/loop.ts";

function makeWorktree(): string {
  const wt = mkdtempSync(join(tmpdir(), "lane-loop-"));
  mkdirSync(join(wt, ".adapt"), { recursive: true });
  const manifest = {
    laneId: "t",
    baseline: "v1",
    model: null,
    branch: "adapt/t",
    composeProject: "adapt-t",
    ports: { base: 55000, stride: 100 },
    consolePort: 4399,
    createdAt: "2026-06-14T00:00:00.000Z",
  };
  writeFileSync(join(wt, ".adapt", "lane.json"), JSON.stringify(manifest), "utf8");
  return wt;
}

describe("startLaneLoop foreground", () => {
  it("records a pidfile while running so the lane reads as running, then removes it", async () => {
    const wt = makeWorktree();
    const pidfile = join(wt, ".adapt", "loop.pid");
    let pidfileDuringRun = false;
    let statusDuringRun: string | undefined;

    const code = await startLaneLoop({
      worktree: wt,
      detach: false,
      ensureEnv: async () => true,
      runner: async () => {
        pidfileDuringRun = existsSync(pidfile);
        statusDuringRun = laneLoopStatus(wt);
        return 0;
      },
      log: () => {},
    });

    expect(code).toBe(0);
    expect(pidfileDuringRun).toBe(true);
    expect(statusDuringRun).toBe("running");
    expect(existsSync(pidfile)).toBe(false); // cleaned up after the loop returns

    rmSync(wt, { recursive: true, force: true });
  });

  it("removes its pidfile even if the runner throws", async () => {
    const wt = makeWorktree();
    const pidfile = join(wt, ".adapt", "loop.pid");

    await expect(
      startLaneLoop({
        worktree: wt,
        detach: false,
        ensureEnv: async () => true,
        runner: async () => {
          throw new Error("loop blew up");
        },
        log: () => {},
      }),
    ).rejects.toThrow("loop blew up");

    expect(existsSync(pidfile)).toBe(false);
    rmSync(wt, { recursive: true, force: true });
  });
});

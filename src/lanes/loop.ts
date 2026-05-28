import { existsSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { workspacePaths } from "../workspace/paths.ts";
import { readLaneManifest, laneEnv } from "./lane.ts";

function pidfilePath(worktree: string): string {
  return `${workspacePaths(worktree).root}/loop.pid`;
}

export type LoopStatus = "running" | "stopped";

export interface StartLaneLoopOptions {
  worktree: string;
  detach: boolean;
  envUp?: string;
  /** Foreground loop runner; defaults to runCmd. Returns an exit code. */
  runner?: (targetRepo: string) => Promise<number>;
  /** Ensure the lane environment is up; defaults to running envUp via runEnvCommand. */
  ensureEnv?: () => Promise<boolean>;
  /** Spawn the detached loop process; returns its pid. Defaults to a real detached child. */
  spawnDetached?: () => number;
  log?: (msg: string) => void;
}

/** Default detached spawn: re-invoke `adapt run <worktree>` as an unref'd background process. */
function defaultSpawnDetached(worktree: string): number {
  const entrypoint = process.argv[1] ?? "";
  const child = spawn(process.execPath, [entrypoint, "run", worktree], {
    cwd: worktree, detached: true, stdio: "ignore",
    env: { ...process.env },
  });
  child.unref();
  return child.pid ?? -1;
}

/** Core of `adapt lane start`. Foreground runs the loop; --detach backgrounds it + writes a pidfile. */
export async function startLaneLoop(opts: StartLaneLoopOptions): Promise<number> {
  const log = opts.log ?? console.log;
  const manifest = readLaneManifest(opts.worktree);
  if (!manifest) {
    log(`error: no lane manifest at ${opts.worktree} — is this a lane worktree?`);
    return 1;
  }

  const ensureEnv = opts.ensureEnv ?? (async () => {
    const { runEnvCommand } = await import("./lane.ts");
    return runEnvCommand(opts.envUp, opts.worktree, manifest);
  });
  if (!(await ensureEnv())) {
    log(`error: environment.up failed for lane "${manifest.laneId}"`);
    return 1;
  }

  if (opts.detach) {
    const spawnDetached = opts.spawnDetached ?? (() => defaultSpawnDetached(opts.worktree));
    const pid = spawnDetached();
    writeFileSync(pidfilePath(opts.worktree), `${pid}\n`, "utf8");
    log(`  started  lane "${manifest.laneId}" loop in background (pid ${pid})`);
    return 0;
  }

  const runner = opts.runner ?? (async (target: string) => {
    const { runCmd, requestRunStop } = await import("../cli/commands/run.ts");
    const signal = { stopped: false };
    process.on("SIGINT", () => { if (!requestRunStop(signal)) process.exit(130); });
    const res = await runCmd({ targetRepo: target, signal, consolePort: manifest.consolePort });
    return res.code;
  });
  // Touch laneEnv so the namespace is part of this process too (parity with detached env).
  Object.assign(process.env, laneEnv(manifest));
  return runner(opts.worktree);
}

/** Core of `adapt lane stop`: signal the loop process and remove the pidfile. */
export function stopLaneLoop(
  worktree: string,
  kill: (pid: number) => boolean = (pid) => { try { process.kill(pid, "SIGINT"); return true; } catch { return false; } },
  log: (msg: string) => void = console.log,
): number {
  const pf = pidfilePath(worktree);
  if (!existsSync(pf)) {
    log(`error: no background loop recorded for this lane`);
    return 1;
  }
  const pid = Number(readFileSync(pf, "utf8").trim());
  kill(pid);
  unlinkSync(pf);
  log(`  stopping  lane loop (pid ${pid})`);
  return 0;
}

/** Loop status from the pidfile + a liveness probe. */
export function laneLoopStatus(
  worktree: string,
  isAlive: (pid: number) => boolean = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } },
): LoopStatus {
  const pf = pidfilePath(worktree);
  if (!existsSync(pf)) return "stopped";
  const pid = Number(readFileSync(pf, "utf8").trim());
  return isAlive(pid) ? "running" : "stopped";
}

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

/**
 * Argv for the detached loop child. `--console <port>` is what makes a backgrounded lane
 * observable: without it runCmd starts no ObservabilityServer, the monitor's `ws://127.0.0.1:
 * <consolePort>/ws` connect fails, and the lane can only be replayed from its decision log.
 * Mirrors the foreground path, which passes the same manifest port straight to runCmd.
 */
export function detachedRunArgs(entrypoint: string, worktree: string, consolePort: number): string[] {
  return [entrypoint, "run", worktree, "--console", String(consolePort)];
}

/** Default detached spawn: re-invoke `adapt run <worktree>` as an unref'd background process. */
function defaultSpawnDetached(worktree: string, consolePort: number): number {
  const entrypoint = process.argv[1] ?? "";
  const child = spawn(process.execPath, detachedRunArgs(entrypoint, worktree, consolePort), {
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
    const spawnDetached = opts.spawnDetached ?? (() => defaultSpawnDetached(opts.worktree, manifest.consolePort));
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
  // Record our own pid so `laneLoopStatus` recognizes a foreground loop as running —
  // not just --detach loops. The monitor only opens a live WS to lanes it sees as
  // running, so without this a foreground autonomous loop streams nothing. Removed on
  // exit, but only if the pidfile is still ours (don't clobber a detached one).
  const pf = pidfilePath(opts.worktree);
  writeFileSync(pf, `${process.pid}\n`, "utf8");
  try {
    return await runner(opts.worktree);
  } finally {
    try {
      if (existsSync(pf) && Number(readFileSync(pf, "utf8").trim()) === process.pid) unlinkSync(pf);
    } catch {
      /* ignore cleanup races */
    }
  }
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

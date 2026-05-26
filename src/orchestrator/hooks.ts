import { spawnSync } from "node:child_process";

export interface HookResult {
  ran: boolean;
  ok: boolean;
  code: number;
  output: string;
}

/** Run a shell hook command in `cwd`. An undefined command is a no-op success. */
export function runHook(cmd: string | undefined, cwd: string): HookResult {
  if (!cmd) return { ran: false, ok: true, code: 0, output: "" };
  const res = spawnSync(cmd, { cwd, shell: true, encoding: "utf8" });
  const output = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const code = res.status ?? 1;
  return { ran: true, ok: code === 0, code, output };
}

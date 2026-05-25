import { existsSync, statSync } from "node:fs";
import { scaffoldWorkspace } from "../../workspace/scaffold.ts";

export interface InitOptions {
  targetRepo: string;
  appBaseUrl: string;
}

/** Core of `adapt init`. Returns a process exit code. `log` is injected for testability. */
export function runInit(opts: InitOptions, log: (msg: string) => void = console.log): number {
  if (!existsSync(opts.targetRepo) || !statSync(opts.targetRepo).isDirectory()) {
    log(`error: target repo "${opts.targetRepo}" is not an existing directory`);
    return 1;
  }
  const res = scaffoldWorkspace(opts.targetRepo, opts.appBaseUrl);
  for (const c of res.created) log(`  created  ${c}`);
  for (const s of res.skipped) log(`  skipped  ${s} (already exists)`);
  log(`\nadapt workspace ready at ${opts.targetRepo}/.adapt`);
  log(`Next: copy config.example.json to config.json and edit it, then seed scenarios/.`);
  return 0;
}

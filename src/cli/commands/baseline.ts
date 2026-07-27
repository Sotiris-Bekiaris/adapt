import { createBaseline, listBaselines } from "../../lanes/baseline.ts";

export interface BaselineCreateOptions { targetRepo: string; name: string; }
export interface BaselineListOptions { targetRepo: string; }
export interface CmdResult { code: number; }

export function baselineCreateCmd(opts: BaselineCreateOptions, log: (m: string) => void = console.log): CmdResult {
  return { code: createBaseline({ targetRepo: opts.targetRepo, name: opts.name }, log) };
}

export function baselineListCmd(opts: BaselineListOptions, log: (m: string) => void = console.log): CmdResult {
  const list = listBaselines(opts.targetRepo);
  if (list.length === 0) {
    log(`(no baselines yet)`);
    log(`  A baseline is the commit lanes fork from. Create one from a clean working tree:`);
    log(`    adapt baseline create v1 ${opts.targetRepo}`);
    return { code: 0 };
  }
  log(`  ${"BASELINE".padEnd(20)}${"COMMIT".padEnd(10)}CREATED`);
  for (const b of list) log(`  ${b.name.padEnd(20)}${b.commit.slice(0, 8).padEnd(10)}${b.createdAt}`);
  return { code: 0 };
}

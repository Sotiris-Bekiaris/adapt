import { createBaseline, listBaselines } from "../../lanes/baseline.ts";

export interface BaselineCreateOptions { targetRepo: string; name: string; }
export interface BaselineListOptions { targetRepo: string; }
export interface CmdResult { code: number; }

export function baselineCreateCmd(opts: BaselineCreateOptions, log: (m: string) => void = console.log): CmdResult {
  return { code: createBaseline({ targetRepo: opts.targetRepo, name: opts.name }, log) };
}

export function baselineListCmd(opts: BaselineListOptions, log: (m: string) => void = console.log): CmdResult {
  const list = listBaselines(opts.targetRepo);
  if (list.length === 0) { log("(no baselines — create one with \"adapt baseline create <name>\")"); return { code: 0 }; }
  for (const b of list) log(`  ${b.name}\t${b.commit.slice(0, 8)}\t${b.createdAt}`);
  return { code: 0 };
}

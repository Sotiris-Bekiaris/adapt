import { existsSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { scaffoldWorkspace } from "../../workspace/scaffold.ts";
import { workspacePaths } from "../../workspace/paths.ts";
import { ClaudeCodeEngine } from "../../engine/claudeCode.ts";
import { scoutPrompt } from "../../agents/prompts/scout.ts";
import type { AgentEngine } from "../../engine/types.ts";

export interface InitOptions {
  targetRepo: string;
  appBaseUrl: string;
  /** Injected for testing; defaults to a live ClaudeCodeEngine. */
  engine?: AgentEngine;
}

function fallbackNorthStar(targetRepo: string): string {
  const repo = resolve(targetRepo);
  return `# North Star

> The product vision adapt evolves toward. The Scout agent could not inspect this repo — edit this file to describe your product vision, then run \`adapt evolve\` to let the Dreamer build on it.

## Vision

_Describe what this product should become and for whom. The codebase is at ${repo}._

## Goals

- _A measurable, user-visible goal._

## Constraints

- _What the organism must never break or violate._
`;
}

/** Core of `adapt init`. Returns a process exit code. `log` is injected for testability. */
export async function runInit(opts: InitOptions, log: (msg: string) => void = console.log): Promise<number> {
  if (!existsSync(opts.targetRepo) || !statSync(opts.targetRepo).isDirectory()) {
    log(`error: target repo "${opts.targetRepo}" is not an existing directory`);
    return 1;
  }
  const res = scaffoldWorkspace(opts.targetRepo, opts.appBaseUrl);
  for (const c of res.created) log(`  created  ${c}`);
  for (const s of res.skipped) log(`  skipped  ${s} (already exists)`);

  const ws = workspacePaths(opts.targetRepo);
  const engine = opts.engine ?? new ClaudeCodeEngine();

  try {
    const result = await engine.run({
      role: "scout",
      prompt: scoutPrompt({ targetRepo: ws.targetRepo, northStarPath: ws.northStar }),
      cwd: ws.targetRepo,
    }, () => { /* silent — the agent writes the file directly */ });

    if (result.exitCode === 0 && existsSync(ws.northStar)) {
      log(`  created  ${ws.northStar} (Scout agent)`);
    } else {
      writeFileSync(ws.northStar, fallbackNorthStar(ws.targetRepo), "utf8");
      log(`  created  ${ws.northStar} (fallback${result.exitCode !== 0 ? ` — Scout exited ${result.exitCode}` : ""})`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    writeFileSync(ws.northStar, fallbackNorthStar(ws.targetRepo), "utf8");
    log(`  created  ${ws.northStar} (fallback — ${msg})`);
  }

  log(`\nadapt workspace ready at ${opts.targetRepo}/.adapt`);
  log(`Next: copy config.example.json to config.json and edit it, then seed scenarios/.`);
  return 0;
}

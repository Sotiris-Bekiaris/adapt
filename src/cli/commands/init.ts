import { existsSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
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

/** Turn an engine spawn failure into something a first-time user can act on. */
function explainScoutFailure(msg: string): string {
  if (/ENOENT/.test(msg)) {
    return `the "claude" CLI was not found on PATH, so the Scout could not run — install Claude Code and sign in, then delete north-star.md and re-run "adapt init" to generate it`;
  }
  return msg;
}

/** Core of `adapt init`. Returns a process exit code. `log`/`err` are injected for testability. */
export async function runInit(
  opts: InitOptions,
  log: (msg: string) => void = console.log,
  err: (msg: string) => void = console.error,
): Promise<number> {
  if (!existsSync(opts.targetRepo) || !statSync(opts.targetRepo).isDirectory()) {
    err(`error: target repo "${opts.targetRepo}" is not an existing directory`);
    err(`  Pass the path to the product you want adapt to evolve:`);
    err(`    adapt init /path/to/target-repo`);
    return 1;
  }
  const isGitRepo =
    spawnSync("git", ["-C", opts.targetRepo, "rev-parse", "--git-dir"], { encoding: "utf8" }).status === 0;

  const res = scaffoldWorkspace(opts.targetRepo, opts.appBaseUrl);
  for (const c of res.created) log(`  created  ${c}`);
  for (const s of res.skipped) log(`  skipped  ${s} (already exists)`);

  const ws = workspacePaths(opts.targetRepo);
  // Deliberately NOT engineFor(config): init runs the Scout on a repo that has no .adapt/config.json
  // yet — scaffoldWorkspace() writes config.example.json and never config.json. There is no
  // engine.skipPermissions to honour here, so the Scout uses the engine's own defaults
  // (claude, --dangerously-skip-permissions). Every later command reads the config.
  const engine = opts.engine ?? new ClaudeCodeEngine();

  log(`\n  Scout: reading ${ws.targetRepo} to draft north-star.md.`);
  log(`         This runs a live agent — it can take several minutes and costs tokens.`);

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
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    writeFileSync(ws.northStar, fallbackNorthStar(ws.targetRepo), "utf8");
    log(`  created  ${ws.northStar} (fallback — ${explainScoutFailure(msg)})`);
  }

  if (!isGitRepo) {
    err(`\nwarning: ${resolve(opts.targetRepo)} is not a git repository.`);
    err(`  adapt commits every agent change into the target repo — that is the only undo you get.`);
    err(`  Run "git init" there and make one commit before starting a loop.`);
  }

  log(`\nadapt workspace ready at ${ws.root}`);
  log(`Next:`);
  log(`  1. cp ${ws.root}/config.example.json ${ws.configFile}`);
  log(`  2. edit ${ws.configFile} — set appBaseUrl and the database hooks`);
  log(`  3. review ${ws.northStar} — it is the vision every cycle steers toward`);
  log(`  4. cp ${ws.scenariosDir}/examples/example.login.md ${ws.scenariosDir}/SCN-001.md`);
  log(`     (files under examples/ are never run — only *.md directly in scenarios/)`);
  log(`  5. adapt run-scenarios ${ws.targetRepo}`);
  return 0;
}

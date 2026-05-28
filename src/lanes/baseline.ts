import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { workspacePaths } from "../workspace/paths.ts";
import { isClean, headCommit, tagBaseline, tagExists } from "./git.ts";
import type { BaselineManifest } from "./types.ts";

export interface CreateBaselineOptions {
  targetRepo: string;
  name: string;
  now?: () => string;
}

/** Core of `adapt baseline create`. Returns a process exit code. */
export function createBaseline(opts: CreateBaselineOptions, log: (msg: string) => void = console.log): number {
  const now = opts.now ?? (() => new Date().toISOString());
  const repo = opts.targetRepo;
  const tag = `adapt-baseline/${opts.name}`;

  if (tagExists(repo, tag)) {
    log(`error: baseline "${opts.name}" already exists (${tag})`);
    return 1;
  }
  if (!isClean(repo)) {
    log(`error: working tree has uncommitted changes — commit or stash before creating a baseline`);
    return 1;
  }
  const commit = headCommit(repo);
  if (!commit) {
    log(`error: ${repo} is not a git repo with at least one commit`);
    return 1;
  }
  if (!tagBaseline(repo, opts.name)) {
    log(`error: failed to create tag ${tag}`);
    return 1;
  }

  const ws = workspacePaths(repo);
  if (!existsSync(ws.baselinesDir)) mkdirSync(ws.baselinesDir, { recursive: true });
  const manifest: BaselineManifest = { name: opts.name, gitTag: tag, commit, createdAt: now() };
  const manifestPath = join(ws.baselinesDir, `${opts.name}.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  spawnSync("git", ["-C", repo, "add", manifestPath], { encoding: "utf8" });
  spawnSync("git", ["-C", repo, "commit", "-m", `chore(adapt): baseline ${opts.name}`], { encoding: "utf8" });

  log(`  created  baseline "${opts.name}" at ${commit.slice(0, 8)} (${tag})`);
  return 0;
}

/** List baselines from .adapt/baselines/. */
export function listBaselines(targetRepo: string): BaselineManifest[] {
  const ws = workspacePaths(targetRepo);
  if (!existsSync(ws.baselinesDir)) return [];
  return readdirSync(ws.baselinesDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(ws.baselinesDir, f), "utf8")) as BaselineManifest)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

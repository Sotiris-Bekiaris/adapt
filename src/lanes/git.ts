import { spawnSync } from "node:child_process";

function git(repo: string, args: string[]): { ok: boolean; stdout: string } {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  return { ok: r.status === 0, stdout: (r.stdout ?? "").trim() };
}

/** True if the working tree has no uncommitted changes. */
export function isClean(repo: string): boolean {
  const r = git(repo, ["status", "--porcelain"]);
  return r.ok && r.stdout === "";
}

/** Current HEAD commit sha, or null if not a repo / no commits. */
export function headCommit(repo: string): string | null {
  const r = git(repo, ["rev-parse", "HEAD"]);
  return r.ok ? r.stdout : null;
}

/** Create the tag adapt-baseline/<name> at HEAD. */
export function tagBaseline(repo: string, name: string): boolean {
  return git(repo, ["tag", `adapt-baseline/${name}`]).ok;
}

export function tagExists(repo: string, tag: string): boolean {
  return git(repo, ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`]).ok;
}

/** git worktree add <path> -b <branch> <startPoint>. The path must not pre-exist. */
export function addWorktree(repo: string, path: string, branch: string, startPoint: string): boolean {
  return git(repo, ["worktree", "add", path, "-b", branch, startPoint]).ok;
}

/** git worktree remove --force <path>. */
export function removeWorktree(repo: string, path: string): boolean {
  return git(repo, ["worktree", "remove", "--force", path]).ok;
}

/** git -C <worktree> reset --hard <ref>. Note: operates inside the worktree itself. */
export function resetHard(worktree: string, ref: string): boolean {
  return git(worktree, ["reset", "--hard", ref]).ok;
}

/** git branch -D <branch>. */
export function deleteBranch(repo: string, branch: string): boolean {
  return git(repo, ["branch", "-D", branch]).ok;
}

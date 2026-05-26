import { spawnSync } from "node:child_process";

/** Best-effort commit of the .adapt/ workspace in the target repo. Returns false (never throws)
 *  if the target is not a git repo or there is nothing to commit. */
export function commitWorkspace(targetRepo: string, message: string): boolean {
  const add = spawnSync("git", ["-C", targetRepo, "add", ".adapt"], { encoding: "utf8" });
  if (add.status !== 0) return false;
  const commit = spawnSync("git", ["-C", targetRepo, "commit", "-m", message], { encoding: "utf8" });
  return commit.status === 0;
}

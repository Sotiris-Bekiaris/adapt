import matter from "gray-matter";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ScenarioStatus } from "../types.ts";

/** Rewrite a scenario file's frontmatter `status` in place, preserving everything else. */
export function setScenarioStatus(scenariosDir: string, filename: string, status: ScenarioStatus): void {
  const path = join(scenariosDir, filename);
  const parsed = matter(readFileSync(path, "utf8"));
  parsed.data.status = status;
  writeFileSync(path, matter.stringify(parsed.content, parsed.data), "utf8");
}

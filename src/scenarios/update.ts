import matter from "gray-matter";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ScenarioStatus } from "../types.ts";

/** Rewrite a scenario file's frontmatter `status` in place, preserving everything else. */
export function setScenarioStatus(scenariosDir: string, filename: string, status: ScenarioStatus): void {
  const path = join(scenariosDir, filename);
  const parsed = matter(readFileSync(path, "utf8"));
  // gray-matter caches parsed results by content and returns a shallow copy whose
  // `.data` points at the cached object; clone before mutating so we never poison the cache.
  const data = { ...parsed.data, status };
  writeFileSync(path, matter.stringify(parsed.content, data), "utf8");
}

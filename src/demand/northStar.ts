import { existsSync, appendFileSync, writeFileSync } from "node:fs";
import { workspacePaths } from "../workspace/paths.ts";

/** Append-only: add a timestamped ambition section to north-star.md (creating it if absent). */
export function appendAmbition(targetRepo: string, text: string, now: () => string = () => new Date().toISOString()): void {
  const { northStar } = workspacePaths(targetRepo);
  if (!existsSync(northStar)) writeFileSync(northStar, "# North Star\n", "utf8");
  appendFileSync(northStar, `\n## Ambition ${now()}\n\n${text.trim()}\n`, "utf8");
}

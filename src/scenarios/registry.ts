import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { workspacePaths } from "../workspace/paths.ts";
import { parseScenario } from "./parse.ts";
import type { Priority, ScenarioSource, ScenarioStatus } from "../types.ts";

export interface RegistryEntry {
  id: string;
  title: string;
  filename: string;
  status: ScenarioStatus;
  priority: Priority;
  tags: string[];
  source: ScenarioSource;
  lastResult: string;
  lastRunId: string | null;
  linkedIssues: string[];
}

/** Read scenario files, validate them, and write a sorted index.json. Returns the entries. */
export function rebuildRegistry(targetRepo: string): RegistryEntry[] {
  const { scenariosDir, scenarioIndex } = workspacePaths(targetRepo);
  const entries: RegistryEntry[] = [];
  const seen = new Set<string>();

  const files = existsSync(scenariosDir)
    ? readdirSync(scenariosDir).filter((f) => f.endsWith(".md"))
    : [];

  for (const filename of files) {
    const { meta } = parseScenario(readFileSync(join(scenariosDir, filename), "utf8"), filename);
    if (seen.has(meta.id)) throw new Error(`Duplicate scenario id ${meta.id} (in ${filename})`);
    seen.add(meta.id);
    entries.push({
      id: meta.id, title: meta.title, filename, status: meta.status,
      priority: meta.priority, tags: meta.tags, source: meta.source,
      lastResult: meta.lastResult, lastRunId: meta.lastRunId, linkedIssues: meta.linkedIssues,
    });
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));
  writeFileSync(scenarioIndex, JSON.stringify(entries, null, 2) + "\n", "utf8");
  return entries;
}

/** Read the existing index.json (returns [] if it does not exist). */
export function readRegistry(targetRepo: string): RegistryEntry[] {
  const { scenarioIndex } = workspacePaths(targetRepo);
  if (!existsSync(scenarioIndex)) return [];
  return JSON.parse(readFileSync(scenarioIndex, "utf8")) as RegistryEntry[];
}

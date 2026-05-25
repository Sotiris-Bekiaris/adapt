import matter from "gray-matter";
import { ScenarioMetaSchema, type ScenarioMeta } from "./schema.ts";

export class ScenarioParseError extends Error {}

export interface ParsedScenario {
  meta: ScenarioMeta;
  body: string;
  filename: string;
}

/** Parse a scenario markdown string (YAML frontmatter + body). Validates the frontmatter. */
export function parseScenario(content: string, filename: string): ParsedScenario {
  const parsed = matter(content);
  if (!parsed.data || Object.keys(parsed.data).length === 0) {
    throw new ScenarioParseError(`${filename}: missing YAML frontmatter`);
  }
  const result = ScenarioMetaSchema.safeParse(parsed.data);
  if (!result.success) {
    const detail = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    throw new ScenarioParseError(`${filename}: invalid frontmatter — ${detail}`);
  }
  return { meta: result.data, body: parsed.content.trim(), filename };
}

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { AdaptConfigSchema } from "../config/schema.ts";
import { ScenarioMetaSchema } from "../scenarios/schema.ts";

/** Build the named JSON Schema objects. Pure — returned for testing. */
export function buildSchemas(): Record<string, any> {
  // These describe what a human writes into config.json / a scenario's frontmatter, so
  // they are generated from the *input* side of the schema: keys with defaults have to
  // show up as optional, not as required-with-a-value.
  const opts = { io: "input", target: "draft-7" } as const;

  return {
    "adapt-config.schema.json": z.toJSONSchema(AdaptConfigSchema, opts),
    "scenario-meta.schema.json": z.toJSONSchema(ScenarioMetaSchema, opts),
  };
}

/** Write the schemas to src/schemas/generated/. Invoked via `npm run schemas`. */
export function writeSchemas(): string[] {
  const outDir = resolve(dirname(fileURLToPath(import.meta.url)), "generated");
  mkdirSync(outDir, { recursive: true });
  const written: string[] = [];
  for (const [name, schema] of Object.entries(buildSchemas())) {
    const path = resolve(outDir, name);
    writeFileSync(path, JSON.stringify(schema, null, 2) + "\n", "utf8");
    written.push(path);
  }
  return written;
}

// Run directly: `npm run schemas`
if (import.meta.url === `file://${process.argv[1]}`) {
  for (const p of writeSchemas()) console.log(`wrote ${p}`);
}

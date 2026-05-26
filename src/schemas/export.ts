import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { AdaptConfigSchema } from "../config/schema.ts";
import { ScenarioMetaSchema } from "../scenarios/schema.ts";

/** Build the named JSON Schema objects. Pure — returned for testing. */
export function buildSchemas(): Record<string, any> {
  const configSchema = zodToJsonSchema(AdaptConfigSchema, "AdaptConfig");
  const scenarioSchema = zodToJsonSchema(ScenarioMetaSchema, "ScenarioMeta");

  return {
    "adapt-config.schema.json": configSchema.definitions?.AdaptConfig || configSchema,
    "scenario-meta.schema.json": scenarioSchema.definitions?.ScenarioMeta || scenarioSchema,
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

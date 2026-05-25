import { describe, it, expect } from "vitest";
import { buildSchemas } from "../../src/schemas/export.ts";

describe("buildSchemas", () => {
  it("produces JSON Schema objects for config and scenario meta", () => {
    const schemas = buildSchemas();
    expect(schemas["adapt-config.schema.json"].type).toBe("object");
    expect(schemas["scenario-meta.schema.json"].type).toBe("object");
    expect(Object.keys(schemas).length).toBeGreaterThanOrEqual(2);
  });
});

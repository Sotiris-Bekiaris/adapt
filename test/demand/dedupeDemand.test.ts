import { describe, it, expect } from "vitest";
import { demandTitleKey } from "../../src/demand/dedupeDemand.ts";

describe("demandTitleKey", () => {
  it("normalizes case and whitespace", () => {
    expect(demandTitleKey("  Add   CSV  Export ")).toBe(demandTitleKey("add csv export"));
  });
  it("differs for different titles", () => {
    expect(demandTitleKey("Add CSV export")).not.toBe(demandTitleKey("Add PDF export"));
  });
});

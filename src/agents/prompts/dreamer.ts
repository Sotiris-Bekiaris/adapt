import { z } from "zod";

export const DreamResultSchema = z.object({
  ambition: z.string().nullable().default(null),
  demands: z.array(z.object({
    title: z.string().min(1),
    rationale: z.string().default(""),
    proposedScenarios: z.array(z.string()).default([]),
  })).default([]),
});
export type DreamResult = z.infer<typeof DreamResultSchema>;

export interface DreamerPromptCtx {
  northStar: string;
  scenarioSummary: string;
  resultPath: string;
  maxDemands: number;
}

export function dreamerPrompt(ctx: DreamerPromptCtx): string {
  const { northStar, scenarioSummary, resultPath, maxDemands } = ctx;
  return `You are the Dreamer. You decide what this product should become NEXT. You may read the source code
and use the Chrome DevTools MCP to explore the running app, but you do NOT write code.

The north-star (the product's living genome) is below. The existing scenarios show what already works.

=== NORTH STAR ===
${northStar}
=== EXISTING SCENARIOS ===
${scenarioSummary}
=== END ===

Do two things:
1. AMBITION (optional): if the product has grown enough that the north-star should reach higher, propose ONE new
   ambition — a single short paragraph of new product vision to append to the genome. If nothing warrants it, use null.
   Raise the ceiling thoughtfully; do not restate existing goals.
2. DEMANDS: propose up to ${maxDemands} concrete, valuable demands — features or improvements that move the product
   toward the north-star and that a real user would notice. For each, give a title, a one-line rationale, and 1–2
   proposed user-level scenario sketches (what a user would do to exercise it). Avoid trivial or duplicate demands.

Write your result as a single JSON object to this exact path:
RESULT_FILE=${resultPath}
Shape: { "ambition": "<text>" | null, "demands": [ { "title": "...", "rationale": "...", "proposedScenarios": ["...","..."] } ] }`;
}

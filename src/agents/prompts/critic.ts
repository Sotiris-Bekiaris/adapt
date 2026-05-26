import { z } from "zod";
import type { Demand } from "../../demand/demand.ts";

export const CriticVerdictSchema = z.object({
  decision: z.enum(["approved", "rejected"]),
  critique: z.string().default(""),
});
export type CriticVerdict = z.infer<typeof CriticVerdictSchema>;

export interface CriticPromptCtx {
  demand: Demand;
  northStar: string;
  resultPath: string;
}

export function criticPrompt(ctx: CriticPromptCtx): string {
  const { demand, northStar, resultPath } = ctx;
  return `You are the Critic — a skeptical product owner. Challenge the proposed demand below. Approve it ONLY if it
is genuinely valuable, aligned with the north-star, and worth building now — not bloat, busywork, or a vanity feature.
You may read the source code but do NOT write code.

=== NORTH STAR ===
${northStar}
=== PROPOSED DEMAND ${demand.id} ===
Title: ${demand.title}
Rationale: ${demand.rationale}
Proposed scenarios: ${JSON.stringify(demand.proposedScenarios)}
=== END ===

Decide "approved" or "rejected" and give a one-paragraph critique explaining why (what's strong, what's weak, or why it's bloat).

Write your verdict as a single JSON object to this exact path:
RESULT_FILE=${resultPath}
Shape: { "decision": "approved" | "rejected", "critique": "<text>" }`;
}

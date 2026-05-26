import { z } from "zod";

export const DEMAND_STATUSES = ["proposed", "approved", "rejected"] as const;

export const DemandSchema = z.object({
  id: z.string().regex(/^DMD-\d+$/, "id must look like DMD-001"),
  title: z.string().min(1),
  rationale: z.string(),
  proposedScenarios: z.array(z.string()),
  source: z.literal("dreamer"),
  status: z.enum(DEMAND_STATUSES),
  critique: z.string().nullable(),
  createdAt: z.string(),
});

export type Demand = z.infer<typeof DemandSchema>;
export type DemandStatus = (typeof DEMAND_STATUSES)[number];

export function newDemand(args: {
  id: string; title: string; rationale: string; proposedScenarios: string[]; createdAt: string;
}): Demand {
  return {
    id: args.id, title: args.title, rationale: args.rationale,
    proposedScenarios: args.proposedScenarios, source: "dreamer",
    status: "proposed", critique: null, createdAt: args.createdAt,
  };
}

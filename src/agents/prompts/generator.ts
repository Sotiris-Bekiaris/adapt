import type { Demand } from "../../demand/demand.ts";

export interface GeneratorPromptCtx {
  demand: Demand;
  scenariosDir: string;
  assignedIds: string[];
}

export function generatorPrompt(ctx: GeneratorPromptCtx): string {
  const { demand, scenariosDir, assignedIds } = ctx;
  const idList = assignedIds.join(", ");
  return `You are the Scenario Generator. Turn the APPROVED demand below into user-level, BLACK-BOX scenarios that a
runner could later execute against the running app like a real user. You may read the source code for discovery, but
the scenarios MUST be user-centered and must not reference code, endpoints, files, or implementation details.

APPROVED DEMAND ${demand.id}: ${demand.title}
Rationale: ${demand.rationale}
Proposed scenarios: ${JSON.stringify(demand.proposedScenarios)}

Write between 1 and ${assignedIds.length} scenario files (only as many as the demand genuinely needs) into the
directory: ${scenariosDir}
Use these assigned IDs in order, lowest first — filename is "<id>.md": ${idList}

Each file MUST be valid scenario markdown with this exact YAML frontmatter shape (use the assigned id):
---
id: <assigned id, e.g. ${assignedIds[0]}>
title: <short user-facing title>
status: ready
priority: medium
persona: <who the user is>
tags: [<area>]
source: agent-discovered
hooks:
  setup: <shell command that seeds the data this scenario assumes, or omit the whole hooks block>
  teardown: <shell command that cleans that data, or omit>
---
# Scenario
<As the persona, do X and verify the visible outcome Y.>

## Steps
1. ...

## Expected outcome
- <a visible, user-observable success condition>

SEED DATA — CRITICAL: The runner is a black-box browser user with NO repo access; it cannot create data itself.
If your scenario depends on data existing BEFORE the user acts (a specific account to log in as, pre-existing
records, a particular app state), you MUST emit a "hooks.setup" command that seeds EXACTLY that data into the
isolated test database, plus a "hooks.teardown" that cleans it. Discover the project's own seed tooling (you may
read the source to find it — e.g. a seed script, migration, or fixture loader). Never reference a user or record
your setup hook does not create. If the scenario genuinely needs no pre-existing data (e.g. a fresh signup from an
empty state), OMIT the entire "hooks" block.

Do NOT invent extra files or use IDs other than the assigned ones. Write the files before finishing.`;
}

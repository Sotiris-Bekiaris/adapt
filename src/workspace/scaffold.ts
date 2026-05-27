import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { workspacePaths } from "./paths.ts";
import { defaultConfig } from "../config/schema.ts";

export interface ScaffoldResult {
  created: string[];
  skipped: string[];
}

const EXAMPLE_SCENARIO = `---
id: SCN-001
title: A user can log in
status: ready
priority: high
persona: Returning user
tags: [auth, smoke]
source: human-seeded
hooks:
  setup: echo "seed the isolated test DB here"
  teardown: echo "reset the isolated test DB here"
---

# Scenario

As a returning user, log in with valid credentials and land on the home page.

## Preconditions

- A test account exists in the isolated agent database.

## Steps

1. Open the login page.
2. Enter valid credentials.
3. Submit.

## Expected outcome

- The user lands on the authenticated home page.
- No validation error, server error, or uncaught browser error appears.

## Failure signals

- The submit button does nothing.
- A visible error appears.
- The browser console shows an uncaught error.
`;

function ensureDir(path: string, res: ScaffoldResult) {
  if (existsSync(path)) { res.skipped.push(path); return; }
  mkdirSync(path, { recursive: true });
  res.created.push(path);
}

function writeIfAbsent(path: string, content: string, res: ScaffoldResult) {
  if (existsSync(path)) { res.skipped.push(path); return; }
  writeFileSync(path, content, "utf8");
  res.created.push(path);
}

/** Create the .adapt/ workspace. Idempotent; never overwrites existing files. */
export function scaffoldWorkspace(targetRepo: string, appBaseUrl: string): ScaffoldResult {
  const p = workspacePaths(targetRepo);
  const res: ScaffoldResult = { created: [], skipped: [] };

  for (const d of [p.root, p.scenariosDir, p.runsDir, p.workItemsDir, p.verificationReportsDir, p.decisionLogDir]) {
    ensureDir(d, res);
  }
  const examplesDir = `${p.scenariosDir}/examples`;
  ensureDir(examplesDir, res);

  writeIfAbsent(`${p.root}/config.example.json`,
    JSON.stringify(defaultConfig(p.targetRepo, appBaseUrl), null, 2) + "\n", res);
  writeIfAbsent(`${examplesDir}/example.login.md`, EXAMPLE_SCENARIO, res);

  return res;
}

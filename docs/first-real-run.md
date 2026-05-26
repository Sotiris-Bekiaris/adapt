# adapt — First Real Run

Phase 1 is fully stub-tested. This runbook is how you prove the loop against a *real* full-stack app
with real Claude Code + Playwright + Jira. Do this on a throwaway branch of a real product.

## Prerequisites
- `claude` CLI installed and authenticated (the headless engine).
- Playwright MCP (`@playwright/mcp`) and (optional) Jira MCP available to your `claude` setup.
- The target app runnable locally; note its base URL and start command.

## Steps
1. Plug in: `adapt init /path/to/app --app-base-url http://localhost:3000`
2. Copy `/path/to/app/.adapt/config.example.json` → `config.json`; set:
   - `engine.type: "claude-code"`
   - `appBaseUrl`, `startCommand`
   - `hooks.setup` / `hooks.teardown` pointing at an **isolated test database** reset/seed
   - `mcp.playwright.enabled: true`; for Jira: `mcp.jira.enabled: true`, `jira.projectKey`, transitions
3. Add `/.adapt/state.db*` to the app repo's `.gitignore`.
4. Seed 1–3 real scenarios in `.adapt/scenarios/` (delete the example).
5. Start the app. In another terminal: `adapt run-scenarios /path/to/app` — confirm the RunRecords in
   `.adapt/scenario-runs/` reflect reality (a real pass passes; introduce a known bug and confirm it fails).
6. `adapt triage-failures /path/to/app` — confirm a sensible, deduplicated work-item (and Jira issue if enabled).
7. `adapt orchestrate /path/to/app` — watch one full pass; open `adapt console` alongside to watch live.
8. Inspect: the fix branch `adapt/ITEM-xxx`, the work-item status, the decision log, and (if enabled) the Jira issue.

## What success looks like (blueprint §17)
The system discovers a real user-visible breakage, files a clear work-item, an agent fixes it on a branch,
and an *independent* agent confirms the original scenario now passes — with a decision log clear enough to
reconstruct every step.

## If the oracle is unreliable
This is the expected place to discover it. Tighten scenario "expected outcome" wording, add API-level
assertions to scenarios where the UI can't reveal truth, and prefer gross-failure detection over subtle
correctness — exactly as the blueprint (§5) warns.

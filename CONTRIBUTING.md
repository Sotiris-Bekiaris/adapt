# Contributing to adapt

adapt is an experimental personal research project: a closed-loop multi-agent system that tries to
evolve a software product on its own. It is not a product, it has no roadmap commitments, and it is
not published to npm. Contributions are welcome on those terms.

The most useful contributions, in order:

1. **Bug reports with a reproduction** — especially portability bugs (Linux, Windows, non-macOS
   `sed`, Node versions) and anything where the CLI's output misleads you.
2. **Documentation corrections** — if a documented flag, config key, or default does not match the
   code, that is a real defect. Say which file and line disagrees.
3. **Small, focused fixes** with a test.

Larger feature work should start as a GitHub issue (use the *Idea / design proposal* template) before
you write code. This repo is built spec-first; a PR that arrives without a shared understanding of the
design is likely to be declined even if the code is good.

---

## Setup

```bash
git clone https://github.com/Sotiris-Bekiaris/adapt.git
cd adapt
npm ci
```

- **Node 20 or 22.** CI runs both; `.nvmrc` pins 22, which is what the maintainer develops on.
- **No build step.** Everything runs from TypeScript through [tsx](https://github.com/privatenumber/tsx);
  `tsc` is only ever used with `--noEmit` for typechecking. There is no `dist/`.
- **`better-sqlite3` is a native module.** `npm ci` downloads a prebuilt binary for your Node ABI, or
  compiles one if none matches — that is why installs occasionally need a C++ toolchain.
- Run the CLI without installing anything globally:
  ```bash
  npm run adapt -- --help
  npm run adapt -- init /path/to/target-repo
  ```
  `npm link` puts an `adapt` binary on your PATH pointing at `bin/adapt.mjs` in this checkout
  (it re-execs `npx tsx src/cli/index.ts`, so the clone has to stay where it is).
  `npm unlink -g adapt` reverses it. `npm i -g adapt` does not work — the package is deliberately
  `"private": true`.

## The gate

Every PR must leave these three green:

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run schemas     # regenerates src/schemas/generated/*.json — must produce no git diff
```

`npm run check` runs the first two together locally; CI (`.github/workflows/ci.yml`) runs all three as
separate steps on Node 20 and 22.

The suite is 68 files and runs in a few seconds. If your change lowers the test count, say why in the
PR description.

`npm run schemas` writes `src/schemas/generated/adapt-config.schema.json` and
`scenario-meta.schema.json` from the zod definitions. Those files are committed, so **any edit to
`src/config/schema.ts` or `src/scenarios/schema.ts` must be followed by `npm run schemas` and the
regenerated JSON committed in the same change.** CI fails if regenerating produces a diff.

`npm run test:watch` is the loop to develop in.

## Repository layout

| Path | What lives there |
| --- | --- |
| `src/cli/index.ts` | The commander program — one `.command()` block per CLI command |
| `src/cli/commands/` | One module per command, each exporting a pure-ish `…Cmd(opts, log)` core |
| `src/config/` | zod `AdaptConfigSchema` + the loader that produces friendly validation errors |
| `src/workspace/` | `.adapt/` path resolution and the idempotent scaffolder |
| `src/scenarios/` | Scenario markdown parsing, frontmatter schema, registry, status rewrites |
| `src/orchestrator/` | The deterministic state machine: lifecycles, transitions, SQLite store, run ledger, `cycle`/`evolve`/`run`, triage, repair, graduation, git + hook helpers |
| `src/agents/prompts/` | One file per agent role — the prompt text *and* the zod schema of its result file |
| `src/agents/runRole.ts` | Runs an agent, then reads and validates the JSON result file it was told to write |
| `src/engine/` | `AgentEngine` interface, the Claude Code headless adapter, the deterministic `StubEngine`, the stream-json parser, MCP server selection |
| `src/demand/` | The demand engine: dreamer → critic → generator, demand store, dedup, north-star appends |
| `src/lanes/` | Baselines (git tags), lanes (git worktrees), port allocation, loop supervision, the control file |
| `src/observability/` | Event bus, NDJSON decision log, the single-run console server, the multi-lane monitor, and the vanilla-JS UIs under `public/` |
| `src/schemas/` | JSON Schema export + the committed generated output |
| `src/types.ts` | The shared lifecycle enums (scenario / run / work-item statuses) |
| `docs/superpowers/specs/` | Design specs, one per phase. `2026-05-25-adapt-design.md` is *the* blueprint — source comments cite it as "blueprint §N" |
| `docs/superpowers/plans/` | The per-phase implementation plans those specs were built from |

`test/` mirrors `src/` one-to-one: `src/orchestrator/cycle.ts` is tested by
`test/orchestrator/cycle.test.ts`.

[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) walks the same map in prose, and
[docs/README.md](./docs/README.md) indexes the specs and plans.

### Two invariants you must not break

1. **Agents communicate only through files validated by zod schemas.** An agent is told
   `RESULT_FILE=<path>` in its prompt; `runRole()` deletes any stale file first, runs the agent, then
   parses and validates what appeared. There is no parsing of an agent's free text into control flow.
2. **The orchestrator is deterministic code, never an LLM.** Status transitions come from the tables
   in `src/orchestrator/lifecycles.ts` and are enforced by `stateMachine.ts`. An agent proposes; the
   orchestrator decides.

## Where to add things

**A new CLI command.** Add `src/cli/commands/<name>.ts` exporting a core function that takes an
options object and an injected `log` sink (`log: (msg: string) => void = console.log`) and returns an
exit code — that injection is what makes the command testable. Then wire a `.command()` block in
`src/cli/index.ts` using a dynamic `await import(...)` for the module, matching the existing commands
(this keeps CLI startup cheap). Add `test/cli/<name>.test.ts` that calls the core with a collecting
`log` and asserts on the collected lines.

**A new agent role.** Add `src/agents/prompts/<role>.ts` exporting both a `…Prompt(opts): string`
builder and a `…ResultSchema` zod schema for the JSON the agent must write. Add the role name to
`RoleName` and give it MCP servers in `src/engine/mcp.ts` (black-box roles get `playwright`,
white-box roles get `chrome-devtools`, and only triage/implementation/verification ever get `jira`).
Call it through `runRole()`. **A prompt change without a matching test under `test/agents/` will not
be merged** — see below.

**New orchestrator state.** Add the status to the right `const` array in `src/types.ts`, then add the
transition edges to the matching table in `src/orchestrator/lifecycles.ts`. Both are covered by
`test/orchestrator/lifecycles.test.ts` and `stateMachine.test.ts`; extend them.

**A new config key.** Add it to `src/config/schema.ts` with a default, run `npm run schemas`, commit
the regenerated JSON, and document the key in the README's configuration reference. A key that no
source file reads is worse than no key at all — `engine.skipPermissions` shipped in the schema with
no call site reading it, so setting it to `false` silently did nothing and SECURITY.md had to
document the gap. It is wired up now; do not add the next one. If a key is genuinely reserved for
future work, say so explicitly in its description and list it under "Good first areas" below.

Two defaults to keep in mind while you work, because they decide which code path a default run
takes:

- `engine.skipPermissions` defaults to `true` — agents get `--dangerously-skip-permissions`. The
  commands that construct `ClaudeCodeEngine` pass the configured value through, so `false` really
  does withhold the flag. It is rarely what you want for an unattended loop (an agent that has to
  ask cannot run at 3am), but it is a real control and it must stay one.
- `mcp.jira.enabled` defaults to `false`, and it is the single gate. Work-items live in
  `<target>/.adapt/work-items/` through `LocalTracker` (`src/tracker/localTracker.ts`) either way;
  enabling Jira additionally hands the `jira` MCP server to triage, implementation, and verification
  so those agents mirror into a real tracker. `mcp-atlassian` and Jira Server/DC are both publicly
  available, but requiring a running Jira just to try adapt is too much, so it is opt-in.

## The project page (`readme.html`)

`readme.html` is the project's landing page, published to GitHub Pages by
`.github/workflows/pages.yml` on every push to `main` (copied into the site as `index.html`;
`story.html`, the interactive walkthrough, ships alongside it). Neither file is generated: both are
hand-written HTML with inline CSS, no build step, and no local assets.

That means they drift. The rule:

- **README.md is the source of truth.** Every fact — flag names, config keys, defaults, what a
  command prints, what the loop does — is settled there.
- **A factual change to README.md that also appears in `readme.html` must be mirrored by hand, in
  the same PR.** Nothing checks this for you; CI does not read either HTML file.
- Wording, layout, and marketing framing in `readme.html` are free to differ. Facts are not.

If you are only fixing prose in `readme.html`, say so in the PR title so it is obvious no code
claim moved.

## Testing conventions

Read `test/orchestrator/cycle.test.ts` and `test/agents/triagePrompt.test.ts` before writing your
first test; they are the two shapes everything else follows.

- **vitest, explicit imports.** `globals: false` — always
  `import { describe, it, expect } from "vitest"`. Imports of source use the `.ts` extension
  (`../../src/orchestrator/cycle.ts`), which is what `allowImportingTsExtensions` + tsx makes work.
- **Real filesystem, throwaway directories.** Use `makeTmpDir()` / `cleanupTmp()` from
  `test/helpers/tmp.ts` with an `afterEach` that cleans up. Tests write real `.adapt/` trees and real
  scenario markdown rather than mocking `fs`.
- **SQLite in memory.** `new StateStore(":memory:")` for anything that touches orchestrator state.
- **Never call a live model.** Agent behaviour is tested against `StubEngine`
  (`src/engine/stubEngine.ts`). You give it a `script: (spec) => AgentEvent[]` that branches on
  `spec.role`, pulls the target path out of the prompt with `spec.prompt.match(/RESULT_FILE=(.+)/)`,
  writes the fixture JSON the real agent would have written, and returns an `agent.exit` event. That
  is how the whole validate → triage → repair → verify spine is tested end to end with no API key,
  no browser, and no network. A test that requires the `claude` CLI will be rejected.
- **Prompt tests assert on content, not wording.** The pattern in `test/agents/` is: parse a
  representative payload with the result schema and assert the defaults; then build the prompt and
  assert it contains the evidence the agent needs, the literal `RESULT_FILE=<path>` contract, and the
  role's boundary rules (e.g. triage's prompt omits Jira instructions when `jiraEnabled` is false).
  Jira is off by default, so `jiraEnabled: false` is the path most real runs take — cover it, not
  only the enabled one. Assert on the facts the agent must be told — do not pin exact sentences, or every prose edit breaks
  the suite.
- **Prompt changes need a test.** Agent prompts *are* the behaviour of this system, and they are the
  one part that no typechecker protects. Any edit under `src/agents/prompts/` must come with a
  matching assertion in `test/agents/` covering what you changed. If you removed a constraint from a
  prompt, the PR must explain why removing it is safe.
- Tests bind real ports on 127.0.0.1 (`test/observability/server.test.ts`) and spawn real `git`
  (`test/orchestrator/git.test.ts`, which configures its own local `user.name`/`user.email`). Keep
  new tests hermetic in the same way — no shared global state, no reliance on the developer's git
  config, no fixed port numbers.

## Style

There is no linter or formatter in the repo; style is held by convention and reviewed by hand:

- Double quotes, semicolons, 2-space indent, ESM only.
- `.ts` extensions on relative imports, `node:` prefix on builtins.
- `import type { … }` for type-only imports.
- Strict TypeScript with `noUncheckedIndexedAccess` — indexed access is `T | undefined` and you must
  handle it. `!` is used sparingly in tests where the fixture guarantees presence; avoid it in `src/`.
- Comments explain *why*, not *what*. The codebase has a lot of these and they are load-bearing —
  when you change the code under one, update it.
- No new runtime dependency without justification in the PR description. The dependency list is
  deliberately six packages long.

## Commits and PRs

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/), as the history
shows:

```
feat(orchestrator): runCycle — bounded validate/triage/repair/verify pass
fix(monitor): step status from exit code, not benign stderr
test: harden demandStage critic stub against corpus over-match
docs(lanes): implementation plan + spec precedence refinement for lane controls
chore: prepare repository for open-source release
```

Scopes in use: `cli`, `config`, `workspace`, `scenarios`, `orchestrator`, `agents`, `engine`,
`demand`, `tracker`, `lanes`, `observability`, `monitor`, `mcp`, `run`, `init`, `schemas`, `test`,
`docs`. Use one that already exists unless you are genuinely adding a new area.

A good PR here:

- does one thing, and its title says which;
- keeps `npm run typecheck`, `npm test`, and a diff-free `npm run schemas` green;
- adds or updates tests in the mirrored `test/` path;
- updates the README if it changed a CLI flag, a config key, or a documented default, and mirrors
  that fact into `readme.html` if it appears there;
- contains no secrets, no absolute local paths, and no `.adapt/` artifacts or `state.db` files.

### Rules a PR must not break

These come from the safeguards the system is designed around. They apply to human contributors for
the same reason they apply to the agents:

- The agent that implements a fix never verifies it. Do not collapse those two roles.
- Do not weaken a scenario's expected outcome to make a failure pass.
- Do not delete or downgrade passing scenarios to make a run look green.
- Do not add a human approval step inside the autonomous loop — the loop is the experiment.
- Do not commit anything into `.adapt/` in this repo. `.adapt/` is generated output that lives inside
  a *target* repo, never source here.

## Good first areas

- **Reserved config keys.** `startCommand` and `limits.maxCycleSeconds` are declared in
  `src/config/schema.ts` and read by nothing. Implementing either — starting the target app and
  waiting for `appBaseUrl` to answer, or aborting a cycle that exceeds its budget — is a contained,
  well-specified piece of work with an obvious test.
- **CLI diagnostics.** Every failure path is a chance to say what to do next instead of only what
  went wrong. Empty-state hints that print a command you can paste are always welcome.
- **Docs/code drift.** Pick a config key or a documented flag, grep for it in `src/`, and confirm the
  README describes what the code actually does. Each mismatch found is a real fix.
- **Test coverage of the lanes layer.** `src/lanes/` has the thinnest suite in the repo (`test/lanes/`
  covers `control` and `loop` only) and is the code most likely to destroy someone's work if it is
  wrong. `baseline.ts` and `lane.ts` in particular have no direct tests.
- **Windows.** Nothing here is inherently POSIX-only, but nothing has been tested there either.
  `npx.cmd` handling already exists in `src/engine/claudeCode.ts`; the rest — worktree paths, shell
  hooks, the `scripts/` launchers — is unexplored.
- **Portability of `scripts/`.** The launchers assume `curl`, `pgrep`, `nohup`, and a POSIX shell.
  Reports from other distributions and shells are useful even without a patch.

## Reporting security issues

Do not open a public issue. See [SECURITY.md](./SECURITY.md).

## Code of conduct

Participation is governed by the [Contributor Covenant](./CODE_OF_CONDUCT.md).

## Licence

By contributing you agree that your contributions are licensed under the MIT Licence, the same terms
as the rest of the project.

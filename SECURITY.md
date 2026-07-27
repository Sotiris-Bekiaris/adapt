# Security Policy

adapt is an experimental personal research project. It is distributed as source via `git clone`, not
published to npm, and has no release channel, no supported-version matrix, and no service behind it.
Only the current `main` branch is maintained; there are no backports.

## Reporting a vulnerability

**Do not open a public issue for anything exploitable.**

Report privately through GitHub Security Advisories:

**https://github.com/Sotiris-Bekiaris/adapt/security/advisories/new**

Please include the commit SHA you tested, the config that reproduces it, and what an attacker gains.
A proof of concept is worth more than a description.

Response is best effort by one person in their own time — there is no SLA and no bounty. You will get
an acknowledgement and an honest answer about whether and when it will be fixed. If a report is
accepted and fixed, you will be credited in the advisory unless you ask not to be.

---

## Security model

Read this before you point adapt at anything you care about. Most of what follows is deliberate
design, not oversight — but it means adapt is **not a sandbox** and must not be treated as one.

### adapt trusts the target repository completely

The target repo supplies `.adapt/config.json`, and adapt executes what it finds there:

- `hooks.setup` and `hooks.teardown` run as shell commands before and after every scenario
  (`src/orchestrator/hooks.ts` — `spawnSync(cmd, { cwd, shell: true })`).
- `environment.up`, `environment.down`, and `environment.reset` run as shell commands during
  `lane create`, `lane reset`, and `lane destroy` (`src/lanes/lane.ts` — `runEnvCommand`, also
  `shell: true`, with `stdio: "inherit"`).

Running `adapt` against a repository you did not write is equivalent to running that repository's
shell scripts on your machine. Treat a target repo's `.adapt/config.json` as executable code.

### Agents run with permission prompts disabled by default

`engine.skipPermissions` defaults to `true` (`src/config/schema.ts`), and `ClaudeCodeEngine` appends
`--dangerously-skip-permissions` to every `claude` invocation when it is set
(`src/engine/claudeCode.ts`). In that mode an agent edits files, runs arbitrary shell commands,
installs packages, and commits — inside the target repo and with your user's privileges — with no
approval step. This is the point of the project — an autonomous loop cannot ask for permission at
3am — but it is also the single largest risk.

Setting `"skipPermissions": false` under `engine` in `.adapt/config.json` genuinely withholds the
flag. Every command that drives agents builds its engine through `engineFor()`
(`src/cli/commands/engineFor.ts`), which passes the configured value into the engine. Two limits on
that control, both worth knowing before you rely on it:

- **It is not useful unattended.** Claude Code will stop and wait for an answer nobody is there to
  give, so a long `adapt run` stalls rather than proceeding safely. Treat it as a way to watch a
  single supervised cycle, not as a hardening setting for the loop.
- **`adapt init` is not covered.** It launches the Scout agent to draft `.adapt/north-star.md`
  before any config exists — `scaffoldWorkspace()` writes `config.example.json`, never
  `config.json` — so that first invocation uses the engine's own defaults and skips permissions
  regardless (`src/cli/commands/init.ts`).

Isolation, not this flag, remains the control that matters. Point adapt at a throwaway repo, a
dedicated branch, or a lane worktree, never at a working tree you cannot afford to lose.

### Prompt injection from the target repo and the app under test is a real risk class

Every agent reads untrusted content and acts on it with the privileges above:

- The Scout reads the whole target repository at `init` time.
- The Runner and Verification agents drive a browser against the running app and read whatever the
  app renders.
- Triage, Implementation, and Graduation read source files and live DOM/console/network output.
- The Dreamer and Generator explore the app and write new scenario files from what they find.

Text planted in a source file, a README, a database row, or a rendered page is model input. A
successful injection inherits the agent's full permissions. The structural mitigations that exist are
architectural, not adversarial: agents return results only as JSON files validated by zod schemas
(`src/agents/runRole.ts`), the orchestrator's state transitions are deterministic code rather than
model output (`src/orchestrator/lifecycles.ts`), and each role gets only the MCP servers its job
needs (`src/engine/mcp.ts`). None of that constrains what an agent can do with a shell.

### The console and the monitor are unauthenticated

`adapt console` (`src/observability/server.ts`) and `adapt monitor`
(`src/observability/monitorServer.ts`) both `listen(port, "127.0.0.1")` — loopback only, by design.
Neither has any authentication, authorization, CSRF protection, or origin check on its WebSocket.

The monitor is not read-only. Its `/ws` endpoint accepts `control` frames — `start`, `stop`,
`restart`, `pause`, `continue`, plus a `maxCycles` value — and applies them to lanes by spawning and
killing loop processes and writing `.adapt/control.json` (`src/observability/monitor.ts`). Anything
that can reach that port can start or stop autonomous agent loops on your machine.

Consequences to take seriously:

- Any local process, and any other user on a shared machine, can drive the monitor.
- Any web page you visit can have your browser open a WebSocket to `ws://127.0.0.1:4500/ws` and send
  control frames — loopback binding does not stop a browser you are driving.
- **Never port-forward, tunnel, or reverse-proxy the console or the monitor.** There is nothing
  behind them.

### Destructive git operations

Lanes are git worktrees and adapt manages them destructively:

- `adapt lane reset` runs `git reset --hard adapt-baseline/<name>` inside the lane worktree, then
  deletes the lane's `state.db*`, then runs `environment.reset` (`src/lanes/lane.ts`,
  `src/lanes/git.ts`). Uncommitted *and* committed lane work is gone.
- `adapt lane destroy` runs `environment.down`, then `git worktree remove --force`, then
  `git branch -D` on the lane branch.
- The evolve/run loop commits into the target repo on its own (`commitWorkspace` in
  `src/orchestrator/git.ts` runs `git add .adapt && git commit` every cycle), and repair work happens
  on `adapt/<ITEM-ID>` branches.

`reset` and `destroy` print exactly what they will destroy and prompt for confirmation on a TTY;
`--yes` skips the prompt, and a non-interactive caller that omits `--yes` aborts without touching
anything (`src/cli/index.ts`). Nothing else is an undo, so the target must be a git repository with a
history you are willing to have rewritten.

Note that committing a *product* change is the Implementation agent's job, instructed by its prompt
(`src/agents/prompts/implementation.ts`) — adapt does not create the branch, make the commit, or
verify that either happened. Only the `.adapt/` workspace commit is made by code.

### Credentials

Jira is off by default — `mcp.jira.enabled` is `false`
(`src/config/schema.ts`), so out of the box no credential of any kind is handed to an agent and
work-items stay in `<target>/.adapt/work-items/` (`src/tracker/localTracker.ts`). Everything in this
section applies once you opt in.

Credentials are supplied through the environment, never through config files. `scripts/deepseek.env`
and `scripts/jira.env` are gitignored; commit only the `.example` files, which contain variable names
and obvious placeholders (`sk-xxxx…`, `https://your-jira.example.com`) — never a real value. `src/engine/claudeCode.ts` forwards a fixed allowlist of `JIRA_*` /
`CONFLUENCE_*` variables to the `mcp-atlassian` MCP server, and deliberately suppresses the Cloud
basic-auth variables when a Personal Access Token is set, so an ambient token exported for another
tool cannot hijack a self-hosted run.

Two exposures worth knowing about, both inherent to how Claude Code is invoked:

- **Jira credentials are passed on the command line.** With Jira enabled they are embedded in the
  `--mcp-config` JSON argument to `claude`, so they are visible to anything that can read the
  process table (`ps`) while an agent runs.
- **Full agent prompts are written to disk.** The `agent.start` event carries the prompt, and the
  decision log appends every event verbatim to `<target>/.adapt/decision-log/<date>.ndjson`
  (`src/observability/decisionLog.ts`). Agent output, scenario evidence, and anything an agent read
  and echoed also land there. Scrub decision logs, `.adapt/scenario-runs/` records, and console
  output before attaching them to an issue.

## Out of scope

These are documented design decisions, not vulnerabilities. Reports about them will be closed with a
pointer back to this file:

- Agents executing arbitrary commands, editing files, or committing with permission prompts skipped
  at the default `engine.skipPermissions: true`.
- Execution of `hooks.*` and `environment.*` shell commands defined by the target repo's own config.
- `git reset --hard`, `git worktree remove --force`, and `git branch -D` on lanes.
- The console and monitor having no authentication when bound to loopback.
- Damage caused by pointing adapt at a repository or database you cared about.

## In scope

- Any path that binds the console or monitor to an interface other than `127.0.0.1`, or that lets a
  remote origin reach the control WebSocket.
- Any write outside the target repo's `.adapt/` directory and the configured lanes root — path
  traversal in the static file handlers, in workspace path resolution, or via a lane id.
- Credential leakage beyond what is described above: secrets reaching an unexpected file, a network
  destination, or an agent that should not have them (for example, Jira credentials reaching a role
  that `src/engine/mcp.ts` does not grant the `jira` server).
- Prompt-injection paths that escalate an agent past its role's declared boundary — for example, a
  role given only `chrome-devtools` obtaining Jira write access, or an agent's result file bypassing
  zod validation in `runRole()` to drive an invalid state transition.
- Anything in the repo that would execute code on a contributor's machine at clone, install, or test
  time.

## Hardening for operators

- Use a disposable target repository and a disposable database. Never a production DSN in
  `hooks.setup`.
- Run against a lane worktree rather than your main checkout, so `lane reset` is the blast radius.
- Set `run.maxCycles` and `run.maxWallClockSeconds` before any unattended run; both default to `null`
  (unbounded).
- Leave `mcp.jira.enabled` at its default `false` unless you actually want agents writing to a
  tracker; enabling it puts credentials on the `claude` command line.
- `engine.skipPermissions: false` is a real control, but it only helps if you are sitting there to
  answer the prompts. Do not set it and then walk away from `adapt run` — use an isolated target
  instead.
- Keep the console and monitor on loopback. Close the browser tab when you are done watching.
- Review `.adapt/decision-log/` before sharing it.

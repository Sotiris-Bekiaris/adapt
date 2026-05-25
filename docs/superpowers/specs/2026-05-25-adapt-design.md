# adapt — Design Blueprint

**adapt** = **A**gent **D**evelopment for **A**utonomous **P**roduc**T**s

**Date:** 2026-05-25
**Status:** Design / brainstorming output. **Build sequence decided: Phase A** (§15). **adapt is a generic, plug-and-play framework** — no target logic in this repo (§4 principle 9, §10). Remaining open items are operational (§18). Not yet approved for implementation.
**Methodology name:** Scenario-Driven Agentic Development (SDAD)

---

## 1. One-paragraph summary

adapt is an experiment in a **fully autonomous, closed-loop multi-agent system that evolves a software product with no human in the loop**. A team of cooperating agents continuously *dreams up* what the product should become, expresses each ambition as user-level **scenarios**, validates those scenarios against the running product like a real user, converts real failures into tracked work, implements the changes, and independently re-verifies the original scenario before considering it done. There is **no success state** — success *is* the continued, perpetual evolution of the product. The human is the **observer/experimenter outside the loop**, not an approver inside it. The primary deliverable of the experiment is the ability to *watch and understand* how the agents decide.

## 2. Why this exists / what we're actually testing

This is a personal research project with a budget, pointed at a separate personal product. The question being investigated:

> Can a closed loop of existing coding agents, given a north-star and the ability to raise it, autonomously decide what to build, what to fix, and what to add — and actually evolve a real product over many cycles without a human in the loop — *and can we observe how it makes those decisions?*

The metaphor is an **organism adapting to environmental pressure**. If the experiment works, the longer-term vision is "autonomous products that evolve like organisms adapting to demand."

## 3. What "self-improving" means here (and what it does NOT mean)

- **It means:** the *product repository* improves over time autonomously — features get added, bugs get fixed, the north-star is raised, quality and coverage grow.
- **It does NOT mean:** the agents rewrite their own prompts or modify their own behavior. **The agents are static.** Only the product (code, scenarios, tests, north-star) evolves.

Explicitly forbidden forms of "self-improvement":
- Agents silently editing their own prompts/instructions.
- Agents lowering pass criteria or weakening scenarios to get green results.
- Agents closing their own bugs / approving their own fixes.
- Agents deleting scenarios that fail too often to make red go away.

## 4. Core principles (the constitution)

1. **The scenario is the contract.** Not the code, not the issue, not the agent's memory, not the current UI behavior. A scenario describes a real user goal + the visible outcome that proves it.
2. **Reality is the judge.** A change is "done" only when an *independent* agent confirms the scenario passes against the *running* product in a real browser — never because the agent that did the work says so.
3. **Durable artifacts over agent memory.** Agents communicate through versioned files and tracked work items, not conversational memory. Agent messages are disposable; artifacts are authoritative.
4. **No human in the loop; human as observer.** Human judgment is replaced by *structural* safeguards (independent verification, adversarial critique, attempt limits), not approval gates.
5. **Git is the safety net.** Every agent change is a commit on a branch *in the target repo* (not adapt's). The organism cannot destroy work; its entire evolutionary history (code *and* ambition) is replayable and revertible.
6. **Separation of powers by permission.** Different agents have deliberately different knowledge and tools so the loop can't self-approve its mistakes (see §7 permissions table).
7. **Observability is a first-class subsystem**, not a log file (see §11).
8. **Demand must have a source.** Autonomy without pressure is drift. The Dreamer+Critic pair (§6, §8) is the engine that creates pressure.
9. **adapt is generic and plug-and-play.** No target-product logic lives in the adapt repo. A target is described entirely through configuration + hook commands; adapt becomes target-specific only *at runtime*, by reading the plugged project's source, UI, and config (§10). The same adapt install can be pointed at any full-stack project.

## 5. Honest value proposition & known limitations

We go in clear-eyed about these, because the experiment's value depends on seeing them play out:

- **The oracle problem (the core risk).** LLM black-box judgment is *reliable for gross failures* (500s, blank pages, console exceptions, dead buttons, broken flows) and *unreliable for subtle correctness* (wrong sort order, off-by-one totals, almost-right values). The system will be strong at finding/fixing **breakages** and weaker at catching **subtle wrongness**. Mitigation: optional API-level assertions when the UI can't reveal truth (e.g. "did it actually persist?"), and graduation to deterministic tests (§10).
- **Self-consistency vs. user-correctness.** If expected outcomes are derived only from the running app + code, the loop converges on "the app does what the app does." The **north-star doc + Dreamer/Critic** are the external pressure that pushes toward user value rather than mere self-consistency.
- **Drift & reward-hacking.** The Dreamer (an agent inventing its own goals) is the single highest-risk component. Defenses: adversarial Critic, reality-grounded verification, versioned north-star, attempt limits.
- **Compounding error over many cycles.** Autonomous changes build on possibly-imperfect prior changes; architectural rot can accumulate with no human to catch it. The experiment will surface how badly/slowly this happens. Git history makes it diagnosable and revertible.
- **Cost & time.** Each cycle spins up multiple premium coding agents and minutes-per-scenario browser runs. At scale this is hours and real money per loop. The deterministic-test graduation (§10) is the pressure valve.

## 6. Agents (roles)

Seven agent roles + the orchestrator. All are instances of an existing coding-agent engine (default: **Claude Code, run headless**) launched by the orchestrator with a specific prompt, working directory, and MCP server set.

1. **Dreamer** — reads the north-star + current product state and proposes the next ambition: new features, raised goals, value-adding improvements. Output: candidate demands. *Highest drift risk; constrained by the Critic and by reality-grounded verification.*
2. **Critic** — plays a skeptical product owner. Challenges each candidate demand: real value or bloat/busywork/reward-hacking? Only survivors enter the backlog. This is the structural substitute for human product judgment.
3. **Scenario Generator** — source-aware. Inspects the repo (and the running app via MCP) to turn approved demands + existing product into **user-centered, black-box scenarios** with stable IDs, personas, preconditions, steps, expected outcomes, failure signals, tags, priority. Uses code only for *discovery*; must not leak implementation detail or write API-level steps (unless the product is itself an API).
4. **Scenario Runner** — black-box. **No source access.** Executes scenarios against the running app via Playwright MCP, behaving like a user. Classifies each run: `passed | failed | blocked | flaky | invalid | inconclusive`. Captures evidence (screenshots, DOM/a11y snapshot, console errors, network errors, URL, failing step). Does **not** create work items directly.
5. **Failure Triage** — reads failed/blocked/flaky/invalid/inconclusive runs. Deduplicates (one root cause that breaks 20 scenarios → one work item, not 20). Classifies bug vs. environment vs. test-data vs. invalid-scenario vs. flaky. Creates/updates work items with full evidence. Substitutes for human triage.
6. **Implementation Agent** — source-aware. Reads the work item + scenario + evidence. Makes the smallest safe change, adds/updates automated tests where practical, runs checks, optionally self-checks via Chrome DevTools MCP. Moves work item to *In Review / Ready for Verification*. **Must not** mark Done, weaken the scenario, or delete failing scenarios.
7. **Verification Agent** — independent from the Implementation Agent. Black-box, preferably no source access. Reruns the exact original scenario (plus nearby regression scenarios) against the fixed app. Outcomes: `verified → Done` | `still failing → reopen` | `partially fixed → comment` | `flaky → require repeat` | `obsolete → needs-product-review`. This is the node that grounds dreams in reality.

**+ Orchestrator** — not an LLM agent; a deterministic state-machine service (§12).

## 7. Permissions model (separation of powers)

| Agent | Source Code | Browser MCP | Work Tracker | Write Code | Close Work Item |
|---|---|---|---|---|---|
| Dreamer | read | read (explore) | read | no | no |
| Critic | read | no | read | no | no |
| Scenario Generator | read (discovery only) | Playwright (explore) | read | no | no |
| Scenario Runner | **no** | Playwright | no | no | no |
| Failure Triage | read-only | evidence only | create/update | no | no |
| Implementation | yes | Chrome DevTools | update only | yes | **no** |
| Verification | preferably no | Playwright | update status | no | **yes, only after verification** |
| Orchestrator | metadata only | no | limited | no | no |

Control invariants:
- Generator may know the code; **Runner must not.**
- **Fixer must know the code; Verifier must be independent from the Fixer.**
- The agent that implements a fix never closes its own work item.

## 8. The demand engine (what makes it an organism)

- **North-star vision doc** — a versioned, append-only document (the "genome") describing product vision, goals, and constraints. Committed to git so its evolution is observable.
- **No terminal goal.** When the north-star is substantially met, the **Dreamer raises the ceiling** — proposes new features/ambitions that add value or attractiveness. There is no success point; the steady state is perpetual evolution.
- **Adversarial pairing keeps the dreamer honest.** Dreamer proposes → Critic challenges → only surviving demands become scenarios → scenarios must be *built and independently verified* before they count. Reality, not the dreamer, decides success.

## 9. Tooling decisions (settled)

- **Target product:** full-stack — web frontend + API backend.
- **Black-box surface (Runner, Verifier):** **Playwright MCP** (`@playwright/mcp`) — navigates via the **accessibility tree**, which is far more stable than raw DOM for LLM-driven automation; supports `--isolated` browser state and `--storage-state` for auth. *Caveat: weaker on apps with poor a11y trees.*
- **White-box debugging (Triage, Implementation):** **Chrome DevTools MCP** (`chrome-devtools-mcp`) — console audits, performance traces, network interception to diagnose *why* something failed.
- **API-level assertions:** available to Runner/Verifier as a secondary oracle when the UI can't reveal whether an action truly succeeded (persistence, side effects).
- **Agent engine:** **Claude Code, headless** (default). Chosen partly because its **streaming structured output** is what feeds the live console. Engine-agnostic in principle (OpenCode/Codex possible) but the console capture is engine-specific.
- **The wrapper does NOT manage raw LLM context.** It relies on the existing coding-agent harnesses (semantic search, codebase indexing, self-correcting tool loops). adapt provides the *rails*: orchestration, artifacts, state, safeguards, observability — and launches agents with targeted tasks + the right MCP servers + working directory.
- **adapt's own stack:** **Node + TypeScript.** Playwright/Chrome DevTools MCP are JS-native, Claude Code's streaming JSON is easily consumed in Node, and the websocket console is straightforward. Independent of any target's stack.
- **Work tracker:** **Jira from the start** (user decision), behind a clean tracker *adapter* so the backend is swappable. The local `.adapt/work-items/` JSON shape stays the canonical payload (and offline fallback); the adapter syncs create/update/transition/dedup to Jira via the Jira MCP. Recorded tradeoff: this adds integration surface in Phase 1 before the loop has proven it finds real bugs — the adapter boundary contains that risk.

## 10. Artifacts (durable surfaces)

**Two repositories — the agnostic boundary (§4 principle 9):** adapt is a generic framework. The product being evolved is a *separate* repo adapt is pointed at. Nothing target-specific lives in the adapt repo; per-target artifacts live in a `.adapt/` workspace inside the target.

```
adapt/                         # the generic framework (this repo — static, no target logic)
  orchestrator/                # the state-machine service (§12)
  console/                     # the live observability UI (§11)
  agent-prompts/               # static prompts for the 7 roles
  schemas/                     # JSON schemas: scenario, run, work-item, verification
  scripts/                     # generate-scenarios, run-scenarios, triage-failures,
                               #   verify-issue, orchestrate (thin CLI wrappers)
  config.example.json          # template only
  docs/

<target-project>/             # ANY full-stack product; adapt is pointed here
  <the product source>         # agents read this and COMMIT changes here (git safety net)
  .adapt/                      # per-target workspace, created on plug-in
    config.json                # target-specific: appBaseUrl, startCommand, repoPath, db hooks
                               #   (gitignored if it carries secrets)
    north-star.md              # versioned vision doc (the genome) — COMMITTED; watch ambition evolve
    scenarios/                 # user-centered scenarios (intent) — COMMITTED
      <area>.<flow>.md
    scenarios/index.json       # machine-readable registry (IDs, status, priority, tags, links, lastResult)
    scenario-runs/             # append-only run ledger (generated; need not be committed)
      <RUN-ID>.json
    work-items/                # local issue payloads (work tracker; Jira optional/later)
      <ITEM-ID>.json
    verification-reports/
      <REPORT-ID>.json
    decision-log/              # narrated timeline — primary deliverable
      <timestamped events>
```

Rationale: the north-star and scenarios *describe the target product*, so they version alongside its code — "watch ambition evolve in git" works naturally — while the adapt repo stays reusable across any number of targets.

**Scenario file format:** markdown + YAML frontmatter. Frontmatter holds machine metadata incl. optional `hooks.setup` / `hooks.teardown` (§13). Body holds persona, preconditions, user-level steps, expected outcome, failure signals.

**Run results are append-only** — never mutate scenario files to store execution history. A scenario file = intent; the run ledger = history.

**Work tracker:** **Jira from the start** (user decision), behind a clean *tracker adapter* so the backend is swappable. Work items serialize to the local `.adapt/work-items/` JSON shape as the canonical payload and offline fallback; the adapter syncs them to Jira (create / update / transition / dedup) via the Jira MCP. Phase 1 therefore needs Jira config: project key, issue type, and the transition names that map to the work-item lifecycle (§14).

**ID discipline everywhere:** `SCN-###`, `RUN-<ts>`, `ITEM-###`, commit SHA, branch, verification report ID. Every work item references its scenario + run; every scenario lists linked items; every run records the app commit/version.

## 11. Observability subsystem (first-class, real-time)

The user's explicit top priority: *watch the organism think, live.*

- **Mechanism:** the orchestrator launches each agent as a subprocess and captures its **streaming output** (Claude Code emits structured streaming events: thoughts, tool calls, tool results, responses). Events are fanned out to a live view.
- **Live console ("mission control") — v1 is a web dashboard served over websockets:**
  - per-agent panes showing thinking / commands / tool-calls / responses in real time,
  - a **global decision timeline** (what was decided, when, why, by which agent, referencing artifact IDs),
  - current **state-machine position** for each active scenario/work item,
  - the evolving north-star and the cycle counter.
- **Durable decision log** mirrors the live stream to disk so a full run is replayable after the fact. This log is considered the experiment's **primary deliverable**.

## 12. Orchestrator (the real brain)

A small deterministic service — *not* an LLM. It is a strict **state machine** so a crashed/half-finished agent task can be resumed without duplicating work.

Owns: which scenarios are runnable; which agent gets triggered next; which environment/commit is under test; scenario↔work-item mapping; retries & attempt limits; duplicate-failure handling; cycle scheduling; emitting events to the observability layer.

Implementation can start simple: a process + a queue + a SQLite/Postgres state table + a run ledger + agent-invocation commands. **No uncontrolled infinite loops by default** — explicit cycle stepping with limits, even though the *intended* long-run mode is continuous.

## 13. Environment & test-data isolation

- **Dedicated agent database**, separate from any real data, so the Runner's actions (creating 50 test projects, mutating settings) never corrupt a shared environment.
- **Per-scenario lifecycle hooks** in YAML frontmatter:
  ```yaml
  hooks:
    setup: npm run db:seed:scenario-001     # populate state before the run
    teardown: npm run db:clean:scenario-001 # restore for the next scenario
  ```
- The **orchestrator** runs `setup` immediately before invoking the Runner and `teardown` immediately after. Use a fast-to-reset store (SQLite file / disposable Docker container / isolated Postgres schema) so wiping is near-instant.
- **No secrets in the repo.** Real config (`config.json`) is gitignored; only `config.example.json` is committed.

## 14. State machines

**Scenario lifecycle:**
`draft → ready → active → running → passed → regression`
with failure branch `running → failed → item-created → awaiting-fix → ready-for-verification → verified → regression`
and side states `blocked → needs-environment-fix`, `invalid → needs-product-review`, `deprecated`.

**Work-item lifecycle:**
`Open → Triaged → In Progress → In Review → Ready for Verification → Done`
failure path: `Ready for Verification → Reopened → In Progress`.

**Run lifecycle:**
`queued → running → passed → archived` | `→ failed → triaged` | `→ inconclusive → retry`.

**Attempt limits (anti-infinite-loop):** e.g. `maxFixAttempts: 2`, `maxVerificationAttempts: 3`, `maxItemsPerRun: 10`. On limit breach → park the item in a `needs-attention` state and surface it in the console (the closest thing to "ask a human," but non-blocking — the loop continues with other work).

## 15. Build sequence — DECIDED: A (spine first)

The full organism is too many subsystems to stand up at once, so we build in phases. **Phase A is confirmed:** build and trust the autonomous validation-and-repair *spine* first; add the Dreamer+Critic only once the spine is trustworthy. *Rationale: you can't trust a dream's "success" until you can trust the verifier; the verifier grounds dreams in reality, so it must be solid first — and on a known app you can actually tell whether the loop is correct.*

Phasing:

- **Phase 0 — Rails & console.** Orchestrator skeleton (state machine), the plug-in mechanism (`.adapt/` workspace + config), git harness on the target repo, and the live observability console wired to stream agent events. (Captures the de-risking value of option C, but in service of A.)
- **Phase 1 — The spine (MVP).** Scenario Runner → Failure Triage → Implementation → independent Verifier, fully closed-loop, on a plugged target with human-seeded scenarios. DB isolation hooks (§13) in play. Measured by §17.
- **Phase 2 — Demand engine.** Add Dreamer + Critic (adversarial pairing, §8) and the source-aware Scenario Generator, so the loop chooses its own work against the north-star.
- **Phase 3 — Endurance & graduation.** Long continuous runs, regression pool, graduation of stable scenarios into deterministic Playwright tests (§5 pressure valve), budget/cadence guardrails.

Alternatives not taken: **B (thin full organism)** — too hard to diagnose which part fails; **C (backbone only)** — folded into Phase 0 rather than pursued standalone.

The first implementation plan should cover **Phases 0–1** only; Phases 2–3 get their own spec→plan cycles.

## 16. Safeguards (hard rules for implementation)

- Never delete a scenario because it passes — passing scenarios become **regression assets**.
- The Implementation Agent never closes a work item.
- The agent that implements a fix never verifies its own fix.
- Don't create work items for blocked/invalid/inconclusive runs unless explicitly configured.
- Deduplicate — never spam the tracker with duplicates of one root cause.
- No uncontrolled infinite loops by default.
- No secrets in the repo.
- Never weaken expected outcomes to make failures disappear.
- Never modify agent prompts as part of the product-improvement loop.

## 17. MVP success metric (for the experiment)

For the first slice (the spine): *Can the system autonomously discover real user-visible breakages, produce work items good enough to fix without clarification, implement a fix, and have an independent agent confirm the original scenario now passes — with a decision log clear enough that the human can reconstruct why every step happened?*

Once the spine clears that bar, the Dreamer+Critic are added and the metric becomes: *Does the product accrue genuine new value over many cycles without drifting, reward-hacking, or rotting — and can we see why?*

## 18. Open questions / decisions still to make

1. **Cycle cadence & budget guardrails** — wall-clock and spend limits per run before the loop pauses itself.
2. **A concrete test target to *run* the first experiment against** — supplied purely via config (no logic in adapt); still to be chosen, but does not block building the framework.
3. **`.adapt/` workspace details** — exactly what is committed to the target repo (north-star, scenarios) vs. generated/gitignored (runs, reports, decision-log).

Resolved: build sequence = **A** (§15); target coupling = **generic/plug-and-play via config** (§4 principle 9, §10); adapt stack = **Node + TypeScript** (§9); console v1 = **web dashboard over websockets** (§11); work tracker = **Jira from the start, behind a swappable adapter** (§9–10).

---

*This blueprint is the durable record of the brainstorming sessions. It is the source of truth for what adapt is; conversational context is disposable.*

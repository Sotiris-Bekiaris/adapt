# adapt — documentation index

Start with the repository [README](../README.md). This directory holds everything longer than a README
section.

## Current documentation

Kept up to date with the code. If any of it disagrees with `src/`, that is a bug — please report it.

| Document | What it is for |
| --- | --- |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | The map of the codebase: module layout, one cycle traced through the orchestrator, where state lives, the engine and MCP abstractions, the observability path. Read this before changing code. |
| [first-real-run.md](./first-real-run.md) | The runbook for pointing adapt at a real product with a real model for the first time. Prerequisites, step-by-step with expected output, and troubleshooting. |
| [../CONTRIBUTING.md](../CONTRIBUTING.md) | Setup, the green gate, and what the project accepts. |
| [../SECURITY.md](../SECURITY.md) | Trust boundary, what is deliberately unauthenticated, how to report a vulnerability. |

## Historical design record

`docs/superpowers/` is **not** documentation of current behaviour. It is the record of how adapt was
designed and built, written before or alongside the code and never rewritten afterwards. Specs describe
what was intended at the time; plans are task-by-task implementation checklists. Names, defaults, and
file layouts have moved since. Treat these as provenance and as the reasoning behind decisions — not as
an API reference.

One exception is worth calling out: **`superpowers/specs/2026-05-25-adapt-design.md` is *the* blueprint.**
Its numbered sections are cited throughout the source and the other docs as "blueprint §10", "blueprint
§14", and so on. When you meet such a citation, that is the file it points at.

### Specs — what was intended

| Spec | Subject |
| --- | --- |
| [2026-05-25-adapt-design.md](./superpowers/specs/2026-05-25-adapt-design.md) | **The design blueprint.** Principles, roles, artifacts, the §-numbered sections cited from the code. |
| [2026-05-26-phase1-spine-design.md](./superpowers/specs/2026-05-26-phase1-spine-design.md) | Phase 1 — the autonomous spine: validate → triage → repair → verify. |
| [2026-05-26-phase2-demand-engine-design.md](./superpowers/specs/2026-05-26-phase2-demand-engine-design.md) | Phase 2 — the demand engine: Dreamer, Critic, Generator. |
| [2026-05-26-phase3-endurance-graduation-design.md](./superpowers/specs/2026-05-26-phase3-endurance-graduation-design.md) | Phase 3 — endurance (`adapt run`) and graduation into Playwright specs. |
| [2026-05-28-baseline-lanes-design.md](./superpowers/specs/2026-05-28-baseline-lanes-design.md) | Baselines and lanes: parallel evolutionary lineages on git worktrees. |
| [2026-05-28-multi-lane-console-design.md](./superpowers/specs/2026-05-28-multi-lane-console-design.md) | The multi-lane monitor. |
| [2026-06-13-cycle-flow-view-design.md](./superpowers/specs/2026-06-13-cycle-flow-view-design.md) | The cycle-grouped "Cycles" view in the monitor UI. |
| [2026-06-13-dedup-and-seed-data-design.md](./superpowers/specs/2026-06-13-dedup-and-seed-data-design.md) | Dedup-aware Critic and guaranteed scenario seed data. |
| [2026-06-14-lane-controls-design.md](./superpowers/specs/2026-06-14-lane-controls-design.md) | Lane controls: pause / continue / stop / start / restart and live `maxCycles`. |

### Plans — how it was built

Chronological. Each plan is a task-by-task checklist that was executed to produce the code.

| Phase | Plans |
| --- | --- |
| 0 — rails | [plan 1 workspace & config](./superpowers/plans/2026-05-25-phase0-plan1-workspace-config.md) · [plan 2 orchestrator state & run ledger](./superpowers/plans/2026-05-25-phase0-plan2-orchestrator-state.md) · [plan 3 agent harness, streaming & console](./superpowers/plans/2026-05-25-phase0-plan3-harness-console.md) |
| 1 — spine | [plan 4 scenario runner](./superpowers/plans/2026-05-26-phase1-plan4-scenario-runner.md) · [plan 5 triage & work tracker](./superpowers/plans/2026-05-26-phase1-plan5-triage-tracker.md) · [plan 6 implementation, verification & `orchestrate`](./superpowers/plans/2026-05-26-phase1-plan6-implementation-verification.md) |
| 2 — demand engine | [plan 7 demand model, Dreamer, Critic](./superpowers/plans/2026-05-26-phase2-plan7-demand-dreamer-critic.md) · [plan 8 scenario generator](./superpowers/plans/2026-05-26-phase2-plan8-scenario-generator.md) · [plan 9 `adapt evolve`](./superpowers/plans/2026-05-26-phase2-plan9-evolve.md) |
| 3 — endurance & graduation | [plan 10 endurance robustness](./superpowers/plans/2026-05-26-phase3-plan10-endurance-robustness.md) · [plan 11 graduation](./superpowers/plans/2026-05-26-phase3-plan11-graduation.md) · [plan 12 `adapt run`](./superpowers/plans/2026-05-26-phase3-plan12-adapt-run.md) |
| follow-ups | [baselines & lanes](./superpowers/plans/2026-05-28-baseline-lanes.md) · [cycle flow view](./superpowers/plans/2026-06-13-cycle-flow-view.md) · [dedup & seed data](./superpowers/plans/2026-06-13-dedup-and-seed-data.md) · [lane controls](./superpowers/plans/2026-06-14-lane-controls.md) |

### Provenance

[design-notes.md](./design-notes.md) is the raw, unedited brainstorm the whole project grew out of —
a voice transcript and the conversation that turned it into a design. It is preserved because it is the
honest origin of the method, not because it is readable. The durable version of everything in it is the
blueprint above.

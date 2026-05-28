# adapt — Baselines & Lanes (Parallel Evolutionary Lineages)

**Date:** 2026-05-28
**Status:** Design / brainstorming output. Approved in concept. Scoped: this spec covers **Spec 1 (baseline + lane core)** only; Jira-per-lane and the multi-lane console are named follow-ups (§9).
**Builds on:** `2026-05-25-adapt-design.md` (esp. §4 generic/plug-and-play, §5 git safety net, §10 `.adapt/` workspace, §13 isolation, §12 orchestrator, the `adapt run` continuous loop).

---

## 1. One-paragraph summary

Today adapt is pointed at a single target repo and evolves it in place. This adds the ability to **save a shared starting point (a baseline)** and **fork it into multiple isolated, self-sustaining lanes (lineages)** — same product, same fork point, different git branch and model — so the experimenter can run several organisms in parallel and watch how they diverge. Each lane is fully isolated (its own worktree+branch, its own database namespace, later its own Jira project) and runs its **own closed autonomous loop**: started once, it works on its own and resumes after interruption. A lane can be **reset** back to its baseline (discard everything for that lineage) or **destroyed** entirely.

## 2. Motivation

- **Discard / restart.** The original ask: a way to "save" the state of the repo the first time adapt runs, so everything can be discarded or re-started from the same point.
- **Comparative evolution (the real driver).** Run the same product from one baseline under different models/branches concurrently and compare lineages. This is the experiment's payoff.
- **Best-practice environment population.** Replace ad-hoc host setup with a declared, reproducible, namespaced environment per lane, brought up automatically.

## 3. Core concepts

### Baseline — the shared fork point
A named git tag on the **target** repo (`adapt-baseline/<name>`) at a clean commit, plus a committed manifest describing how to bring up a clean environment. It is the genome every lineage starts from.

### Lane (lineage) — one isolated evolutionary instance
A lane forks a baseline and evolves independently. It bundles a namespace across every stateful dimension:

| Dimension | Per-lane isolation |
|---|---|
| Code + `.adapt/` artifacts | git **worktree** on branch `adapt/<laneId>`, forked from the baseline tag |
| App database / runtime | Docker Compose **project** `adapt-<laneId>` + a dedicated port block |
| Orchestrator state | the lane worktree's own `.adapt/state.sqlite` (resumable) |
| Work tracker | local `.adapt/work-items/` JSON now; Jira **project** `ADAPT<X>` in Spec 2 |
| Model | chosen at lane creation, recorded in `lane.json` |

### The namespace contract (what keeps adapt generic)
adapt guarantees each lane a **unique, collision-free namespace** and passes it to the target's environment commands as environment variables:

- `ADAPT_LANE_ID` — e.g. `opus-main`
- `ADAPT_COMPOSE_PROJECT` — e.g. `adapt-opus-main`
- `ADAPT_PORT_BASE` — e.g. `54400` (= `portBase + index * portStride`)

The target's `environment.up/down/reset` commands consume these. adapt never learns the target's stack (e.g. that it is Supabase); the target provides the small glue that binds to these vars. This preserves the design's principle 9 (no target logic in adapt).

## 4. The baseline is declarative, not a heavy snapshot

Every layer rebuilds from a reproducible source, so "reset to baseline" and "fork a new lane" are the **same operation** run from declarative inputs — no opaque image blobs, git stays the observable history:

- **Code + artifacts** ← `git reset --hard <baseline-tag>` (or `git worktree add` from the tag)
- **App data** ← `environment.reset` (for a Supabase target: `supabase db reset`, rebuilding from committed migrations + `seed.sql`)
- **Work tracker** ← clear local work-items (Spec 1); recreate the Jira project from a template (Spec 2)

Volume snapshots are **out of scope**, kept only as a documented fallback if a future target's data cannot be rebuilt from source.

## 5. Infra ownership — three tiers

1. **adapt's own generic infra** — shared services adapt owns and provisions identically for every target (e.g. the shared Jira container in Spec 2). Lives outside any target; not part of baseline reset. *(No infra in Spec 1 — local JSON tracker needs none.)*
2. **Target glue** — the `environment.up/down/reset` commands, which live in the **target** repo and consume the namespace env vars. adapt never contains these.
3. **git** — the target's own history: code, migrations, seed, scenarios, north-star. The declarative baseline.

## 6. CLI surface (Spec 1)

Thin wrappers over the orchestrator, matching existing `adapt init/run/evolve` style. Each command core is a pure-ish function returning an exit code, with IO injected for testability (mirrors `runInit`).

```
adapt baseline create <name> [--target <repo>]
    Verify the worktree is clean (no uncommitted changes). Tag adapt-baseline/<name>
    at HEAD. Write .adapt/baselines/<name>.json manifest. Commit the manifest.

adapt baseline list [--target <repo>]
    List baselines (name, commit, createdAt) from .adapt/baselines/.

adapt lane create <laneId> --baseline <name> [--model <model>] [--target <repo>]
    git worktree add <lanesRoot>/<laneId> -b adapt/<laneId> <baseline-tag>
    Allocate a port block (portBase + index*portStride); compose project adapt-<laneId>.
    Run environment.up with ADAPT_LANE_ID / ADAPT_PORT_BASE / ADAPT_COMPOSE_PROJECT in env.
    Run environment.reset (clean data from migrations + seed).
    Write <worktree>/.adapt/lane.json (laneId, baseline, model, ports, branch,
      composeProject, createdAt).

adapt lane list [--target <repo>]
    Table of lanes: model, branch, ports, compose status, baseline, last cycle, loop status.

adapt lane start <laneId> [--detach]
    Ensure the lane's environment is up, then run the continuous loop (runContinuous)
    against the lane worktree using its lane.json (model) + its own state.sqlite.
    --detach runs it in the background so the lane "works on its own".

adapt lane stop <laneId>
    Graceful stop via the existing run-stop signal mechanism.

adapt lane reset <laneId> [--target <repo>]
    git reset --hard <baseline-tag> in the worktree (discard the lineage's commits).
    environment.reset (clean app data). Clear local work-items + state.sqlite.
    Lane returns to the fork point, same id. (This is "discard everything / start again".)

adapt lane destroy <laneId> [--target <repo>]
    environment.down (compose down -v). git worktree remove. Delete branch adapt/<laneId>.
```

`adapt run` continues to work and already accepts a target dir; a lane is just a target that happens to be a worktree with a `lane.json`.

## 7. Per-lane autonomous loop (the "start and maintain" requirement)

A lane is a self-sustaining organism, not just an isolated folder.

- **Start once, runs on its own.** `adapt lane start` boots the environment if needed and launches the existing `runContinuous` loop (Dreamer→…→Verifier cycles under the existing guardrails: `maxCycles`, `maxWallClockSeconds`, `pauseSeconds`, `maxConsecutiveErrors`).
- **Resumable / maintainable.** Lane state lives in `state.sqlite` (`StateStore`) + scenario files + git, never in memory. A killed or restarted loop resumes from persisted state — no duplicated work. This is what makes the loop *maintained* across interruptions.
- **Model per lane.** The loop reads the lane's model from `lane.json` and passes it to the engine (subagents continue to use their configured model).
- **Isolation guarantees no cross-talk.** Because DB, ports, branch, state DB, and (later) Jira project are namespaced, two lanes can run their loops simultaneously without interfering.
- **Background lifecycle.** `--detach` runs the loop as a background process; `lane list` reports loop status; `lane stop` requests a graceful stop via the existing signal path.

## 8. Data shapes

**`.adapt/baselines/<name>.json`** (committed):
```jsonc
{
  "name": "v1",
  "gitTag": "adapt-baseline/v1",
  "commit": "<sha>",
  "createdAt": "2026-05-28T...Z"
}
```

**`<worktree>/.adapt/lane.json`** (per lane):
```jsonc
{
  "laneId": "opus-main",
  "baseline": "v1",
  "model": "opus",
  "branch": "adapt/opus-main",
  "composeProject": "adapt-opus-main",
  "ports": { "base": 54400, "stride": 100 },
  "createdAt": "2026-05-28T...Z"
}
```

**Config additions** (`.adapt/config.json`, validated by the existing zod schema):
```jsonc
{
  "environment": {
    "up":    "scripts/adapt-env-up.sh",   // receives ADAPT_* env vars
    "down":  "scripts/adapt-env-down.sh",
    "reset": "supabase db reset",
    "portBase": 54300,
    "portStride": 100
  },
  "lanes": { "rootDir": "../adapt-lanes" }
}
```
`environment` and `lanes` are **optional** — absent `environment`, lane create/reset skip the env steps (git-only lanes), preserving current behavior for targets without a containerized env.

## 9. Scope & decomposition

Built in order, each its own plan→implementation cycle:

- **Spec 1 (this spec) — Baseline + lane core.** `baseline create/list`, `lane create/list/start/stop/reset/destroy`, worktree management, manifests, the namespace contract + env-var injection, per-lane state.sqlite, per-lane continuous loop. Uses the existing local-JSON tracker. **Independently useful**: parallel lanes with isolated DBs and autonomous loops, Jira deferred.
- **Spec 2 — Shared Jira infra + project-per-lane.** `docker-compose.infra.yml` (the shared Jira from `jira-docker`), `adapt infra up`, Jira-project create/delete/reset wired into the lane lifecycle behind the existing tracker adapter (`tracker.kind`, `projectPrefix`, `projectTemplate`).
- **Spec 3 — Multi-lane console.** Show concurrent lineages side by side in the observability dashboard.

## 10. Safeguards / invariants

- `baseline create` refuses if the worktree has uncommitted changes (a baseline must be a clean, reproducible point).
- `lane reset` and `lane destroy` operate **only** within the lane's worktree / compose project / branch — never the primary checkout or another lane.
- `lane destroy` requires the lane's loop to be stopped first (no destroying a running organism out from under itself).
- Lane ids are validated to a safe charset (used in branch names, compose project names, paths).
- Port blocks are allocated to avoid collision with existing lanes (derive index from existing `lane.json`s).
- All existing constitution safeguards (§16 of the base design) still hold inside every lane.

## 11. Open questions (non-blocking)

1. **Lane index allocation** — derive port index from a scan of existing lanes vs. a persisted counter. (Lean: scan existing `lane.json`s; deterministic and stateless.)
2. **Detached loop supervision** — plain background process now; a richer supervisor (auto-restart on crash) can come later. (Lean: background process + resumable state is enough for Spec 1.)
3. **Where `lanesRoot` defaults** — sibling dir `../adapt-lanes` vs. inside the target. (Lean: sibling, to keep worktrees out of the target tree.)

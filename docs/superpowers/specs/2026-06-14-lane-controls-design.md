# Lane Controls: stop / start / restart / pause / continue + maxCycles + resume

**Date:** 2026-06-14
**Status:** Approved design, pending implementation plan
**Branch:** feat/baseline-lanes

## Problem

The autonomous lane loop runs effectively forever (a real target's config sets
`run.maxCycles` and `run.maxWallClockSeconds` to ~1e9). There is no way to
control a running loop from the monitor — only CLI `lane start`/`lane stop`,
and `lane stop` needs a pidfile that older loops never wrote.

Three gaps:

1. **No live control.** Can't pause/continue/restart a running loop, and can't
   bound it with a cycle limit from the monitor.
2. **maxCycles is config-only and effectively infinite.** Want it settable per
   lane from the monitor, default infinite, surfaced in the UI.
3. **Resume is incomplete.** State persists in `state.db` (scenario states,
   attempt counts, pass counts) so restart mostly resumes — but a cycle killed
   mid-flight leaves its run row stuck at `status="running"` forever.

## Goals

- Per-lane and global (all-lanes) controls in the monitor:
  start / stop / restart / pause / continue.
- Editable maxCycles per lane (blank/0 = infinite), default infinite, overriding
  config. Loop exits cleanly when the limit is reached.
- Pause = let the current agent/cycle finish, persist clean state, then hold;
  continue resumes. Resumable across a full process restart.
- Restart picks up exactly where it left off — no scenario stuck "running".

## Non-goals

- No auth / remote access. Monitor stays loopback-only (single-user local tool).
- No mid-agent freeze (SIGSTOP). Control acts at cycle boundaries only.
- No UI unit tests (consistent with the current monitor — none exist).

## Architecture

Chosen approach: **process spawn/kill for start/stop/restart, a polled control
file for pause/continue/maxCycles.** One coherent file-based model, consistent
with the existing `pidfile` / `state.db` / `lane.json` design. No new
ports/sockets. Pause state survives both loop and monitor restarts. Control
acting only at cycle boundaries IS the desired "let the agent finish" semantics.

Rejected alternatives:
- **WS command channel into the loop's console server** — can't start a dead
  lane through its own socket (start/restart still need process spawn anyway),
  pause state not persisted, mixed mechanism.
- **OS signals only** — SIGSTOP freezes mid-agent (violates pause rule), no
  maxCycles support.

```
Browser (monitor.html/js)
  │  WS {type:"control", lane, action, maxCycles?}
  ▼
MonitorServer ── control callback ──► monitor.ts wiring
  ├─ start   → startLaneLoop({detach:true})         (spawn + pidfile)
  ├─ stop    → stopLaneLoop()                       (SIGINT pidfile)
  ├─ restart → stop, await pidfile gone, start
  ├─ pause   → writeControl({paused:true})          ─┐
  ├─ continue→ writeControl({paused:false})          ├─ <worktree>/.adapt/control.json
  └─ maxCycles→ writeControl({maxCycles})           ─┘
                                                       │ polled
                                                       ▼
                                          runContinuous (loop process)
```

## Components

### 1. `src/lanes/control.ts` (new)

Owner of `<worktree>/.adapt/control.json`:

```json
{ "paused": false, "maxCycles": null, "stopRequested": false }
```

- `maxCycles: null` = infinite (the effective default).
- `paused: true` = loop finishes the current cycle, persists state, then waits
  (polling) until `paused` flips false.
- `stopRequested: true` = clean stop after the current cycle (graceful peer to
  SIGINT).
- **Missing file = all defaults** (infinite, not paused). Backward compatible.

API (pure fs, injectable for tests):
- `readControl(worktree): LaneControl` — missing/malformed → defaults.
- `writeControl(worktree, patch): void` — read-modify-write, atomic via
  temp-file + rename.
- `clearStop(worktree): void` — reset `stopRequested` (used before a fresh start).

### 2. `src/orchestrator/run.ts` — `runContinuous` changes

- Inject a `readControl` dep (default: real fs reader).
- **maxCycles**: read control at each loop-top. `null` → skip the cycle-limit
  check (infinite). A number → honor it, overriding `config.run.maxCycles`.
- **pause**: after a cycle completes (state already persisted to `state.db`), if
  `control.paused`, enter a poll-wait loop (chunked `sleep`, re-read control)
  until unpaused, `stopRequested`, or `signal.stopped`. Emit `cycle.paused` /
  `cycle.resumed`.
- **stopRequested**: treated like `signal.stopped` → return `stoppedBy:"control"`.
- Add `"control"` to the `StopReason` union.
- **maxCycles reached → process exits** (lane shows stopped, env freed) — matches
  current behavior. Config remains the fallback only when the control file is
  absent and a config limit is desired; effective default is infinite via
  control's `null`.
- **Counter semantics**: maxCycles counts cycles within the current process run.
  A restart resets the counter (acceptable — the default is infinite; maxCycles
  is mainly for bounded test runs). Documented, not persisted.

### 3. `src/orchestrator/store.ts` — orphan reaping

- `reapOrphanedRuns(): string[]` — find runs with `status="running"`, flip them to
  `inconclusive`, reset each owning scenario's state to `ready`, return affected
  runIds.
- Called once in `runCmd` after store open, before `runContinuous`. Emits a
  `run.reaped` event per orphan.

### 4. `src/observability/monitorServer.ts` — control plane

- Inbound WS message:
  `{ type:"control", lane:"<id>"|"*", action:"start"|"stop"|"restart"|"pause"|"continue", maxCycles?: number|null }`.
- `MonitorServerDeps` gains a `control(cmd)` callback.
- `lane:"*"` fans the action out to every lane in the registry (global bar).
- `maxCycles` normalization: `0`, empty, or negative → `null` (infinite). Done
  server-side so the UI can send a raw blank/0.
- Stays bound to `127.0.0.1` (no auth).

### 5. `src/observability/monitor.ts` — wiring

Implements the `control` callback:
- **start**: `startLaneLoop({ worktree, detach:true })` (after `clearStop`).
- **stop**: `stopLaneLoop(worktree)` (SIGINT pidfile).
- **restart**: stop, await pidfile removal, start.
- **pause/continue**: `writeControl(worktree, { paused })`.
- **maxCycles**: `writeControl(worktree, { maxCycles })`.

### 6. `src/observability/laneRegistry.ts` — surface control state

- `LaneSummary` gains `paused: boolean` and `maxCycles: number|null`, read from
  `control.json` during the scan, so the UI reflects true state.

### 7. `src/observability/public/` — UI

`monitor.html` + `monitor.js` (vanilla JS, matches existing style):
- **Per-lane row**: ▶ Start / ■ Stop / ⟳ Restart / ⏸ Pause / ▶ Continue, enabled
  by status (running → Stop/Restart/Pause; stopped → Start; paused →
  Continue/Stop). Plus a `maxCycles` number input (blank = ∞) with Apply.
- **Global bar**: same controls with `lane:"*"` ("Start all / Stop all / …").
- Buttons send the WS `control` frame; UI refreshes from the existing `lanes`
  broadcast (≤2s scan).
- Status badge: `running` / `paused` / `stopped` + effective maxCycles
  (`12/∞` or `3/5`).

## Data flow

1. User clicks Pause on lane `a` → browser sends
   `{type:"control", lane:"a", action:"pause"}`.
2. `MonitorServer` → `control` callback → `writeControl(worktreeA, {paused:true})`.
3. Loop finishes its current cycle, persists to `state.db`, reads
   `control.json`, sees `paused`, emits `cycle.paused`, waits.
4. Registry scan reads `control.json`, sets `summary.paused=true`, broadcasts;
   UI badge flips to `paused`.
5. User clicks Continue → `writeControl({paused:false})` → loop's poll-wait exits,
   emits `cycle.resumed`, next cycle starts.

## Error handling

- Malformed/missing `control.json` → defaults (never crashes the loop).
- `writeControl` atomic (temp + rename) — no torn reads mid-cycle.
- Restart races: monitor awaits pidfile removal before re-spawn (bounded wait;
  fall back to start after timeout, logged).
- Killed mid-cycle → orphan reaping on next start cleans `running` rows.
- Pause persists: if the loop process restarts while `paused:true`, it starts and
  immediately holds (honors the file).

## Testing

- `control.ts`: read/write/atomic/missing-file/malformed unit tests.
- `runContinuous`: infinite (maxCycles=null, bounded by signal); pause→wait→
  continue; stopRequested → `stoppedBy:"control"`; control overrides config.
  Uses injected control reader + existing injectable sleep/clock/signal.
- `StateStore.reapOrphanedRuns`: orphan flipped to `inconclusive`, scenario reset
  to `ready`, runIds returned.
- `MonitorServer`: control frame dispatches the right callback; `"*"` fans out.
  Injected control/start/stop fns.
- UI: not unit-tested (consistent with current monitor).

## Open questions

None — design approved section by section on 2026-06-14.

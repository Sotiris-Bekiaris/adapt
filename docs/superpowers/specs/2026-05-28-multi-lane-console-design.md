# adapt — Multi-Lane Console (Spec 3)

**Date:** 2026-05-28
**Status:** Design / brainstorming output. Approved in concept.
**Builds on:** `2026-05-28-baseline-lanes-design.md` (Spec 1, lanes) and the existing observability subsystem (`src/observability/`: `EventBus`, `ObservabilityServer`, `DecisionLog`, `events.ts`, the `public/` dashboard). This is the "Spec 3 — Multi-lane console" follow-up named in the baselines & lanes design.

---

## 1. One-paragraph summary

Each lane runs its own loop in its own process, so today there is no single place to watch them all. This adds `adapt monitor`: a central aggregator that connects to every running lane's live event stream, replays stopped lanes' history from disk, and serves one dashboard where you pick a lane from a sidebar and watch its agents think, generate, and verify in a focused pane. It also closes a pre-existing gap — the live web console was never wired to a real running loop (it ran a stub); the loop's real `EventBus` is now exposed over websocket.

## 2. Motivation

- **See everything running.** Run several lineages (different models/branches) from one baseline and watch them all from a single dashboard.
- **Review finished work.** A stopped lane still has its decision log; the dashboard can replay it.
- **Fix the stub gap.** `adapt console` currently runs a demo stub agent and never attaches to a real loop; the real per-lane bus is now observable.

## 3. Architecture & data flow

Three roles — two already exist (`EventBus`, `ObservabilityServer`):

```
[lane opus-main loop]   EventBus → ObservabilityServer  ws://127.0.0.1:4399/ws  ┐
[lane sonnet-main loop] EventBus → ObservabilityServer  ws://127.0.0.1:4400/ws  ┤  producers (live)
                                                                                │
                          adapt monitor                                         │
                            • WS client per running lane, tags events {lane}    │
                            • reads decision-log NDJSON for STOPPED lanes        │
                            • MonitorServer ── one ws://127.0.0.1:<port>/ws ──► browser
```

- **Producer (running lane).** `lane start` already constructs the loop's `EventBus` (via `runCmd`) and publishes real agent + orchestrator events to it. We attach an `ObservabilityServer` to that bus on the lane's console port. `ObservabilityServer` already replays its recent buffer (`bus.recent()`) to each new connection, so a late-joining monitor gets recent history.
- **Aggregator (`adapt monitor`).** Scans `lanesRoot`; per lane keeps a `LaneSource` that is *live* (WS client to the lane's console port) or *historical* (reads the lane's decision-log file on demand). A `LaneRegistry` re-scans on an interval so lanes that start/stop/are created/destroyed appear and drop. A `MonitorServer` serves one dashboard.
- **Browser.** One websocket to the `MonitorServer`; a sidebar of lanes with status dots; a focused pane reusing today's per-role columns + timeline.

## 4. Console-port allocation + loop wiring (Spec-1 amendment)

Each lane needs a stable, collision-free console port, kept clear of the app/DB port block.

- Add `consolePort: number` to `LaneManifest`.
- Allocate it at `lane create` as `config.console.port + slotIndex(ports.base, portBase, portStride)` — deterministic per lane slot.
- `runCmd` gains an optional `consolePort`; when set, it starts an `ObservabilityServer` on the loop's bus at that port and stops it when the loop ends. `lane start` passes `manifest.consolePort`; base `adapt run` passes nothing (lanes-only scope — base behavior unchanged).
- **Back-compat:** for lanes whose manifest predates this field, the aggregator derives the same port via `config.console.port + slotIndex(...)`, so nothing breaks.

## 5. LaneSource + status detection

One `LaneSource` per lane owns that lane's connection lifecycle. Status comes from the Spec-1 pidfile via `laneLoopStatus(worktree)` (`loop.pid` + liveness probe).

- **`running`** → open a WS client to `ws://127.0.0.1:<consolePort>/ws`. Each received frame is parsed, stamped with `lane: laneId`, and forwarded to the aggregator. On connect-refused (loop still booting) or socket close, retry with capped backoff and update status.
- **`stopped`** → no socket. On demand (browser focus), read `<worktree>/.adapt/decision-log/<day>.ndjson`, parse each line, stamp with `lane`, return as a one-shot history batch. Malformed lines are skipped; a missing log yields empty history.

`LaneRegistry` re-scans `lanesRoot` (~2s interval), creating sources for new lanes, dropping sources for removed ones, and tracking `{laneId, model, baseline, status, cycle}` for the sidebar. `cycle` is derived from the latest `cycle.start`/`cycle.completed` event observed for that lane. **The monitor is strictly read-only** — it never writes to any workspace.

## 6. Browser protocol + dashboard

A lane-aware protocol over the `MonitorServer`'s single `/ws`:

- **server→browser** `{ type: "lanes", lanes: [{ laneId, model, baseline, status, cycle }] }` — on connect and whenever the registry changes (drives the sidebar).
- **server→browser** `{ type: "event", lane, event }` — live tagged events for all running lanes; the browser buffers them per lane so a focused lane already has its recent stream.
- **browser→server** `{ type: "focus", lane }` — when a lane is clicked.
- **server→browser** `{ type: "history", lane, events: [...] }` — reply for a *stopped* lane (read from its log). Running lanes need no history request (live buffer + producer backlog cover it).

**Event shape:** add optional `lane?: string` to `ConsoleEvent`, set by the aggregator (producers/writers remain unchanged).

**Dashboard files:** new `public/monitor.html` + `public/monitor.js`, reusing `public/styles.css` and the column/timeline render logic from `app.js` for the focused pane. Sidebar lists lanes with status dots (● running / ○ stopped) + cycle count; clicking sets focus. The existing single-lane `app.js`/`index.html` stay for the per-lane producer view.

## 7. Components / files

**Create:**
- `src/observability/laneSource.ts` — `LaneSource` (live WS client / historical log reader) + status.
- `src/observability/laneRegistry.ts` — scan `lanesRoot`, diff, track lane metadata.
- `src/observability/monitorServer.ts` — central server + browser protocol + focus handling.
- `src/observability/monitor.ts` — wires registry + sources + server (the `adapt monitor` core).
- `src/cli/commands/monitor.ts` — CLI core.
- `src/observability/public/monitor.html`, `src/observability/public/monitor.js` — multi-lane dashboard.

**Modify:**
- `src/lanes/types.ts` — add `consolePort` to `LaneManifest`.
- `src/lanes/lane.ts` — allocate `consolePort` in `createLane`.
- `src/cli/commands/run.ts` — optional `consolePort` → start/stop an `ObservabilityServer` on the loop bus.
- `src/lanes/loop.ts` — pass the lane's `consolePort` into the foreground runner.
- `src/observability/events.ts` — add optional `lane?: string` to `ConsoleEvent`.
- `src/cli/index.ts` — wire `adapt monitor <targetRepo> [--port]`.

## 8. CLI

```
adapt monitor <targetRepo> [--port <n>]
    Load config, start the aggregator + MonitorServer, print the URL, run until Ctrl-C.
```

The existing stub `adapt console` is left in place (legacy/per-lane demo); not removed in this spec.

## 9. Error handling

- Lane down → sidebar shows it stopped; focusing it replays its decision log.
- WS connection refused (loop booting) → capped-backoff reconnect; status reflects connecting/stopped.
- Malformed NDJSON line → skipped; missing log → empty history.
- Monitor is read-only, so a crash or restart cannot corrupt any lane or workspace.

## 10. Testing

- **`consolePort` allocation** — pure; `config.console.port + slotIndex`.
- **`LaneSource`** — tagging with `lane`, and running-vs-stopped routing, using an injected fake WS client and fake fs.
- **`LaneRegistry`** — scan/diff over tmp `lanesRoot` fixtures (new lane appears, destroyed lane drops, status/cycle tracked).
- **`MonitorServer` protocol** — connect→`lanes`, `focus`→`history`, live `event` fan-out, with in-memory fake sources.
- Dashboard JS kept thin; behavior is tested at the server protocol boundary.

## 11. Scope

One cohesive subsystem = one spec/plan, including the small Spec-1 amendment (`consolePort` + `runCmd`/`lane start` wiring).

**Out of scope:** monitoring the base (non-lane) target; authentication on the dashboard; any change to how lanes evolve; replacing or removing the legacy stub `adapt console`.

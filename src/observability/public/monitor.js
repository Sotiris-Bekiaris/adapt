import { buildCycles } from "/cycles.js";

const statusEl = document.getElementById("status");
const lanesEl = document.getElementById("lanes");
const focusHeaderEl = document.getElementById("focus-header");
const agentsEl = document.getElementById("agents");
const timelineEl = document.getElementById("timeline-list");
const focusBody = () => document.querySelector(".focus-body");
const cyclesEl = document.getElementById("cycles");
const toggleEl = document.getElementById("view-toggle");
const globalControlsEl = document.getElementById("global-controls");
const globalMaxCyclesEl = document.getElementById("global-maxcycles");

const BUFFER_CAP = 500;

let ws = null;
let focusedLane = null;
let lanes = []; // latest [{ laneId, model, baseline, status, cycle }]
let gotLanes = false; // has the server sent a lanes list yet? (empty vs loading)
let connected = false; // socket state, so "empty" is never confused with "offline"
const buffers = new Map(); // laneId -> event[]
let columns = new Map(); // role -> events container (for focused lane)
let viewMode = "cycles"; // "stream" | "cycles"
const laneEvents = new Map(); // laneId -> full ConsoleEvent[] (history + live), source for buildCycles
const expanded = new Set(); // expand keys: cycle "c:<n>" and step "s:<n>:<idx>"
const seenCycleKeys = new Set(); // cycles whose default-open has been applied

function laneMeta(laneId) {
  return lanes.find((l) => l.laneId === laneId) || null;
}

// A blank pane is indistinguishable from a broken one, so every empty region
// says what it is waiting for and which command produces it.
function emptyNode(text) {
  const p = document.createElement("p");
  p.className = "empty";
  p.textContent = text;
  return p;
}

// --- lane controls ---

function sendControl(lane, action, maxCyclesEl) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const msg = { type: "control", lane, action };
  if (maxCyclesEl && (action === "start" || action === "restart")) {
    const v = parseInt(maxCyclesEl.value, 10);
    msg.maxCycles = Number.isFinite(v) && v > 0 ? v : null;
  }
  ws.send(JSON.stringify(msg));
}

if (globalControlsEl) {
  globalControlsEl.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button[data-act]");
    if (!btn) return;
    sendControl("*", btn.dataset.act, globalMaxCyclesEl);
  });
}

// --- focused-pane rendering (mirrors app.js: textContent only, columns by role) ---

function column(role) {
  if (columns.has(role)) return columns.get(role);
  const col = document.createElement("div");
  col.className = "agent-col";
  const h = document.createElement("h3");
  h.textContent = role;
  const events = document.createElement("div");
  events.className = "events";
  col.append(h, events);
  agentsEl.append(col);
  columns.set(role, events);
  return events;
}

// Build nodes with textContent only — event fields (kind/role/tool/text) are
// untrusted, so never interpolate them into innerHTML.
function render(e) {
  const stale = agentsEl.querySelector(":scope > .empty");
  if (stale) stale.remove();
  const events = column(e.role);
  const div = document.createElement("div");
  div.className = "ev " + e.kind;
  const k = document.createElement("span");
  k.className = "k";
  k.textContent = e.tool ? `${e.kind} ${e.tool}` : e.kind;
  const t = document.createElement("span");
  t.className = "t";
  t.textContent = e.text ?? (e.data ? JSON.stringify(e.data) : "");
  div.append(k, document.createTextNode(" "), t);
  events.append(div);
  events.scrollTop = events.scrollHeight;

  if (e.channel === "orchestrator" || e.kind === "agent.tool_call") {
    const li = document.createElement("li");
    const time = (e.at || "").slice(11, 19);
    const roleSpan = document.createElement("span");
    roleSpan.className = "role";
    roleSpan.textContent = e.role;
    li.append(
      document.createTextNode(time + " "),
      roleSpan,
      document.createTextNode(` ${e.kind}${e.tool ? " · " + e.tool : ""}`),
    );
    timelineEl.append(li);
    timelineEl.scrollTop = timelineEl.scrollHeight;
  }
}

function clearPane() {
  agentsEl.replaceChildren();
  timelineEl.replaceChildren();
  columns = new Map();
  agentsEl.append(
    emptyNode(
      focusedLane
        ? "no events for this lane yet — start it with the ▶ button, or `adapt lane start <laneId> <targetRepo>`."
        : "select a lane on the left to stream its agents.",
    ),
  );
}

// --- cycles view ---

function cycleKey(c) {
  return "c:" + (c.cycle === null ? "pre" : c.cycle);
}
function stepKey(c, s) {
  return "s:" + (c.cycle === null ? "pre" : c.cycle) + ":" + s.index;
}

function isCycleOpen(c, isNewest) {
  const key = cycleKey(c);
  if (!seenCycleKeys.has(key)) {
    seenCycleKeys.add(key);
    if (isNewest || c.status === "running") expanded.add(key);
  }
  return expanded.has(key);
}

function ioBlock(label, text, scrollKey) {
  const block = document.createElement("div");
  block.className = "io-block";
  const h = document.createElement("div");
  h.className = "io-label";
  h.textContent = label;
  const pre = document.createElement("pre");
  pre.className = "io-text";
  pre.dataset.scrollkey = scrollKey;
  pre.textContent = text;
  block.append(h, pre);
  return block;
}

function renderStep(c, s) {
  const row = document.createElement("div");
  row.className = "step " + s.status;

  const key = stepKey(c, s);
  const open = expanded.has(key);

  // A real <button>: focusable, Enter/Space operable, and it advertises its
  // disclosure state. It contains no nested interactive elements, so this is safe.
  const head = document.createElement("button");
  head.type = "button";
  head.className = "step-h";
  head.setAttribute("aria-expanded", String(open));
  const idx = document.createElement("span");
  idx.className = "step-idx";
  idx.textContent = "#" + s.index;
  const role = document.createElement("span");
  role.className = "step-role";
  role.textContent = s.role;
  const status = document.createElement("span");
  status.className = "step-status " + s.status;
  status.textContent = s.status;
  const sum = document.createElement("span");
  sum.className = "step-sum";
  sum.textContent = s.summary;
  head.append(idx, role, status, sum);

  head.addEventListener("click", () => {
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
    renderCycles();
  });
  row.append(head);

  if (open) {
    const detail = document.createElement("div");
    detail.className = "step-detail";
    const prev = s.index > 1 ? c.steps[s.index - 2] : null;
    const inLabel = prev ? `INPUT (from #${prev.index} ${prev.role})` : "INPUT (cycle seed)";
    detail.append(
      ioBlock(inLabel, s.input ?? "(no prompt logged)", key + ":in"),
      ioBlock("OUTPUT", s.output || "(no output)", key + ":out"),
    );
    row.append(detail);
  }
  return row;
}

function renderCycle(c, isNewest) {
  const wrap = document.createElement("div");
  wrap.className = "cycle " + c.status;
  const open = isCycleOpen(c, isNewest);

  const header = document.createElement("button");
  header.type = "button";
  header.className = "cycle-h";
  header.setAttribute("aria-expanded", String(open));
  const caret = document.createElement("span");
  caret.className = "caret";
  caret.setAttribute("aria-hidden", "true");
  caret.textContent = open ? "▼" : "▶";
  const title = document.createElement("span");
  title.className = "cycle-title";
  title.textContent = c.cycle === null ? "pre-cycle" : "Cycle " + c.cycle;
  const dot = document.createElement("span");
  dot.className = "dot " + c.status;
  dot.textContent = c.status === "error" ? "✗" : "●";
  const meta = document.createElement("span");
  meta.className = "cycle-meta";
  const time = (c.startedAt || "").slice(11, 19);
  const n = c.steps.length;
  meta.textContent = `${time ? time + " · " : ""}${n} step${n === 1 ? "" : "s"}`;
  header.append(caret, title, dot, meta);
  header.addEventListener("click", () => {
    const key = cycleKey(c);
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
    renderCycles();
  });
  wrap.append(header);

  if (open) {
    const body = document.createElement("div");
    body.className = "cycle-body";
    for (const s of c.steps) body.append(renderStep(c, s));
    wrap.append(body);
  }
  return wrap;
}

function renderCycles() {
  // Snapshot scroll position + user-resized height of every io-text pane, keyed
  // by step, so a full rebuild on each live event doesn't reset the reader to
  // the top or discard their drag-resize.
  const saved = new Map();
  for (const el of cyclesEl.querySelectorAll("[data-scrollkey]")) {
    saved.set(el.dataset.scrollkey, { top: el.scrollTop, height: el.style.height });
  }
  cyclesEl.replaceChildren();
  if (!focusedLane) {
    cyclesEl.append(emptyNode("select a lane on the left to see its cycles."));
    return;
  }
  const cycles = buildCycles(laneEvents.get(focusedLane) || []);
  if (cycles.length === 0) {
    cyclesEl.append(
      emptyNode(
        "this lane has no recorded events yet.\n" +
          "Start it with the ▶ button above, or `adapt lane start <laneId> <targetRepo>`.",
      ),
    );
    return;
  }
  for (let i = cycles.length - 1; i >= 0; i--) {
    cyclesEl.append(renderCycle(cycles[i], i === cycles.length - 1));
  }
  // Restore height before scrollTop: scrollTop clamps to the element's height.
  for (const el of cyclesEl.querySelectorAll("[data-scrollkey]")) {
    const s = saved.get(el.dataset.scrollkey);
    if (!s) continue;
    if (s.height) el.style.height = s.height;
    el.scrollTop = s.top;
  }
}

function setView(mode) {
  viewMode = mode;
  for (const b of toggleEl.querySelectorAll("button")) {
    const active = b.dataset.view === mode;
    b.classList.toggle("active", active);
    b.setAttribute("aria-pressed", String(active));
  }
  const body = focusBody();
  if (body) body.classList.toggle("cycles-mode", mode === "cycles");
  if (mode === "cycles") renderCycles();
}

toggleEl.addEventListener("click", (ev) => {
  const btn = ev.target.closest("button[data-view]");
  if (btn) setView(btn.dataset.view);
});

// --- sidebar ---

function renderFocusHeader() {
  focusHeaderEl.replaceChildren();
  const meta = focusedLane ? laneMeta(focusedLane) : null;
  if (!meta) {
    const empty = document.createElement("span");
    empty.className = "fh-empty";
    empty.textContent = "no lane focused";
    focusHeaderEl.append(empty);
    return;
  }
  const id = document.createElement("span");
  id.className = "fh-id";
  id.textContent = meta.laneId;
  const status = document.createElement("span");
  status.className = "fh-status " + (meta.status === "running" ? "running" : "stopped");
  status.textContent = meta.status === "running" ? "● running" : "○ stopped";
  const cycle = document.createElement("span");
  cycle.className = "fh-cycle";
  cycle.textContent = `cycle ${meta.cycle ?? 0}`;
  focusHeaderEl.append(id, status, cycle);
}

function renderSidebar() {
  // keep the heading, rebuild lane rows
  lanesEl.replaceChildren();
  const h = document.createElement("div");
  h.className = "lanes-h";
  h.textContent = "lanes";
  lanesEl.append(h);

  if (lanes.length === 0) {
    let msg;
    if (gotLanes) {
      msg =
        "no lanes yet.\nCreate one:\n" +
        "  adapt baseline create v1 <targetRepo>\n" +
        "  adapt lane create a <targetRepo> --baseline v1\n" +
        "  adapt lane start a <targetRepo>";
    } else if (connected) {
      msg = "waiting for the lane list…";
    } else {
      msg = "not connected to the monitor — retrying.";
    }
    lanesEl.append(emptyNode(msg));
    return;
  }

  for (const lane of lanes) {
    const running = lane.status === "running";
    const row = document.createElement("div");
    row.className = "lane " + (running ? "running" : "stopped") + (lane.paused ? " paused" : "");
    if (lane.laneId === focusedLane) row.classList.add("active");

    // The selectable target is a button, not the row: the row also holds the
    // control buttons and the maxCycles input, which may not nest in a button.
    const top = document.createElement("button");
    top.type = "button";
    top.className = "lane-select";
    if (lane.laneId === focusedLane) top.setAttribute("aria-current", "true");
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.setAttribute("aria-hidden", "true");
    dot.textContent = running ? "●" : "○";
    const id = document.createElement("span");
    id.className = "lane-id";
    id.textContent = lane.laneId;
    top.append(dot, id);
    top.addEventListener("click", () => focusLane(lane.laneId));

    const meta = document.createElement("div");
    meta.className = "lane-meta";
    const model = document.createElement("span");
    model.className = "lane-model";
    model.textContent = lane.model ?? "";
    const sep = document.createTextNode(" · ");
    const cycle = document.createElement("span");
    cycle.className = "lane-cycle";
    cycle.textContent = `cycle ${lane.cycle ?? 0}` + (lane.maxCycles != null ? `/${lane.maxCycles}` : "/∞") + (lane.paused ? " (paused)" : "");
    meta.append(model, sep, cycle);

    row.append(top, meta);

    const paused = !!lane.paused;
    const controls = document.createElement("div");
    controls.className = "lane-controls";

    const maxInput = document.createElement("input");
    maxInput.type = "number";
    maxInput.min = "0";
    maxInput.placeholder = "∞";
    maxInput.title = "maxCycles (blank=∞)";
    maxInput.setAttribute("aria-label", `maxCycles for lane ${lane.laneId} (blank = infinite)`);
    if (lane.maxCycles != null) maxInput.value = String(lane.maxCycles);

    // Glyph-only buttons need an accessible name; the visible glyph is decorative.
    const mkBtn = (label, name, action, enabled) => {
      const b = document.createElement("button");
      b.type = "button";
      b.textContent = label;
      b.title = `${name} lane ${lane.laneId}`;
      b.setAttribute("aria-label", `${name} lane ${lane.laneId}`);
      b.disabled = !enabled;
      b.addEventListener("click", () => sendControl(lane.laneId, action, maxInput));
      return b;
    };

    controls.append(
      mkBtn("▶", "start", "start", !running),
      mkBtn("⏸", "pause", "pause", running && !paused),
      mkBtn("▶▶", "continue", "continue", running && paused),
      mkBtn("⟳", "restart", "restart", running),
      mkBtn("■", "stop", "stop", running),
      maxInput,
    );
    row.append(controls);

    lanesEl.append(row);
  }
}

// --- focus handling ---

function focusLane(laneId) {
  focusedLane = laneId;
  clearPane();
  expanded.clear();
  seenCycleKeys.clear();
  renderSidebar();
  renderFocusHeader();
  setView(viewMode);

  const meta = laneMeta(laneId);
  if (meta && meta.status === "running") {
    // replay buffered live events for instant context
    const buf = buffers.get(laneId);
    if (buf) for (const e of buf) render(e);
  }
  // ask server for what it has (full history; drives the cycles view)
  requestHistory(laneId);
}

function requestHistory(laneId) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "focus", lane: laneId }));
  }
}

function bufferEvent(laneId, event) {
  let buf = buffers.get(laneId);
  if (!buf) {
    buf = [];
    buffers.set(laneId, buf);
  }
  buf.push(event);
  if (buf.length > BUFFER_CAP) buf.splice(0, buf.length - BUFFER_CAP);
}

function appendLaneEvent(laneId, event) {
  let list = laneEvents.get(laneId);
  if (!list) {
    list = [];
    laneEvents.set(laneId, list);
  }
  list.push(event);
}

// --- message handling ---

function handleMessage(msg) {
  if (msg.type === "lanes") {
    lanes = Array.isArray(msg.lanes) ? msg.lanes : [];
    gotLanes = true;
    // auto-focus first running lane (or first lane) if nothing focused yet
    if (focusedLane === null && lanes.length > 0) {
      const first = lanes.find((l) => l.status === "running") || lanes[0];
      // render sidebar first so the focus highlight is consistent
      renderSidebar();
      focusLane(first.laneId);
      return;
    }
    // preserve focus; if focused lane vanished, drop focus
    if (focusedLane !== null && !laneMeta(focusedLane)) {
      focusedLane = null;
      clearPane();
      if (viewMode === "cycles") renderCycles();
    }
    renderSidebar();
    renderFocusHeader();
    return;
  }

  if (msg.type === "event") {
    bufferEvent(msg.lane, msg.event);
    appendLaneEvent(msg.lane, msg.event);
    if (msg.lane === focusedLane) {
      render(msg.event);
      if (viewMode === "cycles") renderCycles();
    }
    return;
  }

  if (msg.type === "history") {
    // History is the authoritative full log on arrival, and it already contains
    // everything the live buffer replayed — so the stream pane is rebuilt from
    // it rather than appended to, otherwise every focus (and every reconnect)
    // renders each event twice. A live event racing in just before this reply is
    // self-healing: the next live event triggers a fresh buildCycles.
    if (Array.isArray(msg.events)) laneEvents.set(msg.lane, msg.events.slice());
    if (msg.lane === focusedLane) {
      clearPane();
      for (const e of msg.events || []) render(e);
      if (viewMode === "cycles") renderCycles();
    }
    return;
  }
}

// --- connection ---

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 10000;
let retryDelay = RETRY_MIN_MS;

function connect() {
  // wss when the page itself is served over TLS, so the monitor survives being
  // put behind a reverse proxy.
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${scheme}//${location.host}/ws`);

  ws.onopen = () => {
    connected = true;
    statusEl.textContent = "connected";
    statusEl.className = "connected";
    retryDelay = RETRY_MIN_MS;
    if (lanes.length === 0) renderSidebar();
    // Events emitted while the socket was down were never delivered. Re-request
    // the focused lane's history so the log has no silent hole; the `history`
    // branch replaces the lane's events wholesale, which repairs the gap.
    if (focusedLane) requestHistory(focusedLane);
  };

  ws.onclose = () => {
    connected = false;
    statusEl.textContent = `disconnected · retrying in ${Math.round(retryDelay / 1000)}s`;
    statusEl.className = "disconnected";
    if (lanes.length === 0) renderSidebar();
    setTimeout(connect, retryDelay);
    retryDelay = Math.min(Math.round(retryDelay * 1.5), RETRY_MAX_MS);
  };

  ws.onmessage = (msg) => {
    try {
      handleMessage(JSON.parse(msg.data));
    } catch {}
  };
}

// Paint the empty state immediately so the first frame explains itself, and
// apply the default view so the markup matches the pre-selected toggle button.
renderSidebar();
clearPane();
setView(viewMode);
connect();

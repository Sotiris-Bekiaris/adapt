import { buildCycles } from "/cycles.js";

const statusEl = document.getElementById("status");
const lanesEl = document.getElementById("lanes");
const focusHeaderEl = document.getElementById("focus-header");
const agentsEl = document.getElementById("agents");
const timelineEl = document.getElementById("timeline-list");
const focusMainQuery = () => document.querySelector(".focus-body");
const cyclesEl = document.getElementById("cycles");
const toggleEl = document.getElementById("view-toggle");

const BUFFER_CAP = 500;

let ws = null;
let focusedLane = null;
let lanes = []; // latest [{ laneId, model, baseline, status, cycle }]
const buffers = new Map(); // laneId -> event[]
let columns = new Map(); // role -> events container (for focused lane)
let viewMode = "cycles"; // "stream" | "cycles"
const laneEvents = new Map(); // laneId -> full ConsoleEvent[] (history + live), source for buildCycles
const expanded = new Set(); // expand keys: cycle "c:<n>" and step "s:<n>:<idx>"
const seenCycleKeys = new Set(); // cycles whose default-open has been applied

function laneMeta(laneId) {
  return lanes.find((l) => l.laneId === laneId) || null;
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

function ioBlock(label, text) {
  const block = document.createElement("div");
  block.className = "io-block";
  const h = document.createElement("div");
  h.className = "io-label";
  h.textContent = label;
  const pre = document.createElement("pre");
  pre.className = "io-text";
  pre.textContent = text;
  block.append(h, pre);
  return block;
}

function renderStep(c, s) {
  const row = document.createElement("div");
  row.className = "step " + s.status;

  const head = document.createElement("div");
  head.className = "step-h";
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

  const key = stepKey(c, s);
  head.addEventListener("click", () => {
    if (expanded.has(key)) expanded.delete(key);
    else expanded.add(key);
    renderCycles();
  });
  row.append(head);

  if (expanded.has(key)) {
    const detail = document.createElement("div");
    detail.className = "step-detail";
    const prev = s.index > 1 ? c.steps[s.index - 2] : null;
    const inLabel = prev ? `INPUT (from #${prev.index} ${prev.role})` : "INPUT (cycle seed)";
    detail.append(
      ioBlock(inLabel, s.input ?? "(no prompt logged)"),
      ioBlock("OUTPUT", s.output || "(no output)"),
    );
    row.append(detail);
  }
  return row;
}

function renderCycle(c, isNewest) {
  const wrap = document.createElement("div");
  wrap.className = "cycle " + c.status;
  const open = isCycleOpen(c, isNewest);

  const header = document.createElement("div");
  header.className = "cycle-h";
  const caret = document.createElement("span");
  caret.className = "caret";
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
  cyclesEl.replaceChildren();
  if (!focusedLane) return;
  const cycles = buildCycles(laneEvents.get(focusedLane) || []);
  for (let i = cycles.length - 1; i >= 0; i--) {
    cyclesEl.append(renderCycle(cycles[i], i === cycles.length - 1));
  }
}

function setView(mode) {
  viewMode = mode;
  for (const b of toggleEl.querySelectorAll("button")) {
    b.classList.toggle("active", b.dataset.view === mode);
  }
  const body = focusMainQuery();
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

  for (const lane of lanes) {
    const running = lane.status === "running";
    const row = document.createElement("div");
    row.className = "lane " + (running ? "running" : "stopped");
    if (lane.laneId === focusedLane) row.classList.add("active");

    const top = document.createElement("div");
    top.className = "lane-top";
    const dot = document.createElement("span");
    dot.className = "dot";
    dot.textContent = running ? "●" : "○";
    const id = document.createElement("span");
    id.className = "lane-id";
    id.textContent = lane.laneId;
    top.append(dot, id);

    const meta = document.createElement("div");
    meta.className = "lane-meta";
    const model = document.createElement("span");
    model.className = "lane-model";
    model.textContent = lane.model ?? "";
    const sep = document.createTextNode(" · ");
    const cycle = document.createElement("span");
    cycle.className = "lane-cycle";
    cycle.textContent = `cycle ${lane.cycle ?? 0}`;
    meta.append(model, sep, cycle);

    row.append(top, meta);
    row.addEventListener("click", () => focusLane(lane.laneId));
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
    // History is the authoritative full log on arrival; replace whatever live
    // events accumulated for this lane. A live event racing in just before this
    // reply is self-healing — the next live event triggers a fresh buildCycles.
    if (Array.isArray(msg.events)) laneEvents.set(msg.lane, msg.events.slice());
    if (msg.lane === focusedLane) {
      for (const e of msg.events || []) render(e);
      if (viewMode === "cycles") renderCycles();
    }
    return;
  }
}

// --- connection ---

function connect() {
  ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => {
    statusEl.textContent = "connected";
    statusEl.className = "connected";
  };
  ws.onclose = () => {
    statusEl.textContent = "disconnected · retrying";
    statusEl.className = "disconnected";
    setTimeout(connect, 1000);
  };
  ws.onmessage = (msg) => {
    try {
      handleMessage(JSON.parse(msg.data));
    } catch {}
  };
}
connect();

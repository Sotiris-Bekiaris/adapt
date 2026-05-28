const statusEl = document.getElementById("status");
const lanesEl = document.getElementById("lanes");
const focusHeaderEl = document.getElementById("focus-header");
const agentsEl = document.getElementById("agents");
const timelineEl = document.getElementById("timeline-list");

const BUFFER_CAP = 500;

let ws = null;
let focusedLane = null;
let lanes = []; // latest [{ laneId, model, baseline, status, cycle }]
const buffers = new Map(); // laneId -> event[]
let columns = new Map(); // role -> events container (for focused lane)

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
  renderSidebar();
  renderFocusHeader();

  const meta = laneMeta(laneId);
  if (meta && meta.status === "running") {
    // replay buffered live events for instant context
    const buf = buffers.get(laneId);
    if (buf) for (const e of buf) render(e);
  }
  // ask server for what it has (history for stopped lanes; harmless otherwise)
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
    if (msg.lane === focusedLane) render(msg.event);
    return;
  }

  if (msg.type === "history") {
    if (msg.lane === focusedLane && Array.isArray(msg.events)) {
      for (const e of msg.events) render(e);
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

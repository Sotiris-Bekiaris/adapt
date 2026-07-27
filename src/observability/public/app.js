const statusEl = document.getElementById("status");
const agentsEl = document.getElementById("agents");
const timelineEl = document.getElementById("timeline-list");
const columns = new Map();

// --- empty state -------------------------------------------------------------
// The console is blank until something streams to it, and the most common reason
// for silence is that no loop is attached — say so instead of showing a void.
let placeholder = null;

function showPlaceholder(text) {
  if (!placeholder) {
    placeholder = document.createElement("p");
    placeholder.className = "empty";
  }
  placeholder.textContent = text;
  if (placeholder.parentNode !== agentsEl) agentsEl.append(placeholder);
}

function hidePlaceholder() {
  if (placeholder && placeholder.parentNode) placeholder.remove();
}

// This page only ever shows the process that serves it — it cannot attach to a
// loop running elsewhere — so the hint has to name the command that serves it.
const WAITING =
  "waiting for agent events.\n" +
  "This console shows only the run it is served from.\n" +
  "To watch a real loop, serve the console from the loop itself:\n" +
  "  adapt run <targetRepo> --console " +
  (location.port || "4399");

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

// Build nodes with textContent only — event fields (kind/role/tool/text) may be
// untrusted once real engines stream, so never interpolate them into innerHTML.
function render(e) {
  hidePlaceholder();
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

function resetView() {
  agentsEl.replaceChildren();
  timelineEl.replaceChildren();
  columns.clear();
  placeholder = null;
}

// --- connection --------------------------------------------------------------

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 10000;
let retryDelay = RETRY_MIN_MS;

function connect() {
  // wss when the page itself is served over TLS, so the console survives being
  // put behind a reverse proxy.
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${scheme}//${location.host}/ws`);

  ws.onopen = () => {
    statusEl.textContent = "connected";
    statusEl.className = "connected";
    retryDelay = RETRY_MIN_MS;
    // The server replays its full recent-event backlog on every connection, so
    // the view must be rebuilt from scratch — otherwise each reconnect appends a
    // second copy of the history.
    resetView();
    showPlaceholder(WAITING);
  };

  ws.onclose = () => {
    statusEl.textContent = `disconnected · retrying in ${Math.round(retryDelay / 1000)}s`;
    statusEl.className = "disconnected";
    // Only speak up in the pane while it is still empty; once events are on
    // screen the status pill carries the connection state and the log stays put.
    if (columns.size === 0) {
      showPlaceholder(
        "not connected to the event stream.\n" +
          "Retrying automatically — check that the console is still running.",
      );
    }
    setTimeout(connect, retryDelay);
    retryDelay = Math.min(Math.round(retryDelay * 1.5), RETRY_MAX_MS);
  };

  ws.onmessage = (msg) => {
    try {
      render(JSON.parse(msg.data));
    } catch {}
  };
}

showPlaceholder("connecting…");
connect();

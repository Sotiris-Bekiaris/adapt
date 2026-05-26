const statusEl = document.getElementById("status");
const agentsEl = document.getElementById("agents");
const timelineEl = document.getElementById("timeline-list");
const columns = new Map();

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

function connect() {
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onopen = () => { statusEl.textContent = "connected"; statusEl.className = "connected"; };
  ws.onclose = () => { statusEl.textContent = "disconnected · retrying"; statusEl.className = "disconnected"; setTimeout(connect, 1000); };
  ws.onmessage = (msg) => { try { render(JSON.parse(msg.data)); } catch {} };
}
connect();

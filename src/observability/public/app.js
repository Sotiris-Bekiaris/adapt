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

function render(e) {
  const events = column(e.role);
  const div = document.createElement("div");
  div.className = "ev " + e.kind;
  const label = e.tool ? `${e.kind} ${e.tool}` : e.kind;
  div.innerHTML = `<span class="k">${label}</span> <span class="t"></span>`;
  div.querySelector(".t").textContent = e.text ?? (e.data ? JSON.stringify(e.data) : "");
  events.append(div);
  events.scrollTop = events.scrollHeight;

  if (e.channel === "orchestrator" || e.kind === "agent.tool_call") {
    const li = document.createElement("li");
    const time = (e.at || "").slice(11, 19);
    li.innerHTML = `${time} <span class="role">${e.role}</span> ${e.kind}${e.tool ? " · " + e.tool : ""}`;
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

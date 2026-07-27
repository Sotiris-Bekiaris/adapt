// ds-proxy — request-normalizing proxy for an Anthropic-compatible third-party endpoint.
//
// WHY THIS EXISTS
//   Claude Code sends thinking:{type:"adaptive"} for main-agent calls, but
//   thinking:{type:"disabled"} for subagent dispatches. A reasoning model on the receiving end
//   REJECTS disabled thinking with HTTP 400, worded as "thinking options type cannot be disabled
//   when reasoning_effort is set". There is no top-level reasoning_effort field to strip — the
//   conflict is the "disabled" type itself, and Claude Code offers no way to turn it off.
//
// WHAT IT REWRITES — exactly one thing, and only on agent turns:
//   For POST requests whose path contains "/v1/messages" and does NOT contain "count_tokens",
//   if the JSON body has thinking.type === "disabled", it is replaced with "adaptive".
//   Everything else is byte-for-byte passthrough:
//     - other paths, other methods, and token-counting calls are untouched
//     - a body that is not JSON, or not shaped as expected, passes through unchanged
//     - request headers are forwarded as-is apart from Host and Content-Length
//     - the Authorization header is forwarded verbatim; nothing is logged or stored here
//     - responses (including streaming ones) are piped straight back to the caller
//
// USAGE
//   node scripts/ds-proxy.mjs [port] [upstreamHost]
//   node scripts/ds-proxy.mjs                       # 127.0.0.1:8788 -> api.deepseek.com
//   node scripts/ds-proxy.mjs 9000
//   node scripts/ds-proxy.mjs 8788 api.example.com
//   node scripts/ds-proxy.mjs --help
//
//   Equivalent environment variables (argv wins):
//     DS_PROXY_PORT      default 8788
//     DS_PROXY_HOST      default 127.0.0.1 — loopback on purpose; this proxy has no auth
//     DS_PROXY_UPSTREAM  default api.deepseek.com
//
//   The request path is forwarded unchanged, so point ANTHROPIC_BASE_URL at this proxy including
//   whatever path prefix the upstream's Anthropic-compatible API lives under, e.g.
//     ANTHROPIC_BASE_URL=http://127.0.0.1:8788/anthropic
//   See scripts/deepseek.env.example. scripts/run-autonomous.sh starts this proxy for you.
import http from "node:http";
import https from "node:https";

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(
    "usage: node scripts/ds-proxy.mjs [port] [upstreamHost]\n" +
    "  port          default 8788           (or DS_PROXY_PORT)\n" +
    "  upstreamHost  default api.deepseek.com (or DS_PROXY_UPSTREAM)\n" +
    "  bind address  default 127.0.0.1      (DS_PROXY_HOST)\n",
  );
  process.exit(0);
}

const PORT = Number(argv[0] ?? process.env.DS_PROXY_PORT ?? 8788);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  process.stderr.write(`ds-proxy: invalid port "${argv[0] ?? process.env.DS_PROXY_PORT}" — expected an integer 1-65535\n`);
  process.exit(1);
}
const BIND = process.env.DS_PROXY_HOST ?? "127.0.0.1";
const UPSTREAM_HOST = argv[1] ?? process.env.DS_PROXY_UPSTREAM ?? "api.deepseek.com";

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    let body = Buffer.concat(chunks);
    const isMessages = req.method === "POST" && req.url.includes("/v1/messages") && !req.url.includes("count_tokens");
    if (isMessages) {
      try {
        const j = JSON.parse(body.toString("utf8"));
        if (j && j.thinking && j.thinking.type === "disabled") {
          j.thinking = { type: "adaptive" };   // match the shape the upstream already accepts
          body = Buffer.from(JSON.stringify(j), "utf8");
        }
      } catch { /* not JSON we understand — pass through unchanged */ }
    }
    const headers = { ...req.headers, host: UPSTREAM_HOST, "content-length": Buffer.byteLength(body) };
    const up = https.request(
      { host: UPSTREAM_HOST, port: 443, path: req.url, method: req.method, headers },
      (ur) => { res.writeHead(ur.statusCode ?? 502, ur.headers); ur.pipe(res); },
    );
    up.on("error", (e) => { if (!res.headersSent) res.writeHead(502); res.end(`ds-proxy upstream error: ${e.message}`); });
    up.end(body);
  });
  req.on("error", () => { if (!res.headersSent) res.writeHead(400); res.end(); });
});

server.on("error", (e) => {
  const hint = e.code === "EADDRINUSE"
    ? ` — port ${PORT} is already in use (another ds-proxy?). Pass a different port, or stop it.`
    : "";
  process.stderr.write(`ds-proxy: ${e.message}${hint}\n`);
  process.exit(1);
});

server.listen(PORT, BIND, () =>
  console.log(`ds-proxy → https://${UPSTREAM_HOST} on http://${BIND}:${PORT} (rewrites thinking:disabled -> adaptive)`));

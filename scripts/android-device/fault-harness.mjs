// Device-test fault harness (MA5-S1R2, reusable): disposable Host + fault proxy between the gateway and the Host
// + loopback control API. Never point it at the owner's Host. Usage: node --experimental-strip-types fault-harness.mjs <worktree> <stateDir>
import { createServer, request as httpRequest } from "node:http";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [worktree, stateDir] = process.argv.slice(2);
const { startHost } = await import(pathToFileURL(join(worktree, "src/lib/bunny-host/http.server.ts")).href);
const { defaultAdapters } = await import(pathToFileURL(join(worktree, "src/lib/bunny-host/adapters.server.ts")).href);
const HOST_PORT = 43391, PROXY_PORT = 43392, CONTROL_PORT = 43393;
const dataDirectory = join(stateDir, "host");
mkdirSync(dataDirectory, { recursive: true });
const logFile = join(stateDir, "commands.log");
let host;
let mode = "pass"; // pass | lose-answer | drop-before | drop-status
const log = (entry) => appendFileSync(logFile, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");

async function boot() {
  host = await startHost({ dataDirectory, root: dataDirectory, port: HOST_PORT, adapters: defaultAdapters().filter((a) => a.id === "ollama") });
  writeFileSync(join(stateDir, "gateway-credentials.json"), JSON.stringify({ token: host.token, port: PROXY_PORT }));
  log({ event: "host.started" });
}
await boot();

const owner = async (action, data = {}) => {
  const r = await fetch(`http://127.0.0.1:${HOST_PORT}/command`, { method: "POST", headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json", connection: "close" }, body: JSON.stringify({ action, data }) });
  return r.json();
};
const ownerState = async () => (await fetch(`http://127.0.0.1:${HOST_PORT}/state`, { headers: { authorization: `Bearer ${host.token}`, connection: "close" } })).json();

createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    let parsed = null;
    try { parsed = req.method === "POST" && req.url === "/command" ? JSON.parse(body.toString("utf8")) : null; } catch { /* not json */ }
    const device = (req.headers.authorization ?? "") !== `Bearer ${host.token}`;
    const fault = device && parsed && (mode === "lose-answer" || mode === "drop-before" || mode === "lose-hold") && parsed.action === "submit" ? (mode === "lose-hold" ? "lose-answer" : mode)
      : device && parsed && mode === "drop-status" && parsed.action === "operation.status" ? "drop-before" : null;
    if (parsed) log({ event: "command", device, action: parsed.action, operationId: parsed.operationId ?? null, expect: parsed.expect ?? null, data: parsed.action === "operation.status" ? parsed.data : undefined, fault });
    // lose-hold: lose the submit's answer, then also drop status checks until the mode is changed.
    if (fault) { if (mode === "lose-hold") mode = "drop-status"; else if (mode !== "drop-status") mode = "pass"; }
    if (fault === "drop-before") { req.socket.destroy(); return; }
    const upstream = httpRequest({ host: "127.0.0.1", port: HOST_PORT, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${HOST_PORT}` } }, (answer) => {
      const parts = [];
      answer.on("data", (c) => parts.push(c));
      answer.on("end", () => {
        const text = Buffer.concat(parts);
        if (parsed) log({ event: "answer", action: parsed.action, status: answer.statusCode, delivered: fault !== "lose-answer", body: parsed.action === "operation.status" || fault ? text.toString("utf8").slice(0, 400) : undefined });
        // The Host applied the command; its answer never reaches the gateway.
        if (fault === "lose-answer") { req.socket.destroy(); return; }
        res.writeHead(answer.statusCode, answer.headers);
        res.end(text);
      });
    });
    upstream.on("error", () => req.socket.destroy());
    upstream.end(body);
  });
}).listen(PROXY_PORT, "127.0.0.1");

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  try {
    let out;
    if (url.pathname === "/mode") { mode = url.searchParams.get("set") ?? mode; out = { mode }; }
    else if (url.pathname === "/pair-code") out = { pairCode: (await owner("pairing.create")).pairCode };
    else if (url.pathname === "/state") {
      const s = await ownerState();
      out = { hostIdentity: s.hostIdentity, tasks: s.tasks.map((t) => ({ id: t.id, state: t.state, provider: t.provider, model: t.model, prompt: String(t.prompt ?? "").slice(0, 60), output: String(t.output ?? "").slice(0, 200) })), devices: s.devices ?? s.pairedDevices ?? null };
    }
    else if (url.pathname === "/restart-host") { await host.close(); log({ event: "host.stopped" }); await boot(); out = { restarted: true }; }
    else if (url.pathname === "/stop-host") { await host.close(); log({ event: "host.stopped" }); out = { stopped: true }; }
    else if (url.pathname === "/start-host") { await boot(); out = { started: true }; }
    else if (url.pathname === "/owner") out = await owner(url.searchParams.get("action"), JSON.parse(url.searchParams.get("data") ?? "{}"));
    else { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(out, null, 1));
  } catch (e) { res.writeHead(500); res.end(String(e?.stack ?? e)); }
}).listen(CONTROL_PORT, "127.0.0.1");
console.log(`harness ready: host ${HOST_PORT}, proxy ${PROXY_PORT}, control ${CONTROL_PORT}, state ${stateDir}`);

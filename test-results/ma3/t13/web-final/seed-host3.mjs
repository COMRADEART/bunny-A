// T13 web-final lane: a DISPOSABLE Host on an assigned 4388x port with four real bound Personal Agent
// slots in four different presentation states (VERIFIED, WAITING_FOR_USER, PAUSED, IDLE). Capability steps only.
// Production (43119, 8084, %LOCALAPPDATA%\Bunny-A) is never touched. Credentials go only to the scratchpad.
// Control: create file `close` in this dir to stop; file `snapshot` writes host-state.json.
import { fork } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, existsSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
const here = resolve(import.meta.dirname);
// Stale run-control files from a previous aborted run would stop this host within 500 ms.
for (const control of ["close", "snapshot", "host-error.txt"]) { try { unlinkSync(join(here, control)); } catch {} }
const repo = resolve(import.meta.dirname, "../../../..");
const scratchRoot = process.env.T13_PERF_SCRATCH;
const port = Number(process.env.T13_PERF_PORT ?? 43881);
if (!/^438(8\d)$/.test(String(port))) throw new Error("refusing a non-assigned port");
if (port === 43119 || port === 8084) throw new Error("refusing production port");
const scratch = join(scratchRoot ?? tmpdir(), "bunny-t13-perf-host");
const data = join(scratch, "state");
const workspace = join(scratch, "workspace");
rmSync(scratch, { recursive: true, force: true });
mkdirSync(data, { recursive: true });
mkdirSync(workspace, { recursive: true });
writeFileSync(join(workspace, "receipt.txt"), "T13 perf receipt.");
const child = fork(join(repo, "scripts/fixtures/project-host-worker.mjs"), [data, workspace, String(port)], {
  cwd: repo, execArgv: ["--experimental-strip-types"], stdio: ["ignore", "pipe", "pipe", "ipc"], windowsHide: true,
});
child.stderr.on("data", (c) => process.stderr.write(`[host] ${c}`));
child.stdout.on("data", () => {});
const ready = await new Promise((done, reject) => {
  child.once("message", done);
  child.once("exit", (code) => reject(new Error(`Host exited ${code}`)));
});
const credentials = join(scratch, "credentials.json");
writeFileSync(credentials, JSON.stringify({ token: ready.token, port }));
const base = `http://127.0.0.1:${port}`;
const command = async (action, body = {}) => {
  const response = await fetch(`${base}/command`, { method: "POST", headers: { authorization: `Bearer ${ready.token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data: body }) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${action} refused: ${json.error ?? response.status}`);
  return json;
};
const state = async () => (await fetch(`${base}/state`, { headers: { authorization: `Bearer ${ready.token}` } })).json();
await command("mission.configure", { enabled: true });
const steps = () => [{ role: "Read receipt", objective: "Read the disposable receipt", access: "read", executor: { kind: "capability", action: "filesystem.read", params: { path: "receipt.txt" } }, verification: [{ kind: "capability", action: "filesystem.compare", params: { path: "receipt.txt", content: "T13 perf receipt." }, expect: { field: "matches", equals: true } }], crossApp: true }];
const names = ["Receipt verification", "Permission review", "Paused research", "Idle sword"];
const ids = {};
for (const name of names) {
  const before = new Set((await state()).agents.agents.map((a) => a.id));
  await command("agent.create", { name, objective: `${name} (T13 perf fixture)`, steps: steps() });
  ids[name] = (await state()).agents.agents.find((a) => !before.has(a.id)).id;
}
{
  const id = ids["Receipt verification"];
  const proposal = await command("agent.authorization.propose", { id });
  const revision = proposal.snapshot.agents.agents.find((a) => a.id === id).authorization.revision;
  await command("agent.authorization.approve", { id, revision });
}
await command("agent.authorization.propose", { id: ids["Permission review"] });
await command("agent.pause", { id: ids["Paused research"] });
for (let i = 0; i < 100; i++) { if ((await state()).agents.agents.find((a) => a.id === ids["Receipt verification"])?.state === "COMPLETED") break; await new Promise((d) => setTimeout(d, 100)); }
const slots = [
  { slot: 1, weapon: "gada", displayName: "Research Gada", agentId: ids["Receipt verification"] },
  { slot: 2, weapon: "spear", displayName: "Review Spear", agentId: ids["Permission review"] },
  { slot: 3, weapon: "chakra", displayName: "Build Chakra", agentId: ids["Paused research"] },
  { slot: 4, weapon: "sword", displayName: "Test Sword", agentId: ids["Idle sword"] },
].map((s) => ({ ...s, description: "", purpose: "", style: "concise", responsibilities: [], active: true }));
const saved = await command("personal_agents.configure", { slots, expectRevision: 0 });
const snap = saved.snapshot ?? (await state());
const record = { classification: "DISPOSABLE LIVE FIXTURE (T13 web-final lane)", port, pid: ready.pid, credentials, agentIds: ids, slotRevision: snap.personalAgents?.revision ?? null, slotStates: (snap.personalAgents?.slots ?? []).map((s) => ({ slot: s.slot, weapon: s.weapon, state: s.presentation?.state ?? null, label: s.presentation?.label ?? null, basis: s.presentation?.basis?.kind ?? null })) };
writeFileSync(join(here, "host-fixture.json"), JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify(record));
setInterval(async () => {
  try {
    if (existsSync(join(here, "close"))) { unlinkSync(join(here, "close")); child.send("close"); setTimeout(() => process.exit(0), 1500); }
    if (existsSync(join(here, "snapshot"))) { unlinkSync(join(here, "snapshot")); writeFileSync(join(here, "host-state.json"), JSON.stringify(await state(), null, 2)); }
  } catch (e) { writeFileSync(join(here, "host-error.txt"), String(e?.stack ?? e)); }
}, 500);
child.on("exit", () => process.exit(0));
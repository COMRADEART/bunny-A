// M-A-3 T14 harness (adapted from the Widget Studio seed): a DISPOSABLE real Host (host-worker.mjs) on 43893-43899 with
// temp state, seeded through the real commands with the four Personal Agents in four different live T14 phases:
//   Gada   - COMPLETE (verified): one read step, verified by the Host's own npm test.
//   Spear  - EXECUTE with a derived worker running (long npm test) under the parent's approval.
//   Chakra - RECONCILIATION_REQUIRED: its write lost the connection after dispatch (N-C pause, never replayed).
//   Sword  - WAITING_AUTHORIZATION: plan waiting for the owner.
// Production (43119, 8084, %LOCALAPPDATA%\Bunny-A) is never addressed. Usage: node seed-host.mjs [port] [scratchDir]
import { fork } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "../../..");
const port = Number(process.argv[2] ?? 43893);
if (!/^4389[3-9]$/.test(String(port))) throw new Error("T14 harness Hosts only on 43893-43899.");
const scratch = resolve(process.argv[3] ?? join(tmpdir(), `bunny-t14-host-${port}`));
const data = join(scratch, "state");
const workspace = join(scratch, "workspace");
rmSync(scratch, { recursive: true, force: true });
mkdirSync(data, { recursive: true });
mkdirSync(workspace, { recursive: true });

const child = fork(join(import.meta.dirname, "host-worker.mjs"), [data, workspace, String(port)], {
  cwd: repo,
  execArgv: ["--experimental-strip-types"],
  stdio: ["ignore", "pipe", "pipe", "ipc"],
  windowsHide: true,
});
child.stderr.on("data", (chunk) => process.stderr.write(`[host] ${chunk}`));
child.stdout.on("data", () => {});
const ready = await new Promise((done, reject) => {
  child.once("message", done);
  child.once("exit", (code) => reject(new Error(`Host exited ${code}`)));
});
const release = (kind, failure) => new Promise((done) => { child.once("message", done); child.send({ release: kind, ...(failure ? { ok: false, error: failure } : {}) }); });
const base = `http://127.0.0.1:${port}`;
const command = async (action, body = {}) => {
  const response = await fetch(`${base}/command`, { method: "POST", headers: { authorization: `Bearer ${ready.token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data: body }) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${action} refused: ${json.error ?? response.status}`);
  return json;
};
const state = async () => (await fetch(`${base}/state`, { headers: { authorization: `Bearer ${ready.token}` } })).json();
const until = async (check, label, ms = 60_000) => {
  const end = Date.now() + ms;
  for (;;) { const value = await check(); if (value) return value; if (Date.now() > end) throw new Error(`timeout ${label}`); await new Promise((r) => setTimeout(r, 150)); }
};
const mission = async (id) => (await state()).missions.missions.find((m) => m.id === id);

await command("mission.configure", { enabled: true });
const project = async (name, testMs) => {
  const path = join(workspace, name.replace(/\W+/g, "-"));
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "package.json"), JSON.stringify({ name: "fixture", private: true, scripts: { test: `node -e "setTimeout(() => process.exit(0), ${testMs})"` } }));
  return (await command("project.add", { name, path })).data.id;
};
const verify = [{ kind: "command", command: "npm", args: ["test"], expectExit: 0 }];
const delegate = async (slot, name, projectId, steps, start = true) => {
  const agentId = (await command("personal_agent.delegate", { slot, objective: `${name} (T14 harness fixture)`, title: name, projectId, steps })).data.agentId;
  const missionId = (await state()).agents.agents.find((a) => a.id === agentId).missionId;
  await until(async () => (await mission(missionId))?.state === "waiting_for_approval", `${name} plan`);
  if (start) await command("agent.start", { id: agentId });
  return { agentId, missionId };
};

const projects = { gada: await project("Gada site", 50), spear: await project("Spear api", 30 * 60_000), chakra: await project("Chakra docs", 50), sword: await project("Sword tool", 50) };
const gada = await delegate(1, "Gada verified release check", projects.gada, [{ role: "Reviewer", objective: "Check the site", access: "read", verification: verify }]);
await new Promise((r) => setTimeout(r, 500));
await release("read");
await until(async () => (await mission(gada.missionId))?.state === "completed", "Gada complete");
const chakra = await delegate(3, "Chakra docs rewrite", projects.chakra, [{ role: "Writer", objective: "Rewrite the docs", access: "write" }]);
await new Promise((r) => setTimeout(r, 500));
await release("write", "connection reset after the request was sent");
await until(async () => (await mission(chakra.missionId))?.state === "waiting_for_user", "Chakra paused");
const spear = await delegate(2, "Spear api hardening", projects.spear, [{ role: "Implementer", objective: "Harden the API", access: "read", verification: verify }]);
await until(async () => (await mission(spear.missionId))?.state === "running", "Spear running");
const worker = (await command("worker.propose", { slot: 2, parentMissionId: spear.missionId, ability: "test", objective: "Run the API tests", projectId: projects.spear })).data.worker;
await until(async () => (await mission(worker.childMissionId))?.state === "running", "worker running");
const sword = await delegate(4, "Sword tool plan", projects.sword, [{ role: "Planner", objective: "Plan the tool", access: "read" }], false);

const record = {
  classification: "DISPOSABLE LIVE FIXTURE",
  port, pid: ready.pid, hostGeneration: ready.generation, dataDirectory: data,
  credentialsFile: join(data, "credentials.json"),
  slots: { 1: gada, 2: { ...spear, workerMissionId: worker.childMissionId }, 3: chakra, 4: sword },
  expected: { 1: "COMPLETE", 2: "EXECUTE", 3: "RECONCILIATION_REQUIRED", 4: "WAITING_AUTHORIZATION" },
};
writeFileSync(join(import.meta.dirname, `host-state-${port}.json`), JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify({ ready: true, port, pid: ready.pid }));
const stop = () => { if (child.exitCode === null) child.send("close"); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => { console.log(`[seed-host] Host exited ${code}`); process.exit(0); });

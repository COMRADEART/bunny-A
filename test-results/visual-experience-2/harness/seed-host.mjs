// Visual Experience 2.0 harness: a DISPOSABLE real Host (harness/host-worker.mjs: real Host code + one labelled fixture provider) on a 4389x port
// with temp state, seeded with four Agents bound to the four Personal Agent slots through the real commands.
// Production (43119, 8084, %LOCALAPPDATA%\Bunny-A) is never addressed. Credentials stay in the scratch directory.
// Usage: node seed-host.mjs [port] [scratchDir]   (stays up until killed; writes host-state.json beside this file)
import { fork } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "../../..");
const port = Number(process.argv[2] ?? 43890);
if (!/^4389\d$/.test(String(port))) throw new Error("VE2 harness Hosts only on 43890-43899.");
const scratch = resolve(process.argv[3] ?? join(tmpdir(), `bunny-ve2-host-${port}`));
const data = join(scratch, "state");
const workspace = join(scratch, "workspace");
rmSync(scratch, { recursive: true, force: true });
mkdirSync(data, { recursive: true });
mkdirSync(workspace, { recursive: true });
writeFileSync(join(workspace, "receipt.txt"), "VE2 receipt.");

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
const base = `http://127.0.0.1:${port}`;
const command = async (action, body = {}) => {
  const response = await fetch(`${base}/command`, {
    method: "POST",
    headers: { authorization: `Bearer ${ready.token}`, "content-type": "application/json" },
    body: JSON.stringify({ action, data: body }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${action} refused: ${json.error ?? response.status}`);
  return json;
};
const state = async () => (await fetch(`${base}/state`, { headers: { authorization: `Bearer ${ready.token}` } })).json();

await command("mission.configure", { enabled: true });
const steps = () => [
  {
    role: "Read receipt",
    objective: "Read the disposable receipt",
    access: "read",
    executor: { kind: "capability", action: "filesystem.read", params: { path: "receipt.txt" } },
    verification: [
      { kind: "capability", action: "filesystem.compare", params: { path: "receipt.txt", content: "VE2 receipt." }, expect: { field: "matches", equals: true } },
    ],
    crossApp: true,
  },
];
const names = ["Receipt verification", "Permission review", "Paused research", "Idle sword"];
const ids = {};
for (const name of names) {
  const before = new Set((await state()).agents.agents.map((agent) => agent.id));
  await command("agent.create", { name, objective: `${name} (VE2 harness fixture)`, steps: steps() });
  ids[name] = (await state()).agents.agents.find((agent) => !before.has(agent.id)).id;
}
{
  const id = ids["Receipt verification"];
  const proposal = await command("agent.authorization.propose", { id });
  const revision = proposal.snapshot.agents.agents.find((agent) => agent.id === id).authorization.revision;
  await command("agent.authorization.approve", { id, revision });
}
await command("agent.authorization.propose", { id: ids["Permission review"] });
await command("agent.pause", { id: ids["Paused research"] });
for (let attempt = 0; attempt < 100; attempt++) {
  if ((await state()).agents.agents.find((agent) => agent.id === ids["Receipt verification"])?.state === "COMPLETED") break;
  await new Promise((done) => setTimeout(done, 100));
}
const slots = [
  { slot: 1, weapon: "gada", displayName: "Research Gada", agentId: ids["Receipt verification"] },
  { slot: 2, weapon: "spear", displayName: "Review Spear", agentId: ids["Permission review"] },
  { slot: 3, weapon: "chakra", displayName: "Build Chakra", agentId: ids["Paused research"] },
  { slot: 4, weapon: "sword", displayName: "Test Sword", agentId: ids["Idle sword"] },
].map((slot) => ({ ...slot, description: "", purpose: "", style: "concise", responsibilities: [], active: true }));
await command("personal_agents.configure", { slots, expectRevision: 0 });
await command("project.create", { name: "Harness project", path: workspace }).catch(() => null);

// One genuinely uncertain outcome, produced by the Host's own N-C policy: unscoped work on the fixture provider whose
// connection drops mid-run is paused for the owner's reconciliation (never replayed).
let uncertainTaskId = null;
if (process.env.VE2_UNCERTAIN !== "0") {
  const before = new Set((await state()).tasks.map((task) => task.id));
  await command("submit", { prompt: "Update the README in the harness project with today's notes.", mode: "balanced", override: "claude" });
  const submitted = (await state()).tasks.find((task) => !before.has(task.id));
  if (submitted) {
    uncertainTaskId = submitted.id;
    if (submitted.state === "waiting_for_approval") await command("approve", { id: submitted.id }).catch((error) => console.error(String(error)));
    for (let attempt = 0; attempt < 100; attempt++) {
      const row = (await state()).tasks.find((task) => task.id === submitted.id);
      if (row?.reconciliation?.required) break;
      await new Promise((done) => setTimeout(done, 150));
    }
  }
}

const record = {
  classification: "DISPOSABLE LIVE FIXTURE",
  port,
  pid: ready.pid,
  hostGeneration: ready.generation,
  agentIds: ids,
  uncertainTaskId,
  dataDirectory: data,
  credentialsFile: join(data, "credentials.json"),
};
writeFileSync(join(import.meta.dirname, `host-state-${port}.json`), JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify({ ready: true, port, pid: ready.pid }));
const stop = () => { if (child.exitCode === null) child.send("close"); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
child.on("exit", (code) => {
  console.log(`[seed-host] Host exited ${code}`);
  process.exit(0);
});

// M-A-3 T13 phone verification: a DISPOSABLE Host on a 438xx port with real Agents (capability steps only, no providers)
// bound to the four Personal Agent slots through the real personal_agents.configure command. Production (43119, 8084,
// %LOCALAPPDATA%\Bunny-A) is never touched. Credentials are written only into the scratch data directory and are never
// copied into evidence. The process stays up until its child Host is stopped; host-state.json records pids and the port.
import { fork } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const repo = resolve(import.meta.dirname, "../../../..");
const scratch = process.env.T13_PHONE_SCRATCH ?? join(tmpdir(), "bunny-t13-phone-host");
const port = Number(process.env.T13_PHONE_PORT ?? 43811);
if (!/^438\d\d$/.test(String(port))) throw new Error("refusing a non-disposable port");
if (port === 43119 || port === 8084) throw new Error("refusing production port");

const data = join(scratch, "state");
const workspace = join(scratch, "workspace");
rmSync(scratch, { recursive: true, force: true });
mkdirSync(data, { recursive: true });
mkdirSync(workspace, { recursive: true });
writeFileSync(join(workspace, "receipt.txt"), "T13 phone receipt.");

const child = fork(join(repo, "scripts/fixtures/project-host-worker.mjs"), [data, workspace, String(port)], {
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
      {
        kind: "capability",
        action: "filesystem.compare",
        params: { path: "receipt.txt", content: "T13 phone receipt." },
        expect: { field: "matches", equals: true },
      },
    ],
    crossApp: true,
  },
];
const names = ["Receipt verification", "Permission review", "Paused research", "Idle sword"];
const ids = {};
for (const name of names) {
  const before = new Set((await state()).agents.agents.map((agent) => agent.id));
  await command("agent.create", { name, objective: `${name} (T13 phone fixture)`, steps: steps() });
  const row = (await state()).agents.agents.find((agent) => !before.has(agent.id));
  ids[name] = row.id;
}
// Completed and Host-verified: propose, then approve the exact revision (the same path the Host's own tests use).
{
  const id = ids["Receipt verification"];
  const proposal = await command("agent.authorization.propose", { id });
  const revision = proposal.snapshot.agents.agents.find((agent) => agent.id === id).authorization.revision;
  await command("agent.authorization.approve", { id, revision });
}
// Waiting for the user: a consent ask that is proposed and never answered.
await command("agent.authorization.propose", { id: ids["Permission review"] });
// Paused: the Host's own pause command.
await command("agent.pause", { id: ids["Paused research"] });

for (let attempt = 0; attempt < 100; attempt++) {
  const agents = (await state()).agents.agents;
  if (agents.find((agent) => agent.id === ids["Receipt verification"])?.state === "COMPLETED") break;
  await new Promise((done) => setTimeout(done, 100));
}

const slots = [
  { slot: 1, weapon: "gada", displayName: "Research Gada", agentId: ids["Receipt verification"] },
  { slot: 2, weapon: "spear", displayName: "Review Spear", agentId: ids["Permission review"] },
  { slot: 3, weapon: "chakra", displayName: "Build Chakra", agentId: ids["Paused research"] },
  { slot: 4, weapon: "sword", displayName: "Test Sword", agentId: ids["Idle sword"] },
].map((slot) => ({ ...slot, description: "", purpose: "", style: "concise", responsibilities: [], active: true }));
const saved = await command("personal_agents.configure", { slots, expectRevision: 0 });

const snapshot = saved.snapshot ?? (await state());
const record = {
  classification: "DISPOSABLE LIVE FIXTURE",
  port,
  pid: ready.pid,
  hostGeneration: ready.generation,
  agentIds: ids,
  slotRevision: snapshot.personalAgents?.revision ?? null,
  slotStates: (snapshot.personalAgents?.slots ?? []).map((slot) => ({ slot: slot.slot, weapon: slot.weapon, agent: slot.agent?.name ?? null, state: slot.presentation?.state ?? null })),
  credentialsFile: join(data, "credentials.json"),
};
writeFileSync(join(resolve(import.meta.dirname), "host-state.json"), JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify(record));

child.on("exit", (code) => {
  console.log(`[seed-host] Host exited ${code}`);
  process.exit(0);
});

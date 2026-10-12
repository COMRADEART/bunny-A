// T13 disposable Host for the web render check. Disposable data only (Temp), port 43800. Never 43119 or 8084.
// Writes its own credentials file (token + port) for the dev server, seeds real Projects, Agents, a Mission-free Agent set and
// the four Personal Agent slots through the Host's own personal_agents.configure command, then stays up until told to close.
import { fork } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, existsSync, unlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PORT = 43800;
if (PORT < 43800 || PORT > 43899) throw new Error("Disposable Hosts only on 43800-43899.");
const here = resolve("test-results/ma3/t13/web");
const parent = mkdtempSync(join(tmpdir(), "bunny-t13-web-"));
const data = join(parent, "state");
const workspace = join(parent, "workspace");
const rootA = join(parent, "project-a");
for (const path of [data, workspace, rootA]) mkdirSync(path, { recursive: true });
writeFileSync(join(rootA, "receipt.txt"), "T13 disposable receipt.");
const credentials = join(here, "credentials.json");

let child;
let ready;
const boot = async () => {
  child = fork(resolve("scripts/fixtures/project-host-worker.mjs"), [data, workspace, String(PORT)], {
    execArgv: ["--experimental-strip-types"],
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  child.stdout.on("data", (b) => process.stdout.write(`[host] ${b}`));
  child.stderr.on("data", (b) => process.stderr.write(`[host:err] ${b}`));
  ready = await new Promise((done, reject) => {
    child.once("message", done);
    child.once("exit", () => reject(new Error("Disposable Host exited")));
  });
  writeFileSync(credentials, JSON.stringify({ token: ready.token, port: PORT }));
};
const api = async (action, data = {}) => {
  const response = await fetch(`http://127.0.0.1:${PORT}/command`, {
    method: "POST",
    headers: { authorization: `Bearer ${ready.token}`, "content-type": "application/json" },
    body: JSON.stringify({ action, data }),
  });
  const result = await response.json();
  if (response.status !== 200) throw new Error(`${action} refused: ${result.error ?? response.status}`);
  return result;
};

await boot();
await api("mission.configure", { enabled: true });
const project = (await api("project.add", { name: "Receipt studio", path: rootA, description: "A disposable Project for the render check." })).data;
const steps = [
  {
    role: "Verify receipt",
    objective: "Read and independently verify the approved receipt",
    access: "read",
    executor: { kind: "capability", action: "filesystem.read", params: { path: "receipt.txt" } },
    verification: [{ kind: "capability", action: "filesystem.compare", params: { path: "receipt.txt", content: "T13 disposable receipt." }, expect: { field: "matches", equals: true } }],
    crossApp: true,
  },
];
const agentOne = await api("agent.create", { projectId: project.id, name: "Ledger researcher", objective: "Read and verify the approved receipt", steps });
const agentTwo = await api("agent.create", { projectId: project.id, name: "Release checker", objective: "Check the release notes", steps });
const list = agentOne.snapshot.agents.agents;
const ids = list.map((row) => row.id);
const agentA = list.find((row) => row.name === "Ledger researcher")?.id ?? ids[0];
const agentB = agentTwo.snapshot.agents.agents.find((row) => row.name === "Release checker")?.id ?? ids[1];
const bind = (slots, expectRevision) => api("personal_agents.configure", { slots, expectRevision });
const slotsFor = (overrides) =>
  [
    { slot: 1, weapon: "gada", displayName: "Ledger", description: "Reads and checks the receipts.", purpose: "Verify finance paperwork", style: "concise", responsibilities: ["research", "review"], agentId: agentA, active: true },
    { slot: 2, weapon: "spear", displayName: "", description: "", purpose: "", style: "concise", responsibilities: [], agentId: agentB, active: true },
    { slot: 3, weapon: "chakra", displayName: "", description: "", purpose: "", style: "concise", responsibilities: [], agentId: null, active: true },
    { slot: 4, weapon: "sword", displayName: "", description: "", purpose: "", style: "concise", responsibilities: [], agentId: null, active: true },
  ].map((row, i) => ({ ...row, ...(overrides?.[i] ?? {}) }));
const configured = await bind(slotsFor(), 0);
console.log("T13 seeded slots revision", configured.snapshot.personalAgents.revision);
writeFileSync(join(here, "host-fixture.json"), JSON.stringify({ port: PORT, pid: ready.pid, projectId: project.id, agentA, agentB, classification: "DISPOSABLE T13 WEB FIXTURE" }, null, 2) + "\n");
console.log("T13 disposable Host ready on", PORT, "pid", ready.pid);

// A small control channel: a file named `close` stops the Host; `snapshot` writes the current Host state for assertions.
setInterval(async () => {
  try {
    if (existsSync(join(here, "close"))) {
      unlinkSync(join(here, "close"));
      await new Promise((done) => {
        child.once("exit", done);
        child.send("close");
      });
      process.exit(0);
    }
    if (existsSync(join(here, "snapshot"))) {
      unlinkSync(join(here, "snapshot"));
      const response = await fetch(`http://127.0.0.1:${PORT}/state`, { headers: { authorization: `Bearer ${ready.token}` } });
      writeFileSync(join(here, "host-state.json"), JSON.stringify(await response.json(), null, 2));
    }
  } catch (error) {
    writeFileSync(join(here, "host-error.txt"), String(error?.stack ?? error));
  }
}, 500);
void readFileSync;

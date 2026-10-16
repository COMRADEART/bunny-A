// M-A-3 T14 packaged end-to-end: one disposable Host started from the EXACT Windows test package (its own runtime/node.exe and
// packaged entry, through package-host.mjs) proves the shipped Host carries T14. Only deterministic skill steps run, so no real
// provider is ever launched (the packaged Host detects real CLIs on this machine; none is used). Git capability steps are used
// instead of npm: in the packaged runtime the npm executable identity differs between plan and run time, which the Host refuses
// fail-closed (known limitation L-PKG-NPM; see package-t14-e2e-npm-identity-attempt.log).
//   P01 a Personal Agent's read-only capability Mission starts after one approval;
//   P02 a worker inside the parent's approval is authorized from it and runs with no owner request;
//   P03 a worker needing more (browser) waits for the owner, with the reason recorded;
//   P04 the parent waits for its workers, then completes with their verdicts in its result;
//   P05 the parent's autonomy is COMPLETE and honestly unverified (the repository worker is evidence-only); the worker's
//       envelope is derived from the parent's;
//   P06 a paired device cannot propose a worker; P07 the default active-Mission limit is 4;
//   P08 no provider task was created.
// Usage: <node> t14-e2e.mjs <packageRoot> <out.json> <port>. Production (43119/8084) is refused.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const here = resolve(import.meta.dirname);
const [rootArg, outArg, portArg] = process.argv.slice(2);
const root = resolve(rootArg);
const port = Number(portArg);
if (!(port > 1024) || port === 43119 || port === 8084) throw new Error("A disposable port is required.");
if (!existsSync(join(root, "release-manifest.json"))) throw new Error("A package root (with release-manifest.json) is required.");
const scratch = join(tmpdir(), `bunny-t14-e2e-${Date.now()}`);
mkdirSync(scratch, { recursive: true });
const checks = [];
const logs = [];
let host;
let token;
const check = (id, ok, detail) => {
  checks.push({ id, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (probe, label, max = 90_000) => {
  const end = Date.now() + max;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out: ${label}`);
    await sleep(200);
  }
};
const call = async (path, data, bearer = token) => {
  const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: data ? "POST" : "GET", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, ...(data ? { body: JSON.stringify(data) } : {}) });
  return { status: r.status, body: JSON.parse(await r.text()) };
};
const command = (action, data = {}, bearer = token) => call("/command", { action, data }, bearer);
const state = async () => (await call("/state", null)).body;
const mission = async (id) => (await state()).missions.missions.find((m) => m.id === id);
const receipt = { packageRoot: root, port, startedAt: new Date().toISOString(), runtime: "package runtime/node.exe" };
try {
  host = spawn(join(root, "runtime/node.exe"), [join(here, "package-host.mjs"), root, scratch, String(port)], { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, NODE_OPTIONS: "" } });
  host.stdout.on("data", (s) => logs.push(String(s)));
  host.stderr.on("data", (s) => logs.push(String(s)));
  await until(async () => {
    if (host.exitCode !== null) throw new Error("Host exited: " + logs.join("").slice(-1500));
    try { return existsSync(join(scratch, "credentials.json")) && (await fetch(`http://127.0.0.1:${port}/health`)).ok; } catch { return false; }
  }, "Host start");
  token = JSON.parse(readFileSync(join(scratch, "credentials.json"), "utf8")).token;
  await command("mission.configure", { enabled: true });
  const projectPath = join(scratch, "workspace", "t14-app");
  mkdirSync(projectPath, { recursive: true });
  writeFileSync(join(projectPath, "README.md"), "# T14 package app\n");
  const git = (args) => new Promise((done, fail) => { const child = spawn("git", args, { cwd: projectPath, windowsHide: true }); child.on("exit", (code) => (code === 0 ? done() : fail(new Error(`git ${args.join(" ")} exited ${code}`)))); });
  await git(["init", "-q"]);
  await git(["add", "README.md"]);
  await git(["-c", "user.name=T14 fixture", "-c", "user.email=t14-fixture@example.invalid", "commit", "-q", "-m", "fixture"]);
  writeFileSync(join(projectPath, "notes.md"), "pending change\n");
  const projectId = (await command("project.add", { name: "T14 package app", path: projectPath })).body.data.id;
  // A twelve-step read-only chain keeps the parent live while its worker is added (git output only, so honestly unverified).
  const steps = Array.from({ length: 12 }, (_, n) => ({ role: `Inspect${n + 1}`, objective: "Inspect the repository", dependsOn: n ? [n - 1] : [],
    executor: { kind: "capability", action: n % 2 ? "git.diff" : "git.status", params: {} } }));
  const delegated = await command("personal_agent.delegate", { slot: 1, objective: "Check the app (T14 package e2e)", title: "T14 package parent", projectId, steps });
  const agentId = delegated.body.data?.agentId;
  const parentId = (await state()).agents.agents.find((a) => a.id === agentId)?.missionId;
  await until(async () => (await mission(parentId))?.state === "waiting_for_approval", "parent plan");
  const started = await command("agent.start", { id: agentId });
  await until(async () => ["running", "verifying", "completed"].includes((await mission(parentId))?.state), "parent running").catch(async (error) => {
    const m = await mission(parentId);
    throw new Error(`${error.message}: start ${started.status} ${JSON.stringify(started.body?.error ?? "")}; parent ${m?.state}; failure ${JSON.stringify(m?.failure)}; steps ${JSON.stringify(m?.steps?.map((s) => [s.state, s.failure, s.pendingRequestId]))}; requests ${JSON.stringify(m?.requests?.map((r) => [r.action, r.reason]))}`);
  });
  check("P01 a Personal Agent's Mission starts after one approval", started.status === 200, { status: started.status, parentId });
  const proposed = await command("worker.propose", { slot: 1, parentMissionId: parentId, ability: "repository", objective: "Snapshot the repository", projectId });
  const worker = proposed.body.data?.worker;
  const admitted = worker?.history?.find((row) => row.state === "ADMITTED")?.note ?? "";
  await until(async () => ["running", "completed"].includes((await mission(worker.childMissionId))?.state), "worker running");
  const child = await mission(worker.childMissionId);
  check("P02 a worker inside the parent's approval runs with no owner request", proposed.status === 200 && /authorized from its parent's approval/.test(admitted) && child.requests.length === 0, { admitted, requests: child.requests.length });
  const wide = await command("worker.propose", { slot: 1, parentMissionId: parentId, ability: "web", objective: "Capture a page", projectId, params: { url: "https://example.com/" } });
  const wideNote = wide.body.data?.worker?.history?.find((row) => row.state === "ADMITTED")?.note ?? "";
  const wideState = (await mission(wide.body.data?.worker?.childMissionId))?.state;
  check("P03 a worker needing more waits for the owner, with the reason recorded", /waits for your approval/.test(wideNote) && wideState === "waiting_for_approval", { wideNote: wideNote.slice(0, 200), wideState });
  await command("worker.cancel", { id: wide.body.data.worker.id });
  const done = await until(async () => { const m = await mission(parentId); return m?.state === "completed" && m; }, "parent completed", 120_000).catch(async (error) => {
    const m = await mission(parentId);
    const c = await mission(worker.childMissionId);
    throw new Error(`${error.message}: parent ${m?.state} ${m?.autonomy?.phase} steps ${JSON.stringify(m?.steps?.map((s) => [s.state, s.failure?.detail?.slice(0, 160)]))}; child ${c?.state} ${JSON.stringify(c?.steps?.map((s) => [s.state, s.failure?.detail?.slice(0, 160), s.pendingRequestId]))} requests ${JSON.stringify(c?.requests?.map((r) => r.reason.slice(0, 160)))}`);
  });
  const events = (await state()).events.filter((e) => e.missionId === parentId).map((e) => e.type);
  check("P04 the parent completes after its workers with their verdicts", /Workers: 0 verified by Bunny, 2 not verified/.test(done.result.summary), { summary: done.result.summary, heldForWorkers: events.includes("mission.waiting_workers") });
  const childAuth = (await command("mission.get", { id: worker.childMissionId })).body;
  const authorization = (childAuth.data ?? childAuth).authorization;
  check("P05 COMPLETE is reported unverified (evidence-only worker), and the worker ran on authority derived from the parent", done.autonomy?.phase === "COMPLETE" && done.autonomy?.verified === false && authorization?.derivedFrom?.missionId === parentId,
    { autonomy: done.autonomy, derivedFrom: authorization?.derivedFrom ?? null });
  const code = (await command("pairing.create")).body.pairCode;
  const paired = await (await fetch(`http://127.0.0.1:${port}/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name: "T14 package e2e fixture phone" }) })).json();
  const phone = await command("worker.propose", { slot: 1, parentMissionId: parentId, ability: "repository", objective: "Phone worker", projectId }, paired.token);
  check("P06 a paired device cannot propose a worker", phone.status >= 400, { status: phone.status, code: phone.body.code });
  const config = (await state()).missions.config;
  check("P07 the default active-Mission limit is 4", config.limits.maxActiveMissions === 4, config.limits);
} catch (error) {
  check("P00 run completed", false, String(error?.stack ?? error).slice(0, 1200));
} finally {
  if (host?.exitCode === null) {
    writeFileSync(join(scratch, "close"), "");
    await until(() => host.exitCode !== null, "Host close", 30_000).catch(() => host.kill());
  }
}
try {
  const db = new DatabaseSync(join(scratch, "state/host.sqlite"), { readOnly: true });
  const tasks = db.prepare("SELECT COUNT(*) AS n FROM tasks").get().n;
  db.close();
  check("P08 no provider task was created (skills only)", tasks === 0, { tasks });
} catch (error) {
  check("P08 no provider task was created (skills only)", false, String(error).slice(0, 300));
}
receipt.checks = checks;
receipt.result = checks.every((c) => c.ok) ? "PASS" : "FAIL";
receipt.finishedAt = new Date().toISOString();
receipt.installed = false;
receipt.published = false;
writeFileSync(resolve(outArg), JSON.stringify(receipt, null, 2) + "\n");
rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
console.log(`${receipt.result}: ${checks.filter((c) => c.ok).length}/${checks.length}`);
process.exitCode = receipt.result === "PASS" ? 0 : 1;

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost } from "./http.server.ts";
import { providerBase } from "./adapters.server.ts";
import { FilesystemCapability, GitCapability, TerminalCapability } from "../bunny-missions/capabilities/local.server.ts";
import type { ProviderAdapter } from "./contracts.ts";
import type { OrchTask } from "../orch/types.ts";
import { UI_THEME_IDS } from "./ui-theme.ts";

/**
 * M-A-3 T14 at the real Host HTTP surface: a Personal Agent's workers run on a strict subset of the parent Mission's
 * approved authority (one owner approval, no second prompt), and anything wider still waits for the owner.
 * Ports 43960-43969.
 */

type Body = Record<string, any>;
type Host = Awaited<ReturnType<typeof boot>>;

/** A ready provider whose launches wait until the test answers them; every launched task is recorded. */
function gated(launched: OrchTask[]) {
  const waiting = new Map<string, (result: { ok: boolean; output: string; error?: string }) => void>();
  const adapter: ProviderAdapter = {
    id: "claude",
    detect: async () => ({ ...providerBase("claude"), installed: true, authenticated: true, availability: "ready", capabilities: ["text", "filesystem"], current_model: "fixture" }),
    launch: (task) => {
      launched.push(task);
      return { done: new Promise((resolve) => waiting.set(task.id, resolve)), stop: async () => waiting.get(task.id)?.({ ok: false, output: "", error: "stopped" }) };
    },
  };
  /** Answers the waiting launches `which` selects (all by default). */
  const release = (which: (task: OrchTask) => boolean = () => true, result: { ok: boolean; output: string; error?: string } = { ok: true, output: "Implemented." }) => {
    for (const task of launched) if (which(task) && waiting.has(task.id)) { waiting.get(task.id)!(result); waiting.delete(task.id); }
  };
  return { adapter, release, pending: () => waiting.size };
}

async function boot(directory: string, port: number, adapter: ProviderAdapter, voice?: { workerExtraArgs?: string[] }) {
  const root = join(directory, "project");
  mkdirSync(root, { recursive: true });
  const host = await startHost({
    dataDirectory: directory,
    root,
    port,
    adapters: [adapter],
    missions: { adapters: [new FilesystemCapability(), new TerminalCapability(), new GitCapability(directory)] },
    ...(voice ? { voice } : {}),
  });
  const base = `http://127.0.0.1:${port}`;
  const command = async (action: string, data: unknown = {}, token = host.token) => {
    const response = await fetch(`${base}/command`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ action, data }),
    });
    return { status: response.status, body: (await response.json()) as Body };
  };
  const state = async () => {
    const response = await fetch(`${base}/state`, { headers: { authorization: `Bearer ${host.token}` } });
    return (await response.json()) as Body;
  };
  const pair = async (name: string) => {
    const code = (await command("pairing.create")).body.pairCode;
    const response = await fetch(`${base}/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, name }) });
    assert.equal(response.status, 200);
    return (await response.json()) as { token: string; deviceId: string };
  };
  const enabled = await command("mission.configure", { enabled: true });
  assert.equal(enabled.status, 200, JSON.stringify(enabled.body));
  return { host, command, state, pair, directory, close: () => host.close() };
}

async function withHost(port: number, adapter: ProviderAdapter, work: (h: Host, reboot: () => Promise<Host>) => Promise<void>, voice?: { workerExtraArgs?: string[] }) {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t14-"));
  let h: Host | undefined;
  try {
    h = await boot(directory, port, adapter, voice);
    await work(h, async () => {
      await h!.close();
      h = await boot(directory, port, adapter, voice);
      return h;
    });
  } finally {
    await h?.close();
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  }
}

const ok = (result: { status: number; body: Body }) => {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  return result.body;
};
const until = async <T,>(check: () => Promise<T | undefined | null | false>, label: string, timeout = 60_000): Promise<T> => {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};
const project = async (h: Host, name: string, testExit = 0, testMs = 0) => {
  const path = join(h.directory, name.replace(/\W+/g, "-"));
  mkdirSync(path, { recursive: true });
  const script = (exit: number) => `node -e "setTimeout(() => process.exit(${exit}), ${testMs})"`;
  writeFileSync(join(path, "package.json"), JSON.stringify({ name: "fixture", private: true, scripts: { test: script(testExit), lint: script(0), typecheck: script(0) } }));
  return ok(await h.command("project.add", { name, path })).data.id as string;
};
const mission = async (h: Host, id: string) => (await h.state()).missions.missions.find((m: Body) => m.id === id) as Body;
const workersOf = async (h: Host, slot: number) => (await h.state()).personalAgentContext.slots.find((row: Body) => row.slot === slot).workers as Body[];

/** One write step that implements and is verified by npm test: the owner's single approval covers terminal npm. */
const softwarePlan = [{ role: "Implementer", objective: "Implement the change", access: "write", verification: [{ kind: "command", command: "npm", args: ["test"], expectExit: 0 }] }];

/** Gives slot `slot` a Mission with this plan and approves it once, like the owner pressing Start. */
async function delegateAndStart(h: Host, slot: number, projectId: string, steps: unknown[] = softwarePlan) {
  const agentId = ok(await h.command("personal_agent.delegate", { slot, objective: "Ship the change", title: `Slot ${slot} work`, projectId, steps })).data.agentId as string;
  const missionId = (await h.state()).agents.agents.find((row: Body) => row.id === agentId).missionId as string;
  await until(async () => (await mission(h, missionId))?.state === "waiting_for_approval", "parent plan");
  ok(await h.command("agent.start", { id: agentId }));
  await until(async () => (await mission(h, missionId))?.state === "running", "parent running");
  return { agentId, missionId };
}

test("T14 a worker within its parent's approval runs at once under derived authority; the parent waits for it; a wider one waits for the owner", async () => {
  const launched: OrchTask[] = [];
  const provider = gated(launched);
  await withHost(43960, provider.adapter, async (h) => {
    // npm test takes about two seconds, so the worker is still running when the parent's own step finishes.
    const alpha = await project(h, "Alpha app", 0, 2000);
    const parent = await delegateAndStart(h, 1, alpha, [{ ...softwarePlan[0], access: "read" }]);
    await until(async () => launched.length === 1, "parent model step launched");

    const worker = ok(await h.command("worker.propose", { slot: 1, parentMissionId: parent.missionId, ability: "test", objective: "Run the Alpha tests", projectId: alpha })).data.worker as Body;
    const admitted = (w: Body) => w.history.find((row: Body) => row.state === "ADMITTED").note as string;
    assert.match(admitted(worker), /authorized from its parent's approval/);

    // Browser capture needs network and a browser the parent was never approved for: it waits for the owner.
    const wide = ok(await h.command("worker.propose", { slot: 1, parentMissionId: parent.missionId, ability: "web", objective: "Capture the docs page", projectId: alpha, params: { url: "https://example.com/" } })).data.worker as Body;
    assert.match(admitted(wide), /waits for your approval: .*capabilities beyond the parent/);
    assert.equal((await mission(h, wide.childMissionId)).state, "waiting_for_approval");
    ok(await h.command("worker.cancel", { id: wide.id }));

    provider.release();
    const events = async () => (await h.state()).events as Body[];
    await until(async () => (await events()).some((e) => e.missionId === parent.missionId && e.type === "mission.waiting_workers"), "parent holding for its worker");
    assert.equal((await mission(h, parent.missionId)).state, "running", "the parent did not finish ahead of its worker");

    const done = await until(async () => (await workersOf(h, 1)).find((row) => row.id === worker.id && row.state === "CLOSED"), "worker closed");
    assert.equal(done.result.verified, true, JSON.stringify(done));
    const child = await mission(h, worker.childMissionId);
    assert.equal(child.state, "completed");
    assert.ok(!child.requests.length, "the worker asked the owner nothing");
    const childAuth = (await events()).filter((e) => e.missionId === worker.childMissionId).map((e) => e.type);
    assert.ok(!childAuth.includes("mission.waiting_for_user"), childAuth.join(","));

    const finished = await until(async () => { const m = await mission(h, parent.missionId); return m?.state === "completed" && m; }, "parent completed");
    assert.match(finished.result.summary, /Workers: 1 verified by Bunny, 1 not verified\./);
  });
});

const readPlan = (n = 1) => Array.from({ length: n }, (_, index) => ({ ...softwarePlan[0], role: `Stage${index + 1}`, access: "read", dependsOn: index ? [index - 1] : [] }));
const closedWorker = (h: Host, slot: number, id: string) => until(async () => (await workersOf(h, slot)).find((row) => row.id === id && row.state === "CLOSED"), `worker ${id} closed`);

test("T14-B one Personal Agent runs three independent workers in parallel; its dependent step waits and receives their verified results", async () => {
  const launched: OrchTask[] = [];
  const provider = gated(launched);
  await withHost(43961, provider.adapter, async (h) => {
    const alpha = await project(h, "Parallel app", 0, 1500);
    const parent = await delegateAndStart(h, 1, alpha, readPlan(2));
    await until(async () => launched.length === 1, "stage 1 launched");
    const ids: Body[] = [];
    const heldAtCap = async () => ((await h.state()).events as Body[]).some((e) => e.type === "mission.step.held" && /AGENT_CAP/.test(e.detail) && ids.some((w) => w.childMissionId === e.missionId));
    for (const ability of ["test", "lint", "typecheck"]) {
      const worker = ok(await h.command("worker.propose", { slot: 1, parentMissionId: parent.missionId, ability, objective: `Run ${ability}`, projectId: alpha })).data.worker as Body;
      assert.match(worker.history.find((row: Body) => row.state === "ADMITTED").note, /authorized from its parent's approval/, ability);
      ids.push(worker);
    }
    // Resource-aware scheduling: Gada's default allowance is two live steps (its own step plus one worker).
    await until(heldAtCap, "workers held at Gada's concurrency cap");
    // The owner raises Gada's allowance; the held workers start alongside the running one.
    ok(await h.command("scheduler.fairness", { fairness: { agents: { 1: { maxConcurrent: 4 } } } }));
    const closed = await Promise.all(ids.map((worker) => closedWorker(h, 1, worker.id)));
    assert.ok(closed.every((worker) => worker.result.verified === true), JSON.stringify(closed.map((w) => w.result)));
    // Concurrency: the three child Missions' step intervals overlap (each npm script takes about 1.5 s).
    const spans = await Promise.all(ids.map(async (worker) => { const step = (await mission(h, worker.childMissionId)).steps[0]; return [step.startedAt, step.finishedAt] as [number, number]; }));
    const overlaps = spans.filter(([start], index) => spans.some(([s, f], other) => other !== index && s <= start && start < f)).length;
    assert.ok(overlaps >= 1, `overlapping worker runs: ${JSON.stringify(spans)}`);
    console.log(`T14-B worker spans (ms from first start): ${JSON.stringify(spans.map(([s, f]) => [s - Math.min(...spans.map((x) => x[0])), f - Math.min(...spans.map((x) => x[0]))]))}`);
    // Dependency: stage 2 is not dispatched before stage 1 is verified.
    assert.equal(launched.length, 1, "stage 2 waits for stage 1");
    provider.release();
    await until(async () => launched.length === 2, "stage 2 launched after stage 1 verified");
    const steps = (await mission(h, parent.missionId)).steps;
    assert.ok(steps[1].startedAt >= steps[0].finishedAt, "dependent step started after its prerequisite finished");
    // Integration: the dependent step's prompt carries the workers' Host-verified results as facts.
    assert.match(launched[1].prompt, /Worker Run tests verified/);
    assert.match(launched[1].prompt, /Worker Lint verified/);
    provider.release();
    const finished = await until(async () => { const m = await mission(h, parent.missionId); return m?.state === "completed" && m; }, "parent completed");
    assert.match(finished.result.summary, /Workers: 3 verified by Bunny\./);
    // Review F5: a verified worker fact carries Host-written text only; the reported summaries stay unverified.
    const memory = (ok(await h.command("mission.get", { id: parent.missionId })).data ?? {}).memory ?? ok(await h.command("mission.get", { id: parent.missionId })).memory;
    const workerFacts = (memory as Body[]).filter((entry) => /^Worker /.test(entry.key));
    assert.ok(workerFacts.filter((entry) => entry.verified).every((entry) => entry.kind === "verified_fact" && entry.provenance.startsWith("bunny:verification:worker:") && /The Host's verification|Every step passed/.test(entry.value)), JSON.stringify(workerFacts));
    assert.ok(workerFacts.filter((entry) => entry.kind === "agent_conclusion").every((entry) => entry.verified === false));
    assert.deepEqual([finished.autonomy.phase, finished.autonomy.verified], ["COMPLETE", true]);
  });
});

test("T14-C four Personal Agents run four Missions at once, isolated; one paused for reconciliation never stops the others", async () => {
  const launched: OrchTask[] = [];
  const provider = gated(launched);
  await withHost(43962, provider.adapter, async (h) => {
    const projects: string[] = [];
    for (const name of ["Gada site", "Spear api", "Chakra docs", "Sword tool"]) projects.push(await project(h, name));
    const owned: { agentId: string; missionId: string }[] = [];
    for (const [index, projectId] of projects.entries()) {
      const plan = index === 0 ? [{ ...softwarePlan[0], role: "Writer", access: "write", verification: [] }] : readPlan(1);
      owned.push(await delegateAndStart(h, index + 1, projectId, plan));
    }
    await until(async () => launched.length === 4, "all four dispatched together");
    const snapshot = await h.state();
    assert.equal(snapshot.missions.missions.filter((m: Body) => owned.some((o) => o.missionId === m.id) && m.state === "running").length, 4);
    for (const own of owned) assert.equal(snapshot.agents.agents.find((row: Body) => row.id === own.agentId).state, "RUNNING");
    // Isolation: Spear cannot add a worker to Gada's Mission, and cannot read Gada's private memory.
    ok(await h.command("lotus.remember", { scope: "agent:1", key: "Gada private", value: "gada-only-token" }));
    const foreign = await h.command("worker.propose", { slot: 2, parentMissionId: owned[0].missionId, ability: "test", objective: "Run tests", projectId: projects[0] });
    assert.equal(foreign.status, 400);
    assert.match(foreign.body.error, /only to a Mission it owns/);
    const spearRecall = ok(await h.command("lotus.recall", { slot: 2, query: "private" })).data.lines as string[];
    assert.ok(!spearRecall.join(" ").includes("gada-only-token"));
    // Gada's write loses its connection after dispatch: it waits for reconciliation; the other three finish.
    provider.release((task) => task.executionScope?.access === "write", { ok: false, output: "", error: "connection reset after the request was sent" });
    await until(async () => (await mission(h, owned[0].missionId)).state === "waiting_for_user", "Gada paused");
    assert.equal((await mission(h, owned[0].missionId)).autonomy.phase, "RECONCILIATION_REQUIRED");
    provider.release();
    for (const own of owned.slice(1)) await until(async () => (await mission(h, own.missionId)).state === "completed", "others complete");
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(launched.length, 4, "nothing was replayed or duplicated");
    assert.equal((await mission(h, owned[0].missionId)).state, "waiting_for_user");
  });
});

test("T14-F a Host restart mid-work dispatches nothing again: the parent and its worker wait for the owner", async () => {
  const launched: OrchTask[] = [];
  const provider = gated(launched);
  await withHost(43963, provider.adapter, async (h, reboot) => {
    const alpha = await project(h, "Restart app", 0, 8000);
    const parent = await delegateAndStart(h, 1, alpha, readPlan(1));
    await until(async () => launched.length === 1, "parent dispatched");
    const worker = ok(await h.command("worker.propose", { slot: 1, parentMissionId: parent.missionId, ability: "test", objective: "Run the tests", projectId: alpha })).data.worker as Body;
    await until(async () => (await mission(h, worker.childMissionId)).steps[0]?.state === "running", "worker running");
    const started = Date.now();
    h = await reboot();
    const recoveredMs = Date.now() - started;
    const p = await mission(h, parent.missionId);
    const c = await mission(h, worker.childMissionId);
    assert.equal(p.state, "waiting_for_user", "the parent reconciles before dispatching anything");
    assert.ok(["waiting_for_user", "stopped", "failed"].includes(c.state), `the worker did not resume (${c.state})`);
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(launched.length, 1, "no duplicate dispatch after restart");
    assert.ok(c.steps[0].attempts.every((a: Body) => a.outcome !== "running"), "the interrupted run is not left running");
    assert.notEqual(c.state, "completed", "an interrupted worker is never reported as done");
    console.log(`T14-F restart-to-reconciled-state ${recoveredMs} ms`);
  });
});

test("T14-G Lotus: verified Mission facts and Project notes are recalled by their owner after a restart; private scopes never cross", async () => {
  const launched: OrchTask[] = [];
  const provider = gated(launched);
  await withHost(43964, provider.adapter, async (h, reboot) => {
    const alpha = await project(h, "Memory app");
    const parent = await delegateAndStart(h, 1, alpha, readPlan(1));
    ok(await h.command("lotus.remember", { scope: "agent:1", key: "Gada preference", value: "gada-private-token" }));
    ok(await h.command("lotus.remember", { scope: `project:${alpha}`, key: "Build command", value: "alpha-project-token" }));
    await until(async () => launched.length === 1, "dispatched");
    provider.release();
    await until(async () => (await mission(h, parent.missionId)).state === "completed", "completed");
    h = await reboot();
    const gada = (ok(await h.command("lotus.recall", { slot: 1, query: "token verified", limit: 12 })).data.lines as string[]).join("\n");
    assert.match(gada, /gada-private-token/);
    assert.match(gada, /alpha-project-token/);
    assert.match(gada, /Stage1 verified/, "the verified step outcome is restored from the Mission's own facts");
    const spear = (ok(await h.command("lotus.recall", { slot: 2, query: "token", limit: 12 })).data.lines as string[]).join("\n");
    assert.ok(!/gada-private-token|alpha-project-token/.test(spear), "Spear owns nothing in Alpha and never sees Gada's scope");
    // A worker gets the one-Project slice only.
    const live = await delegateAndStart(h, 1, alpha, readPlan(1));
    await until(async () => launched.length === 2, "second dispatched");
    const worker = ok(await h.command("worker.propose", { slot: 1, parentMissionId: live.missionId, ability: "test", objective: "Run tests with the build command", projectId: alpha })).data.worker as Body;
    assert.ok((worker.context as string[]).join(" ").includes("alpha-project-token"));
    assert.ok(!(worker.context as string[]).join(" ").includes("gada-private-token"));
    provider.release();
  });
});

test("T14-I switching all 22 themes and every widget layout mid-Mission changes nothing about the work", async () => {
  const launched: OrchTask[] = [];
  const provider = gated(launched);
  await withHost(43965, provider.adapter, async (h) => {
    const alpha = await project(h, "Theme app");
    const parent = await delegateAndStart(h, 1, alpha, readPlan(1));
    await until(async () => launched.length === 1, "dispatched");
    const before = await mission(h, parent.missionId);
    const layouts = ["board", "sidebar", "drawer"];
    assert.equal(UI_THEME_IDS.length, 22);
    for (const [index, theme] of UI_THEME_IDS.entries()) {
      ok(await h.command("appearance.theme", { theme }));
      ok(await h.command("widgets.layout", { layout: layouts[index % layouts.length] }));
      const now = await h.state();
      const m = now.missions.missions.find((row: Body) => row.id === parent.missionId);
      assert.equal(now.uiTheme.preference.theme, theme);
      assert.deepEqual([m.state, m.steps[0].state, m.autonomy.phase, m.authorizationId], ["running", "running", "EXECUTE", before.authorizationId], theme);
      assert.equal(now.agents.agents.find((row: Body) => row.id === parent.agentId).state, "RUNNING");
    }
    assert.equal(launched.length, 1, "presentation changes never dispatch or restart work");
    provider.release();
    await until(async () => (await mission(h, parent.missionId)).state === "completed", "completed under the last theme");
  });
});

test("T14-J a paired phone cannot delegate, add workers, reconcile, read memory or change the workstation: every attempt fails closed", async () => {
  const launched: OrchTask[] = [];
  const provider = gated(launched);
  await withHost(43966, provider.adapter, async (h) => {
    const alpha = await project(h, "Phone app");
    const parent = await delegateAndStart(h, 1, alpha, readPlan(1));
    await until(async () => launched.length === 1, "dispatched");
    const phone = await h.pair("T14 phone");
    const before = JSON.stringify((await mission(h, parent.missionId)).steps.map((s: Body) => s.state));
    const attempts: [string, Body][] = [
      ["personal_agent.delegate", { slot: 2, objective: "Phone work", projectId: alpha, steps: readPlan(1) }],
      ["worker.propose", { slot: 1, parentMissionId: parent.missionId, ability: "test", objective: "Run tests", projectId: alpha }],
      ["worker.ability.compose", { name: "Phone ability", description: "x", components: ["test"] }],
      ["lotus.recall", { slot: 1, query: "anything" }],
      ["lotus.share", { slot: 1, projectId: alpha, ids: ["x"] }],
      ["personal_agents.configure", { slots: [] }],
      ["mission.reconcile", { id: parent.missionId, stepId: "x", resolution: "retry" }],
      ["mission.configure", { limits: { maxActiveMissions: 10 } }],
      ["appearance.theme", { theme: "pixel" }],
      ["widgets.layout", { layout: "drawer" }],
    ];
    for (const [action, data] of attempts) {
      const result = await h.command(action, data, phone.token);
      assert.ok(result.status >= 400, `${action} must fail closed (got ${result.status})`);
    }
    assert.equal(JSON.stringify((await mission(h, parent.missionId)).steps.map((s: Body) => s.state)), before);
    assert.equal((await workersOf(h, 1)).length, 0, "no worker exists");
    assert.equal(launched.length, 1, "nothing was dispatched for the phone");
    provider.release();
  });
});

test("T14-K two Personal Agents collaborate through one Project: explicit share, explicit ownership, no private leakage", async () => {
  const launched: OrchTask[] = [];
  const provider = gated(launched);
  await withHost(43967, provider.adapter, async (h) => {
    const alpha = await project(h, "Shared app");
    const gada = await delegateAndStart(h, 1, alpha, readPlan(1));
    const spear = await delegateAndStart(h, 2, alpha, readPlan(1));
    await until(async () => launched.length === 2, "both dispatched");
    ok(await h.command("lotus.remember", { scope: "agent:1", key: "API contract", value: "contract-v2-token" }));
    ok(await h.command("lotus.remember", { scope: "agent:1", key: "Gada diary", value: "diary-token" }));
    const own = (await h.state()).personalAgentContext.slots.find((row: Body) => row.slot === 1).memories as Body[];
    const contract = own.find((memory) => memory.key === "API contract");
    assert.ok(contract, JSON.stringify(own.map((memory) => memory.key)));
    ok(await h.command("lotus.share", { slot: 1, projectId: alpha, ids: [contract.id] }));
    const spearLines = (ok(await h.command("lotus.recall", { slot: 2, query: "contract diary token", limit: 12 })).data.lines as string[]).join("\n");
    assert.match(spearLines, /contract-v2-token/, "the explicitly shared note reaches Spear through the Project");
    assert.ok(!spearLines.includes("diary-token"), "Gada's unshared memory stays private");
    // Ownership stays explicit: each Agent adds workers only to its own Mission.
    assert.equal((await h.command("worker.propose", { slot: 2, parentMissionId: gada.missionId, ability: "test", objective: "Help Gada", projectId: alpha })).status, 400);
    const help = ok(await h.command("worker.propose", { slot: 2, parentMissionId: spear.missionId, ability: "test", objective: "Check the shared contract", projectId: alpha })).data.worker as Body;
    assert.deepEqual([help.slot, help.provenance], [2, "agent:2"]);
    await closedWorker(h, 2, help.id);
    const slots = (await h.state()).personalAgentContext.slots as Body[];
    assert.ok((slots.find((row) => row.slot === 1)!.workers as Body[]).every((w) => w.parentMissionId !== spear.missionId));
    provider.release();
    for (const row of [gada, spear]) await until(async () => (await mission(h, row.missionId)).state === "completed", "both complete");
  });
});

test("T14 derived authority ends with the parent's: a replanned parent revokes its worker's envelope and stops it", async () => {
  const launched: OrchTask[] = [];
  const provider = gated(launched);
  await withHost(43968, provider.adapter, async (h) => {
    const alpha = await project(h, "Revoke app", 0, 6000);
    const parent = await delegateAndStart(h, 1, alpha, [{ ...readPlan(1)[0], maxRetries: 0 }]);
    await until(async () => launched.length === 1, "dispatched");
    const worker = ok(await h.command("worker.propose", { slot: 1, parentMissionId: parent.missionId, ability: "test", objective: "Run tests", projectId: alpha })).data.worker as Body;
    const auth = async () => { const body = ok(await h.command("mission.get", { id: worker.childMissionId })); return (body.data ?? body).authorization as Body; };
    const live = await auth();
    assert.equal(live.revokedAt, null);
    assert.equal(live.derivedFrom.missionId, parent.missionId);
    // The parent's provider runs out of quota with no retry left: it waits for the owner, who replans it.
    provider.release(() => true, { ok: false, output: "", error: "HTTP 429 rate limit" });
    await until(async () => (await mission(h, parent.missionId)).state === "waiting_for_user", "parent waiting");
    assert.equal((await auth()).revokedAt, null, "still live while the parent only waits");
    ok(await h.command("mission.replan", { id: parent.missionId }));
    assert.ok((await auth()).revokedAt, "the worker's derived envelope is revoked with its parent's");
    // Its workers on the old authority stop with it, instead of waiting for approvals nobody can give.
    const done = await closedWorker(h, 1, worker.id);
    assert.equal((await mission(h, worker.childMissionId)).state, "stopped");
    assert.notEqual(done.result.verified, true, "work under revoked authority is never VERIFIED");
  });
});

test("T14-H a spoken goal becomes a reviewed draft; speech stops, interruptions and closing voice never touch running Missions", { skip: process.platform !== "win32" && "the contained voice worker is Windows only" }, async () => {
  const launched: OrchTask[] = [];
  const provider = gated(launched);
  await withHost(43969, provider.adapter, async (h) => {
    const alpha = await project(h, "Voice app");
    const running = await delegateAndStart(h, 1, alpha, readPlan(1));
    await until(async () => launched.length === 1, "dispatched");
    const opened = ok(await h.command("voice.session.open", { mode: "push_to_talk" })).data as Body;
    assert.equal(opened.open, true, `the real voice worker opened (simulated input, no microphone): ${JSON.stringify(opened.error)}`);
    const turn = async (text: string) => {
      const before = ok(await h.command("voice.state")).data.turnId;
      ok(await h.command("voice.text", { text }));
      return until(async () => { const v = ok(await h.command("voice.state")).data as Body; return v.turnId !== before && v.state === "IDLE" && v; }, `voice turn "${text}"`, 30_000);
    };
    const unchanged = async (label: string) => {
      const m = await mission(h, running.missionId);
      assert.deepEqual([m.state, m.steps[0].state, launched.length], ["running", "running", 1], label);
    };
    // A spoken goal is a canonical Mission draft: it waits for the owner's on-screen review and never starts by voice.
    const drafted = await turn("prepare a plan for writing the changelog");
    console.log(`T14-H spoken answer: ${drafted.answer}`);
    const draft = await until(async () => (await h.state()).missions.missions.find((m: Body) => m.origin === "voice:workstation"), "voice draft");
    assert.equal(draft.state, "waiting_for_approval");
    assert.equal(draft.startedAt, null);
    assert.equal(draft.autonomy.phase, "WAITING_AUTHORIZATION");
    await unchanged("a draft never touches running work");
    // Speech stop silences Bunny only.
    await turn("be quiet");
    await unchanged("speech stop");
    ok(await h.command("voice.interrupt", { source: "hotkey" }));
    await unchanged("barge-in interrupt");
    // "Stop the mission" is a proposal that needs the screen; cancelling it leaves everything running.
    await turn("stop the mission");
    await unchanged("a spoken stop is only a proposal");
    ok(await h.command("voice.control.cancel"));
    await unchanged("cancelled proposal");
    const status = await turn("what is my agent doing");
    assert.ok(typeof status.answer === "string" && status.answer.length > 0, "status is answered from Host facts");
    // Closing the voice session is not closing the Host: the Mission keeps running in the background.
    ok(await h.command("voice.session.close"));
    await unchanged("voice closed");
    provider.release();
    await until(async () => (await mission(h, running.missionId)).state === "completed", "completed after voice closed");
    ok(await h.command("mission.stop", { id: draft.id }));
  }, { workerExtraArgs: ["--output", "null"] });
});

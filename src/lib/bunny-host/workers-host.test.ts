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
import { WORKER_LIMITS } from "./workers.ts";

/**
 * M-A-3 T13.3 Gate D at the real Host HTTP surface: worker admission, the full lifecycle through a real child Mission,
 * Host-only verification, refusals, recursion, limits, cancellation propagation, restart and device refusal.
 * Ports 43880-43889.
 */

type Body = Record<string, any>;
type Host = Awaited<ReturnType<typeof boot>>;

function neverLaunches(): ProviderAdapter {
  return {
    id: "claude",
    detect: async () => ({ ...providerBase("claude"), installed: true, authenticated: true, availability: "ready", capabilities: ["text"], current_model: "fixture" }),
    launch: () => {
      throw new Error("The worker fixture must never launch a provider.");
    },
  };
}

/** A ready provider that records each launched task and answers it at once. */
function recording(launched: OrchTask[]): ProviderAdapter {
  const base = neverLaunches();
  return {
    ...base,
    detect: async () => ({ ...(await base.detect()), capabilities: ["text", "filesystem"] }),
    launch: (task) => {
      launched.push(task);
      return { done: Promise.resolve({ ok: true, output: "Notes: the release is on track." }), stop: async () => {} };
    },
  };
}

async function boot(directory: string, port: number, adapter: ProviderAdapter = neverLaunches()) {
  const root = join(directory, "project");
  mkdirSync(root, { recursive: true });
  const host = await startHost({
    dataDirectory: directory,
    root,
    port,
    adapters: [adapter],
    missions: { adapters: [new FilesystemCapability(), new TerminalCapability(), new GitCapability(directory)] },
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
  const state = async (token = host.token) => {
    const response = await fetch(`${base}/state`, { headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, body: (await response.json()) as Body };
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

async function withHost(port: number, work: (h: Host, reboot: () => Promise<Host>) => Promise<void>, adapter?: ProviderAdapter) {
  const directory = mkdtempSync(join(tmpdir(), "bunny-t13-3-workers-"));
  let h: Host | undefined;
  try {
    h = await boot(directory, port, adapter);
    await work(h, async () => {
      await h!.close();
      h = await boot(directory, port, adapter);
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
/** A Project whose npm test exits with the given code. */
const project = async (h: Host, name: string, testExit = 0) => {
  const path = join(h.directory, name.replace(/\W+/g, "-"));
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "package.json"), JSON.stringify({ name: "fixture", private: true, scripts: { test: `node -e "process.exit(${testExit})"`, typecheck: 'node -e "process.exit(0)"', lint: 'node -e "process.exit(0)"' } }));
  return ok(await h.command("project.add", { name, path })).data.id as string;
};
const delegate = async (h: Host, slot: number, title: string, projectId: string | null) => {
  const agentId = ok(await h.command("personal_agent.delegate", { slot, objective: `Work on ${title}`, title, ...(projectId ? { projectId } : {}) })).data.agentId as string;
  const agent = (await h.state()).body.agents.agents.find((row: Body) => row.id === agentId);
  return agent.missionId as string;
};
const workersOf = async (h: Host, slot: number) => (await h.state()).body.personalAgentContext.slots.find((row: Body) => row.slot === slot).workers as Body[];
const until = async <T,>(check: () => Promise<T | undefined | null | false>, label: string, timeout = 60_000): Promise<T> => {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
};
const closed = (h: Host, slot: number, id: string) =>
  until(async () => (await workersOf(h, slot)).find((worker) => worker.id === id && worker.state === "CLOSED"), `worker ${id} to close`);
const approve = async (h: Host, missionId: string) => {
  await until(async () => (await h.state()).body.missions.missions.find((m: Body) => m.id === missionId)?.state === "waiting_for_approval", "child Mission approval");
  ok(await h.command("mission.approve", { id: missionId, start: true }));
};

test("T13.3 D a worker runs as a real child Mission and is VERIFIED only by the Host; a failing one is REJECTED", async () => {
  await withHost(43880, async (h) => {
    const alpha = await project(h, "Alpha site", 0);
    const broken = await project(h, "Broken app", 1);
    const parent = await delegate(h, 1, "Alpha release", alpha);
    const brokenParent = await delegate(h, 1, "Broken release", broken);
    ok(await h.command("lotus.remember", { scope: `project:${alpha}`, key: "Test command", value: "Alpha tests run with npm test" }));
    ok(await h.command("lotus.remember", { scope: "agent:1", key: "Private test opinion", value: "Gada thinks the tests are flaky" }));

    const proposed = ok(await h.command("worker.propose", { slot: 1, parentMissionId: parent, ability: "test", objective: "Run the Alpha tests", projectId: alpha }));
    const worker = proposed.data.worker as Body;
    assert.equal(worker.state, "ADMITTED");
    assert.deepEqual([worker.tools, worker.harness, worker.provenance, worker.projectId], [["terminal.exec"], ["skill:project.test"], "agent:1", alpha]);
    assert.deepEqual(worker.context, ["Test command: Alpha tests run with npm test (Project note, you told me)"], "the worker gets the Project slice only");
    assert.ok(worker.childMissionId && worker.childMissionId !== parent);
    assert.equal(proposed.mission.projectId, alpha);

    await approve(h, worker.childMissionId);
    const done = await closed(h, 1, worker.id);
    assert.deepEqual(done.history.map((row: Body) => row.state), ["PROPOSED", "ELIGIBILITY_CHECK", "ADMITTED", "RUNNING", "RESULT_REPORTED", "VERIFIED", "CLOSED"], JSON.stringify(done));
    assert.equal(done.result.verified, true);
    assert.deepEqual(done.providers, [], "a skill worker uses no model provider");

    const failing = ok(await h.command("worker.propose", { slot: 1, parentMissionId: brokenParent, ability: "test", objective: "Run the broken tests", projectId: broken })).data.worker as Body;
    await approve(h, failing.childMissionId);
    const rejected = await closed(h, 1, failing.id);
    assert.ok(rejected.history.some((row: Body) => row.state === "REJECTED"), JSON.stringify(rejected));
    assert.equal(rejected.result.verified, false);
    const events = (await h.state()).body.events as Body[];
    assert.ok(events.some((event) => event.type === "worker.admitted"));
    assert.ok(events.some((event) => event.type === "worker.closed" && /VERIFIED/.test(event.detail)));
  });
});

const refusedWith = (result: { status: number; body: Body }, pattern: RegExp) => {
  assert.equal(result.status, 400, JSON.stringify(result.body));
  assert.match(String(result.body.error), pattern);
};

test("T13.3 D refusals: ownership, recursion, Project, tools, limits; every refused proposal is recorded as REJECTED", async () => {
  await withHost(43881, async (h) => {
    const alpha = await project(h, "Alpha site");
    const beta = await project(h, "Beta site");
    const gadaMission = await delegate(h, 1, "Alpha release", alpha);
    const propose = (slot: number, extra: Body) =>
      h.command("worker.propose", { slot, parentMissionId: gadaMission, ability: "test", objective: "Run the tests", projectId: alpha, ...extra });

    refusedWith(await propose(2, {}), /only to a Mission it owns/);
    refusedWith(await propose(1, { projectId: beta }), /parent Mission's Project/);
    refusedWith(await propose(1, { tools: ["terminal.exec", "filesystem.write"] }), /beyond its ability \(filesystem\.write\)/);
    refusedWith(await propose(1, { ability: "nonexistent" }), /not in the catalogue/);
    refusedWith(await propose(1, { parentMissionId: "mission-missing" }), /needs a parent Mission/);

    const first = ok(await propose(1, {})).data.worker as Body;
    refusedWith(await propose(1, { parentMissionId: first.childMissionId }), /cannot create workers/);
    ok(await propose(1, {}));
    ok(await propose(1, {}));
    refusedWith(await propose(1, {}), /already has 3 open workers/);

    const spear = await workersOf(h, 2);
    assert.equal(spear.length, 1);
    assert.deepEqual(spear[0].history.map((row: Body) => row.state), ["PROPOSED", "ELIGIBILITY_CHECK", "REJECTED", "CLOSED"]);
    assert.equal(spear[0].childMissionId, null, "a refused worker never gets a Mission");
    const gada = await workersOf(h, 1);
    assert.equal(gada.filter((worker) => worker.state === "ADMITTED").length, 3);
    assert.equal(gada.filter((worker) => worker.state === "CLOSED" && worker.childMissionId === null).length, 6);
    const missions = (await h.state()).body.missions.missions as Body[];
    assert.equal(missions.filter((mission) => /worker/.test(mission.title)).length, 3, "only admitted workers created Missions");
  });
});

test("T13.3 D cancellation propagates from the parent and worker.cancel; an admitted worker survives restart unfinished", async () => {
  await withHost(43882, async (h, reboot) => {
    const alpha = await project(h, "Alpha site");
    const parent = await delegate(h, 1, "Alpha release", alpha);
    const propose = () => h.command("worker.propose", { slot: 1, parentMissionId: parent, ability: "test", objective: "Run the tests", projectId: alpha });
    const kept = ok(await propose()).data.worker as Body;
    const cancelled = ok(await propose()).data.worker as Body;

    ok(await h.command("worker.cancel", { id: cancelled.id }));
    const stopped = await closed(h, 1, cancelled.id);
    assert.ok(stopped.history.some((row: Body) => row.state === "INDETERMINATE"), JSON.stringify(stopped));
    assert.equal((await h.state()).body.missions.missions.find((m: Body) => m.id === cancelled.childMissionId).state, "stopped");

    h = await reboot();
    const survived = (await workersOf(h, 1)).find((worker) => worker.id === kept.id)!;
    assert.equal(survived.state, "ADMITTED", "a restart never marks a worker complete");
    assert.equal(survived.result, null);

    ok(await h.command("mission.stop", { id: parent }));
    const orphan = await closed(h, 1, kept.id);
    assert.ok(orphan.history.some((row: Body) => row.state === "INDETERMINATE"), JSON.stringify(orphan));
    assert.equal((await h.state()).body.missions.missions.find((m: Body) => m.id === kept.childMissionId).state, "stopped");
    refusedWith(await propose(), /has ended/);
  });
});

test("T13.3 D a described ability waits for review, then runs its approved skills; devices are refused", async () => {
  await withHost(43883, async (h) => {
    const alpha = await project(h, "Alpha site");
    const parent = await delegate(h, 1, "Alpha release", alpha);
    refusedWith(await h.command("worker.ability.compose", { name: "Shell anything", description: "x", components: ["research"] }), /only built-in Host-verified/);
    const ability = ok(await h.command("worker.ability.compose", { name: "Pre-merge check", description: "Typecheck then lint", components: ["typecheck", "lint"] })).data.ability as Body;
    assert.equal(ability.status, "pending_review");
    const propose = () => h.command("worker.propose", { slot: 1, parentMissionId: parent, ability: ability.id, objective: "Check before merge", projectId: alpha });
    refusedWith(await propose(), /waiting for your review/);

    const phone = await h.pair("Phone");
    for (const [action, data] of [
      ["worker.propose", { slot: 1, parentMissionId: parent, ability: "test", objective: "x", projectId: alpha }],
      ["worker.cancel", { id: "x" }],
      ["worker.ability.compose", { name: "Phone ability", description: "x", components: ["test"] }],
      ["worker.ability.approve", { id: ability.id }],
      ["worker.ability.remove", { id: ability.id }],
    ] as const) {
      const result = await h.command(action, data, phone.token);
      assert.equal(result.body.code, "WORKSTATION_REQUIRED", `${action}: ${JSON.stringify(result.body)}`);
    }
    assert.equal((await h.state(phone.token)).body.personalAgentContext, undefined, "devices never see Agent workers");

    ok(await h.command("worker.ability.approve", { id: ability.id }));
    const worker = ok(await propose()).data.worker as Body;
    assert.deepEqual(worker.harness, ["skill:project.typecheck", "skill:project.lint"]);
    await approve(h, worker.childMissionId);
    const done = await closed(h, 1, worker.id);
    assert.equal(done.result.verified, true, JSON.stringify(done));
    ok(await h.command("worker.ability.remove", { id: ability.id }));
    assert.ok(!(await h.state()).body.personalAgentContext.abilities.some((row: Body) => row.id === ability.id));
  });
});

test("T13.3 D a model worker's Project memory reaches only its model prompt; a device can neither read it nor release the worker", async () => {
  const launched: OrchTask[] = [];
  await withHost(43884, async (h) => {
    const alpha = await project(h, "Alpha site");
    const parent = await delegate(h, 1, "Alpha release", alpha);
    ok(await h.command("lotus.remember", { scope: `project:${alpha}`, key: "Release codename", value: "Kestrel" }));
    const phone = await h.pair("Phone");

    const worker = ok(await h.command("worker.propose", { slot: 1, parentMissionId: parent, ability: "research", objective: "Summarize the Alpha release", projectId: alpha })).data.worker as Body;
    assert.deepEqual(worker.context, ["Release codename: Kestrel (Project note, you told me)"]);
    const child = worker.childMissionId as string;
    await until(async () => (await h.state()).body.missions.missions.find((m: Body) => m.id === child)?.state === "waiting_for_approval", "child Mission approval");
    const view = ok(await h.command("mission.get", { id: child })).data as Body;
    assert.equal(view.mission.objective, "Summarize the Alpha release", "the Mission carries the objective only");
    assert.deepEqual(view.mission.steps.map((step: Body) => step.objective), ["Summarize the Alpha release"]);

    assert.doesNotMatch(JSON.stringify((await h.state(phone.token)).body), /Kestrel/, "device /state");
    assert.doesNotMatch(JSON.stringify((await h.command("mission.get", { id: child }, phone.token)).body), /Kestrel/, "device mission.get");
    for (const [action, data] of [
      ["mission.approve", { id: child, start: true }],
      ["mission.start", { id: child }],
      ["mission.retry", { id: child }],
    ] as const) {
      const result = await h.command(action, data, phone.token);
      assert.equal(result.body.code, "WORKSTATION_REQUIRED", `${action}: ${JSON.stringify(result.body)}`);
    }
    assert.equal((await h.state()).body.missions.missions.find((m: Body) => m.id === child).state, "waiting_for_approval", "the device changed nothing");
    // F2's fourth path: a device answering a request that belongs to the worker's child Mission (mapped through the request).
    h.host.missions.store.saveRequest({ id: "worker-ask", missionId: child, stepId: view.mission.steps[0].id, action: "filesystem.read", risk: "READ", reason: "fixture ask", createdAt: Date.now(), resolvedAt: null, resolution: null, resolvedBy: null, batchOffer: null });
    const answered = await h.command("mission.respond", { requestId: "worker-ask", decision: "allow_once" }, phone.token);
    assert.equal(answered.body.code, "WORKSTATION_REQUIRED", JSON.stringify(answered.body));
    assert.match(String(answered.body.error), /worker is approved on the workstation/);
    assert.equal(h.host.missions.store.request("worker-ask").resolvedAt, null, "the device answered nothing");

    await approve(h, child);
    await until(async () => launched.length > 0, "the model launch");
    assert.match(launched[0].prompt, /\n\nContext from the Project's memory \(labelled notes, not verified facts[^\n]*\n- Release codename: Kestrel/, "the model prompt carries the labelled memory under its own heading");
    assert.doesNotMatch(launched[0].prompt.split("Context from the Project's memory")[0], /Kestrel/, "the memory is never listed as a verified fact");
    assert.doesNotMatch(JSON.stringify((await h.state(phone.token)).body), /Kestrel/, "device /state after the run");
  }, recording(launched));
});

test("T13.3 F12: reassigning a parent Agent moves its open workers to the new slot; closed workers keep their history", async () => {
  await withHost(43885, async (h) => {
    const alpha = await project(h, "Alpha site");
    const parent = await delegate(h, 1, "Alpha release", alpha);
    const agentId = (await h.state()).body.agents.agents.find((row: Body) => row.missionId === parent).id as string;
    const propose = () => h.command("worker.propose", { slot: 1, parentMissionId: parent, ability: "test", objective: "Run the tests", projectId: alpha });
    const open = ok(await propose()).data.worker as Body;
    const done = ok(await propose()).data.worker as Body;
    ok(await h.command("worker.cancel", { id: done.id }));
    await closed(h, 1, done.id);

    ok(await h.command("personal_agent.assign", { slot: 2, agentId }));
    // The exact reported case: before the fix the open worker stayed under slot 1 after its parent moved to slot 2.
    assert.ok((await workersOf(h, 2)).some((worker) => worker.id === open.id), "the open worker follows its parent Agent");
    assert.ok(!(await workersOf(h, 1)).some((worker) => worker.id === open.id), "the old slot no longer names it");
    assert.ok((await workersOf(h, 1)).some((worker) => worker.id === done.id && worker.state === "CLOSED"), "closed history keeps its slot");
    // Slot 2 now owns the parent Mission, so it may add workers there; slot 1 no longer may.
    refusedWith(await h.command("worker.propose", { slot: 1, parentMissionId: parent, ability: "test", objective: "x", projectId: alpha }), /only to a Mission it owns/);

    // N3: a Studio rebinding is the other ownership path; the open worker follows it too.
    const config = (await h.state()).body.personalAgents;
    const slots = config.slots.map((row: Body) => ({
      slot: row.slot, weapon: row.weapon, displayName: row.displayName, description: row.description, purpose: row.purpose,
      style: row.style, responsibilities: row.responsibilities, active: row.active, agentId: row.slot === 3 ? agentId : null,
    }));
    ok(await h.command("personal_agents.configure", { slots, expectRevision: config.revision }));
    assert.ok((await workersOf(h, 3)).some((worker) => worker.id === open.id), "a Studio rebinding moves the open worker");
    assert.ok(!(await workersOf(h, 2)).some((worker) => worker.id === open.id));

    // N4: a move that would exceed the receiving slot's open-worker cap is refused and changes nothing.
    // Slot 4 fills its open-worker cap across two parents (each parent holds at most openPerParent).
    const others = [await delegate(h, 4, "Beta release", alpha), await delegate(h, 4, "Gamma release", alpha)];
    for (let i = 0; i < WORKER_LIMITS.openPerSlot; i++)
      ok(await h.command("worker.propose", { slot: 4, parentMissionId: others[i % 2], ability: "test", objective: `Run ${i}`, projectId: alpha }));
    refusedWith(await h.command("personal_agent.assign", { slot: 4, agentId }), /would have \d+ open workers \(limit/);
    assert.ok((await workersOf(h, 3)).some((worker) => worker.id === open.id), "the refused move left the worker where it was");
    assert.equal((await h.state()).body.personalAgentContext.slots.find((row: Body) => row.slot === 3).owned.some((row: Body) => row.agentId === agentId), true, "ownership did not change");
  });
});

test("T13.3 N1: pausing a Personal Agent holds its workers' child Missions", async () => {
  await withHost(43886, async (h) => {
    const alpha = await project(h, "Alpha site");
    const parent = await delegate(h, 1, "Alpha release", alpha);
    const agentId = (await h.state()).body.agents.agents.find((row: Body) => row.missionId === parent).id as string;
    const worker = ok(await h.command("worker.propose", { slot: 1, parentMissionId: parent, ability: "test", objective: "Run the tests", projectId: alpha })).data.worker as Body;
    ok(await h.command("agent.pause", { id: agentId }));
    await approve(h, worker.childMissionId);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const held = (await h.state()).body.missions.missions.find((m: Body) => m.id === worker.childMissionId);
    // The exact reported case: before the fix the worker kept launching steps while its Agent was paused.
    assert.ok(!["completed", "failed"].includes(held.state), `held child Mission state ${held.state}`);
    assert.ok(!(await workersOf(h, 1)).some((row) => row.id === worker.id && ["VERIFIED", "CLOSED"].includes(row.state)), "no worker result while paused");
    assert.ok(held.steps.every((step: Body) => !["running", "verifying", "completed"].includes(step.state)), JSON.stringify(held.steps.map((step: Body) => step.state)));
    // Without the pause the same worker runs to VERIFIED within this window (first test); the N1 mutation check proves the gate holds it.
  });
});

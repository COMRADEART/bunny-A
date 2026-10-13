import test from "node:test";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, watch, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostDatabase } from "../bunny-host/persistence.server.ts";
import { ModelCapabilityRegistry } from "../bunny-host/model-capability.server.ts";
import { TaskManager } from "../bunny-host/manager.server.ts";
import { providerBase } from "../bunny-host/adapters.server.ts";
import type { AdapterHooks, AdapterResult, ProviderAdapter } from "../bunny-host/contracts.ts";
import type { OrchTask, ProviderId, ProviderLive } from "../orch/types.ts";
import { MissionManager } from "./manager.server.ts";
import { missionCommand } from "./commands.server.ts";
import { FilesystemCapability, NotificationsCapability, TerminalCapability } from "./capabilities/local.server.ts";
import type { CapabilityAdapter } from "./capabilities/bus.server.ts";
import { classifyDeviceWrite, DEVICE_REVIEW_REASON, deviceWriteClassRefusal } from "./authorization.server.ts";
import type { PermissionRequest } from "./types.ts";
import { escapedText } from "./staging.server.ts";
import { BUILTIN_SKILLS } from "./skills.server.ts";

/**
 * M-A-3 T9R-F02: a paired device's file change is staged in Host-owned private state and reaches the project only
 * after a workstation promotion of the exact reviewed bytes. Every case drives MissionManager / CapabilityBus /
 * missionCommand in process; "workstation" and PHONE actors are the same fixtures remote-authority.test.ts uses.
 */
const PHONE = "device:f02-phone";
const DESKTOP_ONLY = /Approval required on Windows Host/;
const PROMOTE_REFUSED = /Promotion refused/;

function ready(id: ProviderId): ProviderLive {
  return { ...providerBase(id), installed: true, authenticated: true, availability: "ready", capabilities: ["filesystem", "terminal", "text"], current_model: null };
}
type Launched = { task: OrchTask; finish: (result: AdapterResult) => void; hooks: AdapterHooks };
function fakeAdapter(id: ProviderId, launched: Launched[]): ProviderAdapter {
  return { id, detect: async () => ready(id), launch: (task, hooks) => {
    let finish!: (result: AdapterResult) => void; const done = new Promise<AdapterResult>((resolve) => (finish = resolve));
    launched.push({ task, finish, hooks });
    return { done, stop: async () => finish({ ok: false, output: "", stopped: true }) };
  } };
}
const until = async (check: () => boolean, label: string, timeout = 15000) => {
  const start = Date.now();
  while (!check()) { if (Date.now() - start > timeout) throw new Error(`Timed out waiting for ${label}`); await new Promise((r) => setTimeout(r, 10)); }
};
const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));
async function open(dir: string, root: string, providers: ProviderId[], launched: Launched[], adapters?: CapabilityAdapter[]) {
  const db = new HostDatabase(join(dir, "host.sqlite"));
  const tasks = new TaskManager(db, root, providers.map((id) => fakeAdapter(id, launched)), { modelRegistry: new ModelCapabilityRegistry(db, { availableProviders: () => [] }) });
  await tasks.discover();
  const missions = new MissionManager(tasks, { dataDirectory: dir, adapters: adapters ?? [new FilesystemCapability(), new TerminalCapability(), new NotificationsCapability(() => {})] });
  missions.configure({ enabled: true }, "workstation");
  await missions.bus.refreshHealth();
  return { db, tasks, missions };
}
/** Project root is dir/project unless `broadRoot`, which makes the whole Host data folder's parent the project root. */
async function setup(options: { broadRoot?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "bunny-f02-"));
  const root = options.broadRoot ? dir : join(dir, "project");
  mkdirSync(root, { recursive: true });
  const launched: Launched[] = [];
  let current = await open(dir, root, ["claude"], launched);
  const env = {
    dir, root, launched,
    get db() { return current.db; }, get tasks() { return current.tasks; }, get missions() { return current.missions; },
    /** A real Host restart over the same SQLite state: new TaskManager and MissionManager, new epoch. */
    restart: async () => { await current.missions.close(); current.db.close(); current = await open(dir, root, ["claude"], launched); },
    cleanup: async () => { for (const session of launched) session.finish({ ok: false, output: "", stopped: true }); await settle(60); await current.missions.close(); try { current.db.close(); } catch { /* closed */ } rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); },
  };
  return env;
}
type Env = Awaited<ReturnType<typeof setup>>;

const phoneApprove = (env: Env, id: string, start = true, plan?: string) => missionCommand(env.missions, "mission.approve", { id, start, ...(plan ? { plan } : {}) }, { local: false, actor: PHONE });
const phoneRespond = (env: Env, requestId: string, decision: "allow_once" | "deny") => missionCommand(env.missions, "mission.respond", { requestId, decision }, { local: false, actor: PHONE });
const writeStep = (path: string, content: string, extra: Record<string, unknown> = {}) => ({
  key: "write", role: "Write", objective: `write ${path}`, dependsOn: [], executor: { kind: "capability", action: "filesystem.write", params: { path, content, overwrite: true } },
  verification: [{ kind: "file_exists", path, contains: content }], maxRetries: 0, ...extra,
});
/** A Mission whose one step is a phone-attributed write once the phone approves it. */
const writeMission = (env: Env, path: string, content: string, extra: Record<string, unknown> = {}) =>
  env.missions.create({ objective: `Write ${path}`, mode: "fast", origin: "workstation", steps: [writeStep(path, content, extra)] });
const requestsOf = (env: Env, missionId: string) => env.missions.store.requests(missionId);
const openRequests = (env: Env, missionId: string) => requestsOf(env, missionId).filter((request) => !request.resolvedAt);
const promotionAsk = (env: Env, missionId: string) => openRequests(env, missionId).find((request) => request.promotion);
async function waitPromotion(env: Env, missionId: string): Promise<PermissionRequest> {
  await until(() => !!promotionAsk(env, missionId), "promotion ask");
  return promotionAsk(env, missionId)!;
}
const stagedFor = (env: Env, missionId: string) => env.missions.staging.forMission(missionId);
const stepsOf = (env: Env, missionId: string) => env.missions.store.steps(missionId);
const completed = (env: Env, missionId: string) => env.missions.mission(missionId).state === "completed";

/** Phone-approved write to a path that must NOT be staged: the Host keeps a workstation-only ask and nothing is written. */
async function assertDesktopOnly(env: Env, path: string, content = "phone change") {
  const view = writeMission(env, path, content);
  await phoneApprove(env, view.id);
  await until(() => !!openRequests(env, view.id).find((request) => request.action === "filesystem.write"), `write ask for ${path}`);
  const ask = openRequests(env, view.id).find((request) => request.action === "filesystem.write")!;
  assert.equal(ask.desktopRequired, true, `${path}: desktop-required ask`);
  assert.equal(promotionAsk(env, view.id), undefined, `${path}: no promotion was offered`);
  assert.equal(stagedFor(env, view.id).length, 0, `${path}: nothing staged`);
  await assert.rejects(phoneRespond(env, ask.id, "allow_once"), DESKTOP_ONLY, `${path}: phone answer refused`);
  assert.equal(existsSync(join(env.root, path)), false, `${path}: project untouched`);
  return ask;
}
/** Fail-closed outcome for a path that is unsafe or unresolvable: a desktop ask or a failed step, never a staged change. */
async function assertFailsClosed(env: Env, path: string, content = "phone change") {
  const view = writeMission(env, path, content);
  await phoneApprove(env, view.id);
  await until(() => !!openRequests(env, view.id)[0] || stepsOf(env, view.id).some((step) => step.state === "failed"), `fail-closed outcome for ${path}`);
  await settle(100);
  assert.equal(stagedFor(env, view.id).length, 0, `${path}: nothing staged`);
  assert.equal(promotionAsk(env, view.id), undefined, `${path}: no promotion offered`);
  const ask = openRequests(env, view.id)[0];
  if (ask) assert.equal(ask.desktopRequired, true, `${path}: any ask is workstation-only`);
  if (ask) await assert.rejects(phoneRespond(env, ask.id, "allow_once"), DESKTOP_ONLY, `${path}: phone answer refused`);
  return view.id;
}

// ── E01 ──────────────────────────────────────────────────────────────────────
test("F02-E01: a phone's safe .md document is staged, the project is untouched, and workstation promotion completes it", async () => {
  const env = await setup();
  try {
    const view = writeMission(env, "note.md", "from phone");
    await phoneApprove(env, view.id);
    const ask = await waitPromotion(env, view.id);
    assert.equal(ask.desktopRequired, true);
    assert.equal(existsSync(join(env.root, "note.md")), false, "project untouched while staged");
    const [record] = stagedFor(env, view.id);
    assert.equal(record.promotionState, "STAGED");
    assert.equal(record.classification, "PHONE_SAFE_DOCUMENT");
    assert.equal(readFileSync(env.missions.staging.contentPath(record.id), "utf8"), "from phone", "staged bytes are exact");
    await assert.rejects(phoneRespond(env, ask.id, "allow_once"), DESKTOP_ONLY, "a phone cannot promote");
    await env.missions.respond(ask.id, "allow_once", "workstation");
    await until(() => completed(env, view.id), "mission completed after promotion");
    assert.equal(readFileSync(join(env.root, "note.md"), "utf8"), "from phone");
    assert.equal(env.missions.staging.get(record.id)!.promotionState, "PROMOTED");
    assert.equal(openRequests(env, view.id).length, 0, "the promotion ask is closed");
  } finally { await env.cleanup(); }
});

// ── E02 ──────────────────────────────────────────────────────────────────────
test("F02-E02: execution-sensitive JSON (package.json, root x.json, .vscode/settings.json) is refused as not phone-safe", async () => {
  const env = await setup();
  try {
    for (const path of ["package.json", "x.json", ".vscode/settings.json"]) {
      const ask = await assertDesktopOnly(env, path, "{}");
      assert.match(ask.reason, DESKTOP_ONLY, path);
      assert.notEqual(classifyDeviceWrite(path, { base: env.root, operation: "write", content: "{}" }).classification, "PHONE_SAFE_DOCUMENT", path);
      assert.equal(deviceWriteClassRefusal(path, env.root, "write", "{}") !== null, true, path);
    }
  } finally { await env.cleanup(); }
});

// ── E03 ──────────────────────────────────────────────────────────────────────
test("F02-E03: .github/workflows/ci.yml cannot receive a phone write at all", async () => {
  const env = await setup();
  try {
    await assertDesktopOnly(env, ".github/workflows/ci.yml", "on: push");
    assert.equal(classifyDeviceWrite(".github/workflows/ci.yml", { base: env.root, operation: "write", content: "on: push" }).classification, "EXECUTION_RELEVANT");
  } finally { await env.cleanup(); }
});

// ── E04 ──────────────────────────────────────────────────────────────────────
test("F02-E04: AGENTS.md, CLAUDE.md and .claude/x.md are refused as AGENT_INSTRUCTIONS", async () => {
  const env = await setup();
  try {
    for (const path of ["AGENTS.md", "CLAUDE.md", ".claude/x.md"]) {
      const ask = await assertDesktopOnly(env, path, "# instructions");
      assert.match(ask.reason, DESKTOP_ONLY, path);
      assert.equal(classifyDeviceWrite(path, { base: env.root, operation: "write", content: "# instructions" }).classification, "AGENT_INSTRUCTIONS", path);
    }
  } finally { await env.cleanup(); }
});

// ── E05 ──────────────────────────────────────────────────────────────────────
test("F02-E05: unknown purposes (extensionless notes, .mdx, NTFS stream x.md:stream) fail closed", async () => {
  const env = await setup();
  try {
    await assertDesktopOnly(env, "notes", "plain text");
    await assertDesktopOnly(env, "page.mdx", "# page");
    assert.equal(classifyDeviceWrite("notes", { base: env.root, operation: "write", content: "plain" }).classification, "EXECUTION_RELEVANT");
    assert.equal(classifyDeviceWrite("page.mdx", { base: env.root, operation: "write", content: "# page" }).classification, "EXECUTION_RELEVANT");
    assert.equal(classifyDeviceWrite("x.md:stream", { base: env.root, operation: "write", content: "x" }).classification, "UNKNOWN");
    await assertFailsClosed(env, "x.md:stream", "stream body");
    assert.equal(existsSync(join(env.root, "x.md")), false);
  } finally { await env.cleanup(); }
});

// ── E06 ──────────────────────────────────────────────────────────────────────
test("F02-E06: path traversal ('../x.md') is refused and nothing lands outside the project", async () => {
  const env = await setup();
  try {
    await assertFailsClosed(env, "../x.md", "escape");
    assert.equal(existsSync(join(env.dir, "x.md")), false, "nothing written beside the project");
    assert.equal(classifyDeviceWrite("../x.md", { base: env.root, operation: "write", content: "escape" }).classification, "UNKNOWN");
  } finally { await env.cleanup(); }
});

// ── E07 ──────────────────────────────────────────────────────────────────────
test("F02-E07: a junction destination and a hard-linked destination are refused (UNKNOWN); a junction created after staging blocks promotion", async () => {
  const env = await setup();
  try {
    const outside = join(env.dir, "outside"); mkdirSync(outside);
    symlinkSync(outside, join(env.root, "link"), "junction");
    assert.equal(classifyDeviceWrite("link/x.md", { base: env.root, operation: "write", content: "x" }).classification, "UNKNOWN");
    await assertFailsClosed(env, "link/x.md", "through junction");
    assert.equal(existsSync(join(outside, "x.md")), false, "nothing written through the junction");

    writeFileSync(join(env.root, "hard.md"), "shared");
    linkSync(join(env.root, "hard.md"), join(outside, "other.md"));
    assert.equal(classifyDeviceWrite("hard.md", { base: env.root, operation: "write", content: "x" }).classification, "UNKNOWN");
    await assertFailsClosed(env, "hard.md", "over hard link");
    assert.equal(readFileSync(join(env.root, "hard.md"), "utf8"), "shared");
    assert.equal(readFileSync(join(outside, "other.md"), "utf8"), "shared");
  } finally { await env.cleanup(); }
});

test("F02-E07b: a junction created AFTER staging makes promotion refuse; the outside folder stays untouched", async () => {
  const env = await setup();
  try {
    mkdirSync(join(env.root, "notes"));
    const view = writeMission(env, "notes/x.md", "staged body");
    await phoneApprove(env, view.id);
    const ask = await waitPromotion(env, view.id);
    const outside = join(env.dir, "outside-after");
    mkdirSync(outside);
    rmSync(join(env.root, "notes"), { recursive: true, force: true });
    symlinkSync(outside, join(env.root, "notes"), "junction");
    await assert.rejects(env.missions.respond(ask.id, "allow_once", "workstation"), PROMOTE_REFUSED);
    const [record] = stagedFor(env, view.id);
    // Either the destination fails the unresolved-path check or the outside-the-write-roots check; both refuse.
    assert.ok(["FAILED", "INVALIDATED_BY_SCOPE_CHANGE"].includes(record.promotionState), record.promotionState);
    assert.notEqual(record.promotionState, "PROMOTED");
    assert.equal(existsSync(join(outside, "x.md")), false, "nothing reached the junction target");
  } finally { await env.cleanup(); }
});

// ── E08 ──────────────────────────────────────────────────────────────────────
test("F02-E08: a promotion request for Mission A cannot promote Mission A's staging into Mission B", async () => {
  const env = await setup();
  try {
    const a = writeMission(env, "a.md", "content of A");
    const b = writeMission(env, "b.md", "content of B");
    await phoneApprove(env, a.id);
    await phoneApprove(env, b.id);
    const askA = await waitPromotion(env, a.id);
    const askB = await waitPromotion(env, b.id);
    const stagedA = stagedFor(env, a.id)[0];
    const tampered = { ...env.missions.store.request(askB.id), promotion: { ...askB.promotion!, stagingId: stagedA.id, contentHash: stagedA.contentHash, contentSize: stagedA.contentSize, destination: askB.promotion!.destination } };
    env.missions.store.saveRequest(tampered as PermissionRequest);
    await assert.rejects(env.missions.respond(askB.id, "allow_once", "workstation"), PROMOTE_REFUSED);
    assert.equal(existsSync(join(env.root, "a.md")), false, "A's change was not promoted by B's request");
    assert.equal(existsSync(join(env.root, "b.md")), false, "B's change was not written");
    assert.notEqual(env.missions.staging.get(stagedA.id)!.promotionState, "PROMOTED");
    assert.ok(askA && !askA.resolvedAt);
  } finally { await env.cleanup(); }
});

// ── E09 ──────────────────────────────────────────────────────────────────────
test("F02-E09: a Mission read or list of the private staging folder is refused even with a broad root", async () => {
  const env = await setup();
  try {
    const view = writeMission(env, "secret.md", "from phone");
    await phoneApprove(env, view.id);
    const record = await waitPromotion(env, view.id).then(() => stagedFor(env, view.id)[0]);
    const broadProbe = async (action: string, path: string) => {
      try {
        const result = await env.missions.bus.request({ action, params: { path }, missionId: null, stepId: null, envelope: null, origin: "workstation", cwd: env.dir, roots: [env.dir], direct: { confirmed: true } });
        assert.ok(!JSON.stringify(result ?? {}).includes("from phone"), `${action} leaked staged bytes`);
        assert.notEqual(result?.run?.status, "succeeded", `${action} ${path} must not succeed`);
      } catch (error) {
        assert.match(String(error), /staged|private|outside|approved scope/i, `${action} refused for the staging folder`);
      }
    };
    await broadProbe("filesystem.read", env.missions.staging.contentPath(record.id));
    await broadProbe("filesystem.read", join(env.dir, "staging", record.id, "content"));
    await broadProbe("filesystem.list", join(env.dir, "staging"));
    await broadProbe("filesystem.list", join(env.dir, "staging", record.id));
    assert.equal(readFileSync(env.missions.staging.contentPath(record.id), "utf8"), "from phone", "the Host itself still reads its staging");
    await env.missions.respond(promotionAsk(env, view.id)!.id, "deny", "workstation");
  } finally { await env.cleanup(); }
});

// ── E10 ──────────────────────────────────────────────────────────────────────
test("F02-E10: staged bytes rewritten on disk after staging make promotion refuse FAILED; the destination stays untouched", async () => {
  const env = await setup();
  try {
    const view = writeMission(env, "note.md", "from phone");
    await phoneApprove(env, view.id);
    const ask = await waitPromotion(env, view.id);
    const [record] = stagedFor(env, view.id);
    writeFileSync(env.missions.staging.contentPath(record.id), "tampered-content-xyz");
    await assert.rejects(env.missions.respond(ask.id, "allow_once", "workstation"), PROMOTE_REFUSED);
    assert.equal(env.missions.staging.get(record.id)!.promotionState, "FAILED");
    assert.equal(existsSync(join(env.root, "note.md")), false, "destination untouched");
  } finally { await env.cleanup(); }
});

// ── E11 ──────────────────────────────────────────────────────────────────────
test("F02-E11: a destination created after staging, or edited after staging, makes promotion refuse; the file is not overwritten", async () => {
  const env = await setup();
  try {
    const created = writeMission(env, "created.md", "from phone");
    await phoneApprove(env, created.id);
    const askCreated = await waitPromotion(env, created.id);
    writeFileSync(join(env.root, "created.md"), "someone else created this");
    await assert.rejects(env.missions.respond(askCreated.id, "allow_once", "workstation"), PROMOTE_REFUSED);
    assert.equal(readFileSync(join(env.root, "created.md"), "utf8"), "someone else created this");
    assert.equal(stagedFor(env, created.id)[0].promotionState, "FAILED");

    writeFileSync(join(env.root, "edited.md"), "old body");
    const edited = writeMission(env, "edited.md", "from phone");
    await phoneApprove(env, edited.id);
    const askEdited = await waitPromotion(env, edited.id);
    writeFileSync(join(env.root, "edited.md"), "edited after staging");
    await assert.rejects(env.missions.respond(askEdited.id, "allow_once", "workstation"), PROMOTE_REFUSED);
    assert.equal(readFileSync(join(env.root, "edited.md"), "utf8"), "edited after staging");
    assert.equal(stagedFor(env, edited.id)[0].promotionState, "FAILED");
  } finally { await env.cleanup(); }
});

// ── E12 / E13 ────────────────────────────────────────────────────────────────
test("F02-E12: a recursive watcher on the project sees no change while the phone write is staged", async () => {
  const env = await setup();
  const events: string[] = [];
  let watcher: ReturnType<typeof watch> | null = null;
  try {
    await settle(100);
    watcher = watch(env.root, { recursive: true }, (_event, file) => events.push(String(file)));
    const view = writeMission(env, "note.md", "from phone");
    await phoneApprove(env, view.id);
    await waitPromotion(env, view.id);
    await settle(400);
    assert.equal(events.filter((name) => name.includes("note")).length, 0, `no event for the staged note (saw ${JSON.stringify(events)})`);
    assert.equal(existsSync(join(env.root, "note.md")), false);
  } finally { watcher?.close(); await env.cleanup(); }
});

test("F02-E13: the same watcher sees the change only after the workstation promotes it", async () => {
  const env = await setup();
  const events: string[] = [];
  let watcher: ReturnType<typeof watch> | null = null;
  try {
    await settle(100);
    watcher = watch(env.root, { recursive: true }, (_event, file) => events.push(String(file)));
    const view = writeMission(env, "note.md", "from phone");
    await phoneApprove(env, view.id);
    const ask = await waitPromotion(env, view.id);
    await settle(300);
    assert.equal(events.filter((name) => name.includes("note")).length, 0, "quiet while staged");
    await env.missions.respond(ask.id, "allow_once", "workstation");
    await until(() => events.some((name) => name.includes("note.md")), "watcher event after promotion", 15000);
    assert.equal(readFileSync(join(env.root, "note.md"), "utf8"), "from phone");
  } finally { watcher?.close(); await env.cleanup(); }
});

// ── E14 ──────────────────────────────────────────────────────────────────────
test("F02-E14: a phone cannot answer the promotion, and the device projection carries no promotion or content", async () => {
  const env = await setup();
  try {
    const view = writeMission(env, "note.md", "from phone");
    await phoneApprove(env, view.id);
    const ask = await waitPromotion(env, view.id);
    const [record] = stagedFor(env, view.id);
    await assert.rejects(phoneRespond(env, ask.id, "allow_once"), /Windows Host|Approval required/);
    const snapshot = env.missions.snapshot();
    const projected = env.missions.remoteVerdicts(snapshot);
    const mission = projected.missions.find((item) => item.id === view.id)!;
    const shown = mission.requests.find((request) => request.id === ask.id)!;
    assert.equal((shown as Record<string, unknown>).promotion, undefined, "no promotion binding on the device");
    assert.equal(shown.reason, DEVICE_REVIEW_REASON, "device sees the generic review reason only");
    assert.equal(shown.remote?.answerable, false, "device cannot answer");
    const devicePayload = JSON.stringify(env.missions.deviceMissionData({ mission } as never));
    for (const secret of [record.id, record.contentHash, ask.promotion!.destination, "Destination"]) assert.ok(!devicePayload.includes(secret), `device view leaks ${secret}`);
    const remoteRows = JSON.stringify(projected.missions.map((item) => item.requests.map((request) => ({ ...request, promotion: undefined }))));
    assert.ok(!remoteRows.includes(record.contentHash), "remote verdict carries no digest");
  } finally { await env.cleanup(); }
});

// ── E15 ──────────────────────────────────────────────────────────────────────
test("F02-E15: content over 8192 bytes is promoted only after workstation inspection; devices cannot inspect", async () => {
  const env = await setup();
  try {
    const big = "x".repeat(9000);
    const view = writeMission(env, "big.md", big);
    await phoneApprove(env, view.id);
    const ask = await waitPromotion(env, view.id);
    const [record] = stagedFor(env, view.id);
    assert.equal(record.contentSize, 9000);
    await assert.rejects(env.missions.respond(ask.id, "allow_once", "workstation"), /inspect/i, "refused until inspected");
    assert.equal(existsSync(join(env.root, "big.md")), false);
    assert.ok(!env.missions.store.request(ask.id).resolvedAt, "the request stays open");
    await assert.rejects(missionCommand(env.missions, "mission.staging.inspect", { stagingId: record.id }, { local: false, actor: PHONE }), /Windows Host|workstation access/);
    assert.throws(() => env.missions.inspectStaged(record.id, PHONE), /Windows Host|workstation access/);
    const inspected = env.missions.inspectStaged(record.id, "workstation");
    assert.equal(inspected.bytes, 9000);
    assert.equal(inspected.content, JSON.stringify(big), "round 3: the full inspection is shown escaped like the preview (plain ASCII here, so only quoted)");
    await env.missions.respond(ask.id, "allow_once", "workstation");
    assert.equal(readFileSync(join(env.root, "big.md"), "utf8").length, 9000);
    assert.equal(env.missions.staging.get(record.id)!.promotionState, "PROMOTED");
  } finally { await env.cleanup(); }
});

// ── E16 host restart ─────────────────────────────────────────────────────────
test("F02-ST1: a Host restart invalidates a STAGED change (content kept), fails the step; Retry re-stages and promotion works once", async () => {
  const env = await setup();
  try {
    const view = writeMission(env, "note.md", "from phone");
    await phoneApprove(env, view.id);
    const ask = await waitPromotion(env, view.id);
    const [record] = stagedFor(env, view.id);
    await env.restart();
    const after = env.missions.staging.get(record.id)!;
    assert.equal(after.promotionState, "INVALIDATED_BY_HOST_RESTART");
    assert.equal(readFileSync(env.missions.staging.contentPath(record.id), "utf8"), "from phone", "content file kept for audit");
    assert.equal(existsSync(join(env.root, "note.md")), false);
    const step = stepsOf(env, view.id).find((item) => item.role === "Write")!;
    assert.equal(step.state, "failed");
    assert.equal(step.failure?.category, "host_restart");
    assert.ok(env.missions.store.request(ask.id).resolvedAt, "the old promotion request is closed");
    await assert.rejects(env.missions.respond(ask.id, "allow_once", "workstation"), /./, "the old request cannot promote");
    assert.equal(existsSync(join(env.root, "note.md")), false);
    // The restart ended the phone's epoch-bound authority: Retry cannot revive it (F01-8), so the workstation replans and the phone approves again.
    assert.throws(() => env.missions.retry(view.id, "workstation"), /expired or was revoked/);
    await env.missions.replan(view.id, "workstation", [writeStep("note.md", "from phone")]);
    await phoneApprove(env, view.id, true, env.missions.agenticPlanReference(view.id));
    const again = await waitPromotion(env, view.id);
    assert.notEqual(again.id, ask.id);
    const restaged = stagedFor(env, view.id).find((item) => item.promotionState === "STAGED")!;
    assert.notEqual(restaged.id, record.id);
    assert.equal(env.missions.staging.get(record.id)!.promotionState, "INVALIDATED_BY_HOST_RESTART", "the old change stays invalidated");
    await env.missions.respond(again.id, "allow_once", "workstation");
    await until(() => completed(env, view.id), "completed after retry");
    assert.equal(readFileSync(join(env.root, "note.md"), "utf8"), "from phone");
    await assert.rejects(env.missions.respond(again.id, "allow_once", "workstation"), /./, "promotion works once");
  } finally { await env.cleanup(); }
});

// ── E17 dedupe ───────────────────────────────────────────────────────────────
test("F02-ST2: a PROMOTED change plus Retry never writes or stages the same bytes twice", async () => {
  const env = await setup();
  try {
    const view = writeMission(env, "note.md", "from phone", { verification: [{ kind: "file_exists", path: "note.md", contains: "from phone" }, { kind: "file_exists", path: "marker.txt" }] });
    await phoneApprove(env, view.id);
    const ask = await waitPromotion(env, view.id);
    await env.missions.respond(ask.id, "allow_once", "workstation");
    await until(() => stepsOf(env, view.id).some((step) => step.state === "failed"), "verification failure after promotion");
    assert.equal(readFileSync(join(env.root, "note.md"), "utf8"), "from phone");
    assert.equal(stagedFor(env, view.id).length, 1);
    writeFileSync(join(env.root, "marker.txt"), "ok");
    env.missions.retry(view.id, "workstation");
    await until(() => completed(env, view.id), "completed by dedupe retry");
    assert.equal(stagedFor(env, view.id).length, 1, "no second staging");
    assert.equal(openRequests(env, view.id).filter((request) => request.promotion).length, 0, "no second promotion ask");
    assert.equal(stagedFor(env, view.id)[0].promotionState, "PROMOTED");
    assert.equal(readFileSync(join(env.root, "note.md"), "utf8"), "from phone");
  } finally { await env.cleanup(); }
});

// ── E18 Stop ─────────────────────────────────────────────────────────────────
test("F02-ST3: Stop withdraws a STAGED change; nothing reaches the project", async () => {
  const env = await setup();
  try {
    const view = writeMission(env, "note.md", "from phone");
    await phoneApprove(env, view.id);
    const ask = await waitPromotion(env, view.id);
    const [record] = stagedFor(env, view.id);
    await env.missions.stop(view.id, "workstation");
    assert.equal(env.missions.staging.get(record.id)!.promotionState, "WITHDRAWN");
    assert.ok(env.missions.store.request(ask.id).resolvedAt, "the promotion ask is closed");
    await assert.rejects(env.missions.respond(ask.id, "allow_once", "workstation"), /./);
    assert.equal(existsSync(join(env.root, "note.md")), false);
  } finally { await env.cleanup(); }
});

// ── E19 deny ─────────────────────────────────────────────────────────────────
test("F02-ST4: a workstation deny rejects the staged change and fails the step with permission_denied", async () => {
  const env = await setup();
  try {
    const view = writeMission(env, "note.md", "from phone");
    await phoneApprove(env, view.id);
    const ask = await waitPromotion(env, view.id);
    const [record] = stagedFor(env, view.id);
    await env.missions.respond(ask.id, "deny", "workstation");
    assert.equal(env.missions.staging.get(record.id)!.promotionState, "REJECTED");
    const step = stepsOf(env, view.id).find((item) => item.state === "failed")!;
    assert.equal(step.failure?.category, "permission_denied");
    assert.equal(existsSync(join(env.root, "note.md")), false);
  } finally { await env.cleanup(); }
});

// ── E45 ──────────────────────────────────────────────────────────────────────
test("F02-E45: a phone-written document cannot become execution input: the dependent terminal step never sees it and still needs the workstation", async () => {
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "Write then run", mode: "fast", origin: "workstation", steps: [
      writeStep("tool-input.md", "print the data"),
      { key: "run", role: "Run", objective: "run tool input", dependsOn: [0], executor: { kind: "capability", action: "terminal.exec", params: { command: "node", args: ["tool-input.md"] } }, verification: [], maxRetries: 0 },
    ] });
    await phoneApprove(env, view.id);
    const ask = await waitPromotion(env, view.id);
    assert.equal(existsSync(join(env.root, "tool-input.md")), false, "file absent in project while staged");
    assert.equal(openRequests(env, view.id).filter((request) => request.action === "terminal.exec").length, 0, "the run step has not started");
    await assert.rejects(phoneRespond(env, ask.id, "allow_once"), DESKTOP_ONLY);
    assert.equal(env.launched.length, 0);
    await env.missions.respond(ask.id, "allow_once", "workstation");
    const run = await waitAsk(env, view.id, "terminal.exec");
    assert.equal(run.desktopRequired, true, "running the promoted file is a workstation-only approval");
    await assert.rejects(phoneRespond(env, run.id, "allow_once"), DESKTOP_ONLY);
    assert.equal(existsSync(join(env.root, "tool-input.md")), true, "only the workstation promotion put it there");
  } finally { await env.cleanup(); }
});

async function waitAsk(env: Env, missionId: string, action: string) {
  await until(() => !!openRequests(env, missionId).find((request) => request.action === action), `${action} ask`);
  return openRequests(env, missionId).find((request) => request.action === action)!;
}

// ── E46 ──────────────────────────────────────────────────────────────────────
test("F02-E46: promotion is bound to the exact bytes: a tampered request contentHash is refused and nothing is written", async () => {
  const env = await setup();
  try {
    const view = writeMission(env, "note.md", "from phone");
    await phoneApprove(env, view.id);
    const ask = await waitPromotion(env, view.id);
    const [record] = stagedFor(env, view.id);
    env.missions.store.saveRequest({ ...env.missions.store.request(ask.id), promotion: { ...ask.promotion!, contentHash: "0".repeat(64) } } as PermissionRequest);
    await assert.rejects(env.missions.respond(ask.id, "allow_once", "workstation"), PROMOTE_REFUSED);
    assert.equal(env.missions.staging.get(record.id)!.promotionState, "FAILED");
    assert.equal(existsSync(join(env.root, "note.md")), false);
  } finally { await env.cleanup(); }
});

// ── E47 ──────────────────────────────────────────────────────────────────────
test("F02-E47: a phone code/config change needs the Windows Host; a workstation allow_once stages it, and the promotion still refuses a non-phone-safe destination", async () => {
  const env = await setup();
  try {
    const view = writeMission(env, "package.json", "{\"scripts\":{}}");
    await phoneApprove(env, view.id);
    const ask = await waitAsk(env, view.id, "filesystem.write");
    assert.equal(ask.desktopRequired, true);
    await assert.rejects(phoneRespond(env, ask.id, "allow_once"), DESKTOP_ONLY);
    assert.equal(existsSync(join(env.root, "package.json")), false);
    await env.missions.respond(ask.id, "allow_once", "workstation");
    const promotion = await waitPromotion(env, view.id);
    assert.equal(promotion.desktopRequired, true, "staged, then requires promotion");
    assert.equal(existsSync(join(env.root, "package.json")), false, "project untouched while staged");
    await assert.rejects(env.missions.respond(promotion.id, "allow_once", "workstation"), PROMOTE_REFUSED);
    assert.equal(stagedFor(env, view.id)[0].promotionState, "INVALIDATED_BY_SCOPE_CHANGE");
    assert.equal(existsSync(join(env.root, "package.json")), false, "a remote-envelope config destination is never promoted");
  } finally { await env.cleanup(); }
});

// ── E48 ──────────────────────────────────────────────────────────────────────
test("F02-E48: while a change is staged, Mission reads and lists of the private staging folder fail even when the workstation allows the ask", async () => {
  const env = await setup();
  try {
    const view = writeMission(env, "note.md", "from phone");
    await phoneApprove(env, view.id);
    const ask = await waitPromotion(env, view.id);
    const [record] = stagedFor(env, view.id);
    const probe = async (action: string, path: string) => {
      const reader = env.missions.create({ objective: `${action} ${path}`, mode: "fast", origin: "workstation", steps: [{ key: "probe", role: "Probe", objective: "probe", dependsOn: [], executor: { kind: "capability", action, params: { path } }, verification: [], maxRetries: 0 }] });
      await phoneApprove(env, reader.id);
      await until(() => openRequests(env, reader.id).some((request) => request.action === action), `${action} ask`);
      const ask = openRequests(env, reader.id).find((request) => request.action === action)!;
      // The read is outside the approved scope: a phone cannot widen it to the private staging folder.
      await assert.rejects(phoneRespond(env, ask.id, "allow_once"), /./, `${action}: phone answer refused`);
      await env.missions.respond(ask.id, "allow_once", "workstation");
      await until(() => stepsOf(env, reader.id).some((step) => step.state === "failed" || step.state === "completed"), `${action} outcome`);
      const step = stepsOf(env, reader.id)[0];
      assert.equal(step.state, "failed", `${action} ${path} must not succeed, even when the workstation allows the ask`);
      assert.ok(!JSON.stringify(step.result ?? {}).includes("from phone"), `${action} did not leak the staged bytes`);
    };
    await probe("filesystem.read", env.missions.staging.contentPath(record.id));
    await probe("filesystem.list", join(env.dir, "staging"));
    assert.equal(env.missions.staging.get(record.id)!.promotionState, "STAGED", "probes changed nothing");
    await env.missions.respond(ask.id, "deny", "workstation");
  } finally { await env.cleanup(); }
});

// ── E47c: promotion is a project mutation for trusted-desktop grants ─────────
test("F02-E47c: a promotion advances the Host mutation sequence, so a trusted-desktop grant approved before it is void", async () => {
  const env = await setup();
  try {
    const view = writeMission(env, "seq.md", "sequence");
    await phoneApprove(env, view.id);
    const ask = await waitPromotion(env, view.id);
    const before = env.missions.store.mutationSequence();
    await env.missions.respond(ask.id, "allow_once", "workstation");
    await until(() => completed(env, view.id), "promoted");
    assert.equal(env.missions.store.mutationSequence(), before + 1, "the promotion counts as one project mutation");
  } finally { await env.cleanup(); }
});

// ── E48 (broad root) ─────────────────────────────────────────────────────────
test("F02-E48b: with a project root that contains the Host data folder, no Mission reads Host database, credentials or staging", async () => {
  const env = await setup({ broadRoot: true });
  try {
    writeFileSync(join(env.dir, "credentials.json"), JSON.stringify({ token: "never-readable" }));
    for (const [path, approver] of [["host.sqlite", "phone"], ["credentials.json", "phone"], ["host.sqlite", "workstation"], ["credentials.json", "workstation"]] as const) {
      const view = env.missions.create({ objective: `read ${path}`, mode: "fast", origin: "workstation", steps: [{ key: "probe", role: "Probe", objective: "probe", dependsOn: [], executor: { kind: "capability", action: "filesystem.read", params: { path } }, verification: [], maxRetries: 0 }] });
      if (approver === "phone") await phoneApprove(env, view.id); else env.missions.approve(view.id, "workstation", true);
      await until(() => stepsOf(env, view.id).some((step) => ["failed", "completed"].includes(step.state)), `${path} outcome`);
      const step = stepsOf(env, view.id)[0];
      assert.equal(step.state, "failed", `${approver}-approved read of ${path} must fail`);
      assert.match(JSON.stringify(step.failure), /Private Host/, `${path}: refused as private Host state`);
      assert.ok(!JSON.stringify(env.missions.store.runs({ missionId: view.id, limit: 10 })).includes("never-readable"), "no secret in run records");
    }
  } finally { await env.cleanup(); }
});

// ── E20 classification matrix ────────────────────────────────────────────────
test("F02-ST5: classifyDeviceWrite matrix: documents and data are phone-safe; code, CI, agent, config, unknown and alias forms are not", () => {
  const base = mkdtempSync(join(tmpdir(), "bunny-f02-class-"));
  try {
    mkdirSync(join(base, "outside-target"));
    symlinkSync(join(base, "outside-target"), join(base, "jlink"), "junction");
    writeFileSync(join(base, "hard.md"), "h"); linkSync(join(base, "hard.md"), join(base, "outside-target", "hard-other.md"));
    const matrix: [string, string | undefined, string][] = [
      ["note.md", "# note", "PHONE_SAFE_DOCUMENT"],
      ["README.md", "# readme", "PHONE_SAFE_DOCUMENT"],
      ["notes/readme.txt", "plain", "PHONE_SAFE_DOCUMENT"],
      ["logs/out.log", "line", "PHONE_SAFE_DATA"],
      ["data/table.csv", "a,b", "PHONE_SAFE_DATA"],
      ["data/records.json", "{}", "PHONE_SAFE_DATA"],
      ["notes.txt", "import x from 'y'", "EXECUTION_RELEVANT"],
      ["a.txt", "#!/bin/sh\necho hi", "EXECUTION_RELEVANT"],
      ["run.ps1", "Get-Date", "EXECUTION_RELEVANT"],
      ["helper.mjs", "export {}", "EXECUTION_RELEVANT"],
      ["notes", "plain", "EXECUTION_RELEVANT"],
      ["page.mdx", "# page", "EXECUTION_RELEVANT"],
      [".github/workflows/ci.yml", "on: push", "EXECUTION_RELEVANT"],
      ["src/app.md", "# app", "EXECUTION_RELEVANT"],
      [".husky/pre-commit", "npm test", "EXECUTION_RELEVANT"],
      ["AGENTS.md", "# x", "AGENT_INSTRUCTIONS"],
      ["CLAUDE.md", "# x", "AGENT_INSTRUCTIONS"],
      [".claude/x.md", "# x", "AGENT_INSTRUCTIONS"],
      [".cursor/rules/a.mdc", "x", "AGENT_INSTRUCTIONS"],
      ["package.json", "{}", "CONFIGURATION"],
      ["x.json", "{}", "CONFIGURATION"],
      [".vscode/settings.json", "{}", "EXECUTION_RELEVANT"],
      ["config/app.yaml", "a: 1", "CONFIGURATION"],
      ["x.md:stream", "x", "UNKNOWN"],
      ["x.md.", "x", "UNKNOWN"],
      ["../x.md", "x", "UNKNOWN"],
      ["C:/elsewhere/x.md", "x", "UNKNOWN"],
      ["\\\\server\\share\\x.md", "x", "UNKNOWN"],
      ["jlink/x.md", "x", "UNKNOWN"],
      ["hard.md", "x", "UNKNOWN"],
    ];
    for (const [path, content, expected] of matrix) {
      const result = classifyDeviceWrite(path, { base, operation: "write", content: content ?? null });
      assert.equal(result.classification, expected, `${path}: ${result.reasons.at(-1)}`);
      assert.equal(deviceWriteClassRefusal(path, base, "write", content ?? null) === null, expected === "PHONE_SAFE_DOCUMENT" || expected === "PHONE_SAFE_DATA", `${path} refusal agrees with class`);
    }
    // Content decides as well as the name: a document that starts like a program is execution input.
    assert.equal(classifyDeviceWrite("doc.md", { base, operation: "write", content: "#!/usr/bin/env node" }).classification, "EXECUTION_RELEVANT");
  } finally { rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
});

// ── Independent review round 1 regressions (F02-R1-*) ────────────────────────
test("F02-R1-1: agent instruction names of more tools are AGENT_INSTRUCTIONS; 8.3 and invisible-character names fail closed", () => {
  const base = mkdtempSync(join(tmpdir(), "bunny-f02-r1-"));
  try {
    for (const name of ["CLAUDE.local.md", "AGENTS.override.md", "QWEN.md", "WARP.md", "agents.md", "Claude.MD"])
      assert.equal(classifyDeviceWrite(name, { base, operation: "write" }).classification, "AGENT_INSTRUCTIONS", name);
    for (const name of ["AGENTS~1.MD", "NOTES~2.TXT", "no\u202ete.md", "a\u200bb.md", "line\u2028break.md", "tab\u0009.md"])
      assert.equal(classifyDeviceWrite(name, { base, operation: "write" }).classification, "UNKNOWN", JSON.stringify(name));
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("F02-R1-3: a device write never stages into private Host state, even when the project root contains the Host data folder", async () => {
  const env = await setup({ broadRoot: true });
  try {
    const view = writeMission(env, "logs/injected.log", "forged host log line");
    await phoneApprove(env, view.id);
    await until(() => stepsOf(env, view.id).some((step) => step.state === "failed") || !!openRequests(env, view.id)[0], "outcome");
    await settle(100);
    assert.equal(stagedFor(env, view.id).length, 0, "nothing staged");
    assert.equal(promotionAsk(env, view.id), undefined, "no promotion offered");
    assert.equal(existsSync(join(env.dir, "logs", "injected.log")), false, "Host logs untouched");
  } finally { await env.cleanup(); }
});

test("F02-R1-4: only a step's own write executor can be staged; a write from a skill or a check is refused", async () => {
  const env = await setup();
  try {
    const view = env.missions.create({ objective: "read then check", mode: "fast", origin: "workstation", steps: [{ role: "Read", objective: "r", dependsOn: [], executor: { kind: "capability", action: "filesystem.list", params: { path: "." } }, verification: [], maxRetries: 0 }] });
    await phoneApprove(env, view.id, false);
    const mission = env.missions.mission(view.id);
    const step = stepsOf(env, view.id)[0];
    const envelope = env.missions.store.authorization(mission.authorizationId!)!;
    const result = env.missions.stageRemoteWrite({ action: "filesystem.write", params: { path: "x.md", content: "x" }, missionId: view.id, stepId: step.id, envelope, origin: "test", cwd: env.root, roots: [env.root] }, "run-r1-4");
    assert.ok(result && !result.ok, "refused, not staged");
    assert.match(result!.summary, /skill or check cannot be staged/);
    assert.equal(stagedFor(env, view.id).length, 0);
    assert.equal(existsSync(join(env.root, "x.md")), false);
  } finally { await env.cleanup(); }
});

test("F02-R1-5: a device one-time answer never outlives the Mission authorization it was given under", async () => {
  const env = await setup();
  try {
    env.missions.store.setGrant("filesystem.write", "global", "ask_every_time", "workstation");
    const view = writeMission(env, "late.md", "late");
    env.missions.approve(view.id, "workstation", true);
    await until(() => !!openRequests(env, view.id).find((request) => request.action === "filesystem.write"), "write ask");
    const ask = openRequests(env, view.id).find((request) => request.action === "filesystem.write")!;
    env.missions.missionPauseGate = () => true; // hold scheduling so the answer is provably unused
    await phoneRespond(env, ask.id, "allow_once");
    const mission = env.missions.mission(view.id);
    const envelope = env.missions.store.authorization(mission.authorizationId!)!;
    env.missions.store.saveAuthorization({ ...envelope, expiresAt: Date.now() - 1 });
    env.missions.missionPauseGate = null;
    const step = env.missions.store.step(ask.stepId);
    const live = env.missions.liveOnce(step);
    assert.equal(live.approvedOnce, null, "the expired envelope ends the device answer");
    assert.equal(env.missions.store.request(ask.id).lifecycle?.state, "EXPIRED");
    assert.equal(stagedFor(env, view.id).length, 0);
    assert.equal(existsSync(join(env.root, "late.md")), false);
  } finally { await env.cleanup(); }
});

test("F02-R1-6: the Host mutation sequence never decreases when a promotion fails after it started, and the destination is listed for review", async () => {
  const env = await setup();
  try {
    const view = writeMission(env, "fail.md", "will fail");
    await phoneApprove(env, view.id);
    await waitPromotion(env, view.id);
    const [record] = stagedFor(env, view.id);
    const before = env.missions.store.mutationSequence();
    const promoting = env.missions.staging.transition(record.id, ["STAGED"], "PROMOTING", "workstation", "test: promotion started")!;
    assert.equal(env.missions.store.mutationSequence(), before + 1);
    env.missions.promotionFailed(promoting, "test: failure after rename");
    assert.equal(env.missions.staging.get(record.id)!.promotionState, "FAILED");
    assert.equal(env.missions.store.mutationSequence(), before + 1, "a failed promotion still counts (monotonic)");
    assert.ok(env.missions.store.pendingRemoteChanges().some((change) => change.path === record.destination), "unreviewed change recorded for the code gates");
  } finally { await env.cleanup(); }
});

// ── Independent review round 2 regressions (F02-R2-*) ────────────────────────
test("F02-R2-1: every dot-folder inside the project (known agent tools and unknown ones) is never phone-safe", () => {
  const base = mkdtempSync(join(tmpdir(), "bunny-f02-r2-"));
  try {
    for (const path of [".augment/guidelines.md", ".trae/project_rules.md", ".qwen/commands/c.md", ".warp/notes.md", ".goose/x.md", ".some-new-tool/rules.md", "docs/.hidden/notes.md"])
      assert.ok(!["PHONE_SAFE_DOCUMENT", "PHONE_SAFE_DATA"].includes(classifyDeviceWrite(path, { base, operation: "write", content: "hello" }).classification), path);
    assert.equal(classifyDeviceWrite("docs/guide.md", { base, operation: "write", content: "hello" }).classification, "PHONE_SAFE_DOCUMENT", "ordinary documents stay phone-safe");
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("F02-R2-2: the review text shows every invisible, bidirectional, format and separator code point as an escape", () => {
  const hostile = "ok \u200e\u200f\u061c\u200b\ufeff\u2060\u202e\u2028\u{e0041} end";
  const shown = escapedText(Buffer.from(hostile, "utf8"));
  assert.ok(!/[\p{Cf}\p{Cc}\p{Zl}\p{Zp}]/u.test(shown), JSON.stringify(shown));
  for (const escape of ["200e", "200f", "061c", "200b", "feff", "2060", "202e", "2028", "{e0041}"]) assert.ok(shown.includes(`\\u${escape}`), escape);
});

test("F02-R2-3: a one-time answer behind a failed step always gets an end state (CONSUMED: it authorized the failed run)", async () => {
  const env = await setup();
  try {
    writeFileSync(join(env.root, "exists.md"), "already here");
    env.missions.store.setGrant("filesystem.write", "global", "ask_every_time", "workstation");
    const view = env.missions.create({ objective: "no overwrite", mode: "fast", origin: "workstation", steps: [writeStep("exists.md", "new", { executor: { kind: "capability", action: "filesystem.write", params: { path: "exists.md", content: "new" } } })] });
    env.missions.approve(view.id, "workstation", true);
    await until(() => !!openRequests(env, view.id).find((request) => request.action === "filesystem.write"), "write ask");
    const ask = openRequests(env, view.id).find((request) => request.action === "filesystem.write")!;
    await phoneRespond(env, ask.id, "allow_once");
    await until(() => stepsOf(env, view.id).some((step) => step.state === "failed"), "step fails (overwrite not requested)");
    assert.equal(env.missions.store.request(ask.id).lifecycle?.state, "CONSUMED", "round 3: the answer authorized an admitted run (which then failed), so its end state is CONSUMED, never left blank");
    assert.equal(readFileSync(join(env.root, "exists.md"), "utf8"), "already here");
  } finally { await env.cleanup(); }
});

test("F02-R2-4: on device revocation an unadmitted answer is INVALIDATED, an admitted one keeps CONSUMED, and neither authorizes anything further", async () => {
  const env = await setup();
  try {
    const view = writeMission(env, "admitted.md", "x");
    env.missions.approve(view.id, "workstation", false);
    const step = stepsOf(env, view.id)[0];
    const request: PermissionRequest = { id: "f02-r2-4-answer", missionId: view.id, stepId: step.id, action: "filesystem.write", risk: "WRITE", reason: "test", createdAt: Date.now(), resolvedAt: Date.now(), resolution: "allow_once", resolvedBy: PHONE, batchOffer: null };
    env.missions.store.saveRequest(request);
    env.missions.store.saveStep({ ...env.missions.store.step(step.id), state: "running", approvedOnce: { requestId: request.id, action: "filesystem.write" } });
    assert.equal(env.missions.endDeviceAnswers(PHONE, "revocation"), 1);
    assert.equal(env.missions.store.request(request.id).lifecycle?.state, "INVALIDATED_BY_DEVICE_REVOCATION", "round 3: this answer was never admitted (no run used it), so revocation invalidates it");
    assert.equal(env.missions.store.step(step.id).approvedOnce, null);
    assert.equal(env.missions.endDeviceAnswers(PHONE, "revocation"), 0, "idempotent");
    // An answer that already authorized an admitted run carries CONSUMED (stamped at admission); revocation keeps it.
    const admitted: PermissionRequest = { ...request, id: "f02-r2-4-admitted" };
    env.missions.store.saveRequest(admitted);
    env.missions.stampLifecycle(admitted.id, "CONSUMED", "bunny-host", "test: admitted");
    env.missions.store.saveStep({ ...env.missions.store.step(step.id), state: "running", approvedOnce: { requestId: admitted.id, action: "filesystem.write" } });
    assert.equal(env.missions.endDeviceAnswers(PHONE, "revocation"), 1);
    assert.equal(env.missions.store.request(admitted.id).lifecycle?.state, "CONSUMED");
    assert.equal(env.missions.store.step(step.id).approvedOnce, null);
  } finally { await env.cleanup(); }
});

test("F02-R2-5: answering a promotion whose staged change already ended closes the request and fails the step", async () => {
  const env = await setup();
  try {
    const view = writeMission(env, "ended.md", "x");
    await phoneApprove(env, view.id);
    const ask = await waitPromotion(env, view.id);
    const [record] = stagedFor(env, view.id);
    env.missions.staging.transition(record.id, ["STAGED"], "FAILED", "test", "simulated earlier failure");
    await assert.rejects(env.missions.respond(ask.id, "allow_once", "workstation"), /Promotion refused/);
    assert.ok(env.missions.store.request(ask.id).resolvedAt, "the request is closed");
    await until(() => stepsOf(env, view.id)[0].state === "failed", "step failed");
    assert.equal(existsSync(join(env.root, "ended.md")), false);
  } finally { await env.cleanup(); }
});

test("F02-R2-6: a promotion interrupted by a Host restart is reconciled from disk and, if it did not land, listed for review", async () => {
  const env = await setup();
  try {
    const view = writeMission(env, "crash.md", "x");
    await phoneApprove(env, view.id);
    await waitPromotion(env, view.id);
    const [record] = stagedFor(env, view.id);
    env.missions.staging.transition(record.id, ["STAGED"], "PROMOTING", "workstation", "simulated crash before rename");
    await env.restart();
    assert.equal(env.missions.staging.get(record.id)!.promotionState, "FAILED");
    assert.ok(env.missions.store.pendingRemoteChanges().some((change) => change.path === record.destination), "listed for review before any code runs");
    assert.equal(existsSync(join(env.root, "crash.md")), false);
  } finally { await env.cleanup(); }
});

// ── Independent review round 3 regressions (F02-R3-*) ────────────────────────
test("F02-R3-1: an 8.3 short-name directory never stands in for a script, agent or dot-folder; manifests match case-insensitively; MDX lines and invisible fillers fail closed", () => {
  const base = mkdtempSync(join(tmpdir(), "bunny-f02-r3-"));
  try {
    for (const dir of ["scripts", ".qwen", ".opencode", "src"]) mkdirSync(join(base, dir));
    for (const path of ["SCRIPT~1/run.md", "QWEN~1/c.md", "OPENCO~1/command/x.md", "NOTES~1/a.md"])
      assert.equal(classifyDeviceWrite(path, { base, operation: "write", content: "x" }).classification, "UNKNOWN", path);
    // Real aliases generated by this volume (when 8.3 names are enabled) are refused the same way.
    let listing = "";
    try { listing = execFileSync("cmd.exe", ["/c", "dir", "/x", "/a:d", base], { encoding: "utf8", windowsHide: true }); } catch { listing = ""; }
    for (const alias of listing.match(/[A-Z0-9]{1,6}~[0-9]/g) ?? [])
      assert.equal(classifyDeviceWrite(`${alias}/x.md`, { base, operation: "write", content: "x" }).classification, "UNKNOWN", alias);
    writeFileSync(join(base, "package.json"), JSON.stringify({ scripts: { sync: "node -e 0 data/config.json" } }));
    for (const path of ["data/config.json", "DATA/config.json", "Data/Config.JSON", "data\\config.json"])
      assert.equal(classifyDeviceWrite(path, { base, operation: "write", content: "{}" }).classification, "EXECUTION_RELEVANT", path);
    assert.equal(classifyDeviceWrite("docs/intro.md", { base, operation: "write", content: "# Intro\n\nexport const v = 1\n" }).classification, "EXECUTION_RELEVANT", "MDX export line");
    assert.equal(classifyDeviceWrite("docs/intro.md", { base, operation: "write", content: "# Intro\n\nimport goods and export services.\n" }).classification, "EXECUTION_RELEVANT", "conservative: any line starting with import/export");
    assert.equal(classifyDeviceWrite("docs/intro.md", { base, operation: "write", content: "# Intro\n\nWe import goods and export services.\n" }).classification, "PHONE_SAFE_DOCUMENT", "prose mentioning import/export mid-line stays a document");
    assert.equal(classifyDeviceWrite("docs/intro.md", { base, operation: "write", content: "# Intro\n\nPlain prose.\n" }).classification, "PHONE_SAFE_DOCUMENT");
    for (const path of ["notes/readmeU3164.md", "notes/aU034f.md", "notes/xU2800.md"])
      assert.equal(classifyDeviceWrite(path.replace(/U([0-9a-f]{4})/, (_, h) => String.fromCharCode(parseInt(h, 16))), { base, operation: "write", content: "x" }).classification, "UNKNOWN", path);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("F02-R3-2: a device one-time answer is CONSUMED when it authorizes the admitted run (and later clears never relabel it)", async () => {
  const env = await setup();
  try {
    env.missions.store.setGrant("filesystem.write", "global", "ask_every_time", "workstation");
    const view = writeMission(env, "used.md", "used");
    env.missions.approve(view.id, "workstation", true);
    await until(() => !!openRequests(env, view.id).find((request) => request.action === "filesystem.write"), "write ask");
    const ask = openRequests(env, view.id).find((request) => request.action === "filesystem.write")!;
    await phoneRespond(env, ask.id, "allow_once");
    const promotion = await waitPromotion(env, view.id);
    assert.equal(env.missions.store.request(ask.id).lifecycle?.state, "CONSUMED", "the answer authorized the admitted (staged) write");
    await env.missions.respond(promotion.id, "allow_once", "workstation");
    await until(() => completed(env, view.id), "completed");
    assert.equal(env.missions.store.request(ask.id).lifecycle?.state, "CONSUMED", "first stamp wins");
  } finally { await env.cleanup(); }
});

test("F02-R3-3: Retry of a Mission waiting for promotion withdraws the staged change and stages it again for a fresh review", async () => {
  const env = await setup();
  try {
    const view = writeMission(env, "again.md", "again");
    env.missions.approve(view.id, "workstation", false);
    await missionCommand(env.missions, "mission.start", { id: view.id }, { local: false, actor: PHONE });
    const first = await waitPromotion(env, view.id);
    const [record] = stagedFor(env, view.id);
    await until(() => env.missions.mission(view.id).state === "waiting_for_user", "waiting for the workstation");
    env.missions.retry(view.id, "workstation");
    assert.equal(env.missions.staging.get(record.id)!.promotionState, "WITHDRAWN");
    assert.ok(env.missions.store.request(first.id).resolvedAt, "old promotion request closed");
    const second = (await (async () => { await until(() => !!openRequests(env, view.id).find((request) => request.promotion && request.id !== first.id), "fresh promotion request"); return openRequests(env, view.id).find((request) => request.promotion && request.id !== first.id)!; })());
    assert.notEqual(second.promotion!.stagingId, record.id);
    await env.missions.respond(second.id, "allow_once", "workstation");
    await until(() => completed(env, view.id), "completed once");
    assert.equal(readFileSync(join(env.root, "again.md"), "utf8"), "again");
  } finally { await env.cleanup(); }
});

test("F02-R3-4: the full-content inspection is escaped like the preview", async () => {
  const env = await setup();
  try {
    const hostile = `${"a".repeat(9000)}RLO${String.fromCharCode(0x202e)}HIDDEN${String.fromCharCode(0x200b)}`;
    const view = writeMission(env, "big.md", hostile);
    await phoneApprove(env, view.id);
    await waitPromotion(env, view.id);
    const [record] = stagedFor(env, view.id);
    const inspected = env.missions.inspectStaged(record.id, "workstation");
    assert.ok(!/[\p{Cf}]/u.test(inspected.content), "no raw format characters");
    assert.ok(inspected.content.includes("\\u202e") && inspected.content.includes("\\u200b"));
    assert.equal(inspected.sha256, record.contentHash);
  } finally { await env.cleanup(); }
});

test("F02-R3-5: Stop ends an unused one-time answer with a WITHDRAWN end state", async () => {
  const env = await setup();
  try {
    env.missions.store.setGrant("filesystem.write", "global", "ask_every_time", "workstation");
    const view = writeMission(env, "stopped.md", "x");
    env.missions.approve(view.id, "workstation", true);
    await until(() => !!openRequests(env, view.id).find((request) => request.action === "filesystem.write"), "write ask");
    const ask = openRequests(env, view.id).find((request) => request.action === "filesystem.write")!;
    env.missions.missionPauseGate = () => true;
    await phoneRespond(env, ask.id, "allow_once");
    await env.missions.stop(view.id, "workstation");
    assert.equal(env.missions.store.request(ask.id).lifecycle?.state, "WITHDRAWN");
    assert.equal(existsSync(join(env.root, "stopped.md")), false);
  } finally { env.missions.missionPauseGate = null; await env.cleanup(); }
});

// ── Independent review round 4 regressions (F02-R4-*) ────────────────────────
test("F02-R4-1: files named by agent instructions, CI includes, nested manifests or root CI folders are never phone-safe; equivalent spellings match; oversize consumers fail closed", () => {
  const base = mkdtempSync(join(tmpdir(), "bunny-f02-r4-"));
  const big = mkdtempSync(join(tmpdir(), "bunny-f02-r4b-"));
  try {
    const kind = (path: string, root = base, content = "x") => classifyDeviceWrite(path, { base: root, operation: "write", content }).classification;
    writeFileSync(join(base, "CLAUDE.md"), "Follow @docs/rules.md and @./docs/style.md\n");
    writeFileSync(join(base, ".gitlab-ci.yml"), "include:\n  - local: docs/stages.yml\n");
    writeFileSync(join(base, "package.json"), JSON.stringify({ scripts: { a: "node tools/build.js --config docs/./cfg.json", b: "node tools/b.js docs//cfg2.json" } }));
    mkdirSync(join(base, "apps", "web"), { recursive: true });
    writeFileSync(join(base, "apps", "web", "package.json"), JSON.stringify({ scripts: { sync: "node sync.js data/sub.json" } }));
    mkdirSync(join(base, ".github", "scripts"), { recursive: true });
    writeFileSync(join(base, ".github", "scripts", "sync.sh"), "cat data/feed.csv | sh\n");
    assert.equal(kind("docs/rules.md"), "AGENT_INSTRUCTIONS", "CLAUDE.md @-import");
    assert.equal(kind("docs/style.md"), "AGENT_INSTRUCTIONS", "CLAUDE.md @./ import");
    assert.equal(kind("docs/stages.yml", base, "stages: [x]"), "EXECUTION_RELEVANT", "GitLab CI include");
    assert.equal(kind("docs/cfg.json", base, "{}"), "EXECUTION_RELEVANT", "./ spelling");
    assert.equal(kind("docs/cfg2.json", base, "{}"), "EXECUTION_RELEVANT", "// spelling");
    assert.equal(kind("apps/web/data/sub.json", base, "{}"), "EXECUTION_RELEVANT", "nested manifest, relative to its own folder");
    assert.equal(kind("data/feed.csv", base, "a,b"), "EXECUTION_RELEVANT", "root CI folder script");
    assert.equal(kind("docs/free.md"), "PHONE_SAFE_DOCUMENT", "unreferenced document stays phone-safe");
    assert.equal(kind("data/table.csv", base, "a,b"), "PHONE_SAFE_DATA", "unreferenced data stays phone-safe");
    writeFileSync(join(big, "package.json"), JSON.stringify({ pad: "x".repeat(1100 * 1024), scripts: { a: "node x.js docs/bigcfg.json" } }));
    assert.equal(kind("docs/bigcfg.json", big, "{}"), "UNKNOWN", "an oversize consumer fails closed");
    assert.equal(kind("docs/other.md", big), "UNKNOWN", "nothing is phone-safe while a consumer cannot be checked");
  } finally { rmSync(base, { recursive: true, force: true }); rmSync(big, { recursive: true, force: true }); }
});

test("F02-R4-2: site-generator and config-named data, requirements-style names, installer directives, ESM without spaces and variation selectors are never phone-safe", () => {
  const base = mkdtempSync(join(tmpdir(), "bunny-f02-r4c-"));
  try {
    const kind = (path: string, content = "x") => classifyDeviceWrite(path, { base, operation: "write", content }).classification;
    assert.equal(kind("docs/_config.yml", "plugins_dir: ../scripts"), "CONFIGURATION");
    assert.equal(kind("docs/_posts/a.md", "# post"), "CONFIGURATION");
    assert.equal(kind("data/pipeline.yaml", "a: 1"), "CONFIGURATION");
    assert.equal(kind("dev-requirements.txt", "requests"), "CONFIGURATION");
    assert.equal(kind("requirements/base.txt", "requests"), "CONFIGURATION");
    assert.equal(kind("notes/tools.txt", "-e ./tools\n"), "EXECUTION_RELEVANT");
    assert.equal(kind("notes/index.txt", "--index-url https://example.invalid/simple\n"), "EXECUTION_RELEVANT");
    assert.equal(kind("docs/a.md", 'import{x}from"./y"\n# t'), "EXECUTION_RELEVANT");
    assert.equal(kind("docs/b.md", 'export*from"./z"\n# t'), "EXECUTION_RELEVANT");
    assert.equal(kind("docs/c.md", "Important: read this first.\n"), "PHONE_SAFE_DOCUMENT", "prose that merely starts with the letters of a keyword");
    assert.equal(kind(`docs/notes${String.fromCharCode(0xfe0f)}.md`), "UNKNOWN", "variation selector in the name");
    assert.equal(kind(`docs/n${String.fromCodePoint(0xe0100)}.md`), "UNKNOWN", "supplementary variation selector");
    const shown = escapedText(Buffer.from(`a${String.fromCharCode(0xfe0f)}b${String.fromCodePoint(0xe0100)}`, "utf8"));
    assert.ok(shown.includes("\\ufe0f") && shown.includes("\\u{e0100}"), shown);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("F02-R4-3: a Retry refused at the attempt ceiling changes nothing: the staged change and its promotion request stay", async () => {
  const env = await setup();
  try {
    const view = writeMission(env, "ceiling.md", "ceiling");
    env.missions.approve(view.id, "workstation", false);
    await missionCommand(env.missions, "mission.start", { id: view.id }, { local: false, actor: PHONE });
    const promotion = await waitPromotion(env, view.id);
    const [record] = stagedFor(env, view.id);
    await until(() => env.missions.mission(view.id).state === "waiting_for_user", "waiting for the workstation");
    const step = stepsOf(env, view.id)[0];
    env.missions.store.saveStep({ ...step, attempts: [...step.attempts, ...step.attempts] });
    assert.throws(() => env.missions.retry(view.id, "workstation"), /attempt ceiling/);
    assert.equal(env.missions.staging.get(record.id)!.promotionState, "STAGED", "the staged change survives a refused Retry");
    assert.equal(env.missions.store.request(promotion.id).resolvedAt ?? null, null, "the promotion request stays open");
    assert.equal(stepsOf(env, view.id)[0].state, "waiting_for_approval");
    await env.missions.respond(promotion.id, "allow_once", "workstation");
    await until(() => completed(env, view.id), "still promotable");
    assert.equal(readFileSync(join(env.root, "ceiling.md"), "utf8"), "ceiling");
  } finally { await env.cleanup(); }
});

test("F02-R4-4: a consumed one-time answer never re-arms a skill run", async () => {
  const env = await setup();
  try {
    const skill = { ...structuredClone(BUILTIN_SKILLS[0]), id: "test.r4-write", name: "R4 write", requirements: ["filesystem.write"], preconditions: [],
      steps: [{ action: "filesystem.write", label: "write a", params: { path: "a.txt", content: "A" } }],
      validations: [{ kind: "status_succeeded" as const, step: 0 }], cleanup: [] };
    env.missions.store.saveSkill(skill, true);
    const withoutWrite = (missionId: string) => {
      const envelope = env.missions.store.authorization(env.missions.mission(missionId).authorizationId!)!;
      env.missions.store.saveAuthorization({ ...envelope, capabilities: envelope.capabilities.filter((action) => action !== "filesystem.write") });
    };
    const first = env.missions.create({ objective: "Skill", mode: "fast", origin: "workstation", steps: [{ role: "Skill", objective: "write", executor: { kind: "skill", skillId: skill.id, params: {} } }] });
    env.missions.approve(first.id, "workstation", false);
    withoutWrite(first.id);
    env.missions.start(env.missions.mission(first.id));
    await until(() => openRequests(env, first.id).length === 1, "skill permission");
    const answer = openRequests(env, first.id)[0];
    await env.missions.respond(answer.id, "allow_once", "workstation");
    await until(() => completed(env, first.id), "first run completes");
    assert.equal(env.missions.store.request(answer.id).lifecycle?.state, "CONSUMED");
    rmSync(join(env.root, "a.txt"));
    // A step that still points at the consumed answer (the allow_batch re-run shape) must ask again, not write.
    const second = env.missions.create({ objective: "Skill again", mode: "fast", origin: "workstation", steps: [{ role: "Skill", objective: "write", executor: { kind: "skill", skillId: skill.id, params: {} } }] });
    env.missions.approve(second.id, "workstation", false);
    withoutWrite(second.id);
    const step = stepsOf(env, second.id)[0];
    env.missions.store.saveStep({ ...step, approvedOnce: { requestId: answer.id, action: "filesystem.write" } });
    env.missions.start(env.missions.mission(second.id));
    await until(() => openRequests(env, second.id).length === 1, "asks again");
    assert.equal(existsSync(join(env.root, "a.txt")), false, "the consumed answer authorized nothing");
    assert.equal(stepsOf(env, second.id)[0].approvedOnce?.requestId === answer.id, false);
  } finally { await env.cleanup(); }
});

test("F02-R4-5: Stop ends a failed step's unused one-time answer (WITHDRAWN)", async () => {
  const env = await setup();
  try {
    const view = writeMission(env, "failed.md", "x");
    env.missions.approve(view.id, "workstation", false);
    await missionCommand(env.missions, "mission.start", { id: view.id }, { local: false, actor: PHONE });
    const promotion = await waitPromotion(env, view.id);
    await env.missions.respond(promotion.id, "deny", "workstation");
    await until(() => stepsOf(env, view.id)[0].state === "failed", "step failed");
    const ask = env.missions.store.requests(view.id).find((request) => request.action === "filesystem.write" && !request.promotion);
    const step = stepsOf(env, view.id)[0];
    const fake = ask ?? promotion;
    env.missions.store.saveRequest({ ...env.missions.store.request(fake.id), lifecycle: undefined });
    env.missions.store.saveStep({ ...step, approvedOnce: { requestId: fake.id, action: "filesystem.write" } });
    await env.missions.stop(view.id, "workstation");
    assert.equal(stepsOf(env, view.id)[0].approvedOnce, null);
    assert.equal(env.missions.store.request(fake.id).lifecycle?.state, "WITHDRAWN");
  } finally { await env.cleanup(); }
});

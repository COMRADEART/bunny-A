// MA5-S2 Phase 1A: drives the real Host contract the Windows "New connected task" flow uses, on a disposable Host
// (Ollama adapter only, temp state, temp registered folder). Never the owner's Host.
// Usage: node --experimental-strip-types scripts/ma5-s2/connected-task-contract.mjs [out.json]
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost } from "../../src/lib/bunny-host/http.server.ts";
import { defaultAdapters } from "../../src/lib/bunny-host/adapters.server.ts";
import { writeEvidence } from "../evidence-guard.mjs";

const out = process.argv[2] ?? "docs/ma5-s2/evidence/connected-task-contract.json";
// Host state must be outside Git (%TEMP%); the registered folder must not be an application folder (AppData), so it
// lives in this checkout's ignored test-results/. Both are deleted afterwards.
const temp = mkdtempSync(join(tmpdir(), "bunny-ma5s2-contract-"));
mkdirSync("test-results/ma5-s2", { recursive: true });
const folder = mkdtempSync(join(process.cwd(), "test-results", "ma5-s2", "notes-"));
writeFileSync(join(folder, "notes.txt"), "Release checklist: the installer is signed, the Android build is reproducible, and voice qualification is blocked until a real microphone test runs.\n");
const host = await startHost({ dataDirectory: join(temp, "host"), root: join(temp, "host"), port: Number(process.env.BUNNY_CONTRACT_PORT ?? 43411), adapters: defaultAdapters().filter((a) => a.id === "ollama") });
const base = `http://127.0.0.1:${host.port ?? Number(process.env.BUNNY_CONTRACT_PORT ?? 43411)}`;
const headers = { authorization: `Bearer ${host.token}`, "content-type": "application/json", connection: "close" };
const state = async () => (await fetch(`${base}/state`, { headers })).json();
const identity = (await state()).hostIdentity;
// The same envelope the Windows client sends: new operationId, expect{hostId,epoch}, never retried.
const command = async (action, data) => {
  const r = await fetch(`${base}/command`, { method: "POST", headers, body: JSON.stringify({ action, data, operationId: crypto.randomUUID(), expect: { hostId: identity.hostId, epoch: identity.epoch } }) });
  const body = await r.json();
  return { status: r.status, ok: r.ok, body };
};
const scrub = (value) => JSON.parse(JSON.stringify(value).split(JSON.stringify(folder).slice(1, -1)).join("<registered-folder>").split(JSON.stringify(temp).slice(1, -1)).join("<temp>"));
const steps = [];
// The snapshot rides on every answer; only the command's own data, refusal and ledger state are evidence.
const record = (name, result, note) => { const { snapshot: _s, ...body } = result.body ?? {}; steps.push(scrub({ name, status: result.status, ok: result.ok, note, body })); return result; };

try {
  const s = await state();
  const ollama = (s.providers ?? []).find((p) => p.id === "ollama");
  const remote = new Set(ollama?.remoteModels ?? []);
  const model = process.env.BUNNY_CONTRACT_MODEL ?? (ollama?.models ?? []).find((m) => !remote.has(m) && !m.endsWith(":cloud"));
  if (!model) throw new Error("No local Ollama model is installed; the Planner needs one.");
  const envelope = (models, files) => ({
    capabilities: ["file.read", "local.generate"], providers: ["ollama"], localOnly: true, models, projectScopes: ["personal"],
    sideEffects: false, background: false, budgets: { maxModelCalls: 10, maxWallMs: 3_600_000 }, expiresAt: Date.now() + 86_400_000,
    grants: { files, origins: [], services: [] },
  });
  const request = "Read notes.txt and summarize it in two sentences.";

  record("connector.roots.list (empty)", await command("connector.roots.list", {}));
  record("connector.roots.set refuses a system folder", await command("connector.roots.set", { roots: [{ id: "sys", label: "System", path: process.env.SystemRoot ?? "C:\\Windows" }] }), "expected refusal");
  record("connector.roots.set", await command("connector.roots.set", { roots: [{ id: "notes", label: "Notes", path: folder }] }));
  record("ptask.plan refuses a model not pinned in the envelope", await command("ptask.plan", { request, projectId: "personal", model, envelope: envelope(["not-pinned:1b"], [{ root: "notes", access: "read" }]) }), "expected refusal");
  record("ptask.plan refuses a cloud provider envelope", await command("ptask.plan", { request, projectId: "personal", model, envelope: { ...envelope([model], [{ root: "notes", access: "read" }]), providers: ["openai"], localOnly: false } }), "expected refusal");

  const env = envelope([model], [{ root: "notes", access: "read" }]);
  const t0 = Date.now();
  const plan = record("ptask.plan", await command("ptask.plan", { request, projectId: "personal", model, envelope: env }), `model ${model}`);
  const planMs = Date.now() - t0;
  const proposal = plan.body?.data;
  const spec = proposal?.spec ?? null;

  let created = null, final = null;
  if (spec) {
    // Tampering after review: an extra step outside the envelope's capabilities must be refused at create.
    const tampered = { ...spec, steps: [...spec.steps, { id: "extra", kind: "file.write", input: { root: "notes", path: "x.txt", content: "x" }, model: null }] };
    record("ptask.create refuses a spec widened after review", await command("ptask.create", { spec: tampered, envelope: env }), "expected refusal");
    const c = record("ptask.create", await command("ptask.create", { spec, envelope: env }));
    created = c.body?.data ?? null;
    if (created?.id && created.state === "AWAITING_APPROVAL") record("ptask.approve", await command("ptask.approve", { id: created.id, version: created.version }));
    const deadline = Date.now() + 240_000;
    while (created?.id && Date.now() < deadline) {
      const g = await command("ptask.get", { id: created.id });
      final = g.body?.data ?? null;
      if (["COMPLETED", "FAILED", "CANCELLED", "NEEDS_RECONCILIATION", "BLOCKED"].includes(final?.state)) break;
      await new Promise((r) => setTimeout(r, 2_000));
    }
    if (final) steps.push(scrub({ name: "ptask.get (final)", ok: true, body: final }));
  }
  writeEvidence(out, { schema: "ma5-s2.connected-task-contract.v1", at: new Date().toISOString(), host: "disposable, Ollama adapter only", model, planMs, finalState: final?.state ?? null, steps });
  console.log(JSON.stringify({ out, model, planMs, planOk: proposal?.ok ?? null, finalState: final?.state ?? null, results: steps.map((x) => `${x.name}: ${x.status ?? ""} ${x.ok}`) }, null, 1));
} finally {
  await host.close();
  rmSync(temp, { recursive: true, force: true });
  rmSync(folder, { recursive: true, force: true });
}

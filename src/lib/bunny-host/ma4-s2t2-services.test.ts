// MA4-S2-T2 service adapter contracts against the recorded synthetic workspace (no live provider exists).
import test from "node:test";
import assert from "node:assert/strict";
import { create, fakeModel, result, rig, SECRET_TOKEN, workspace, WS } from "./ma4-s2t2-fixtures.ts";
import { SimulatedCrash } from "./ma4/task-runtime.server.ts";
import type { TaskView } from "./ma4/task-runtime.ts";

const ME = "me@example.test";
const mail = (access: string, recipients: string[] = []) => ({ services: [{ connector: "email", account: ME, access, recipients }] });
const refused = (fn: () => unknown, pattern: RegExp) => assert.throws(fn, (e: Error) => pattern.test(e.message), String(pattern));

test("T2-S1 email: read the inbox, draft a reply idempotently; recipients outside the grant are refused before anything runs", async () => {
  const w = workspace();
  const r = await rig({ services: w, model: fakeModel({ Worker: "We are on track; two issues open." }) });
  try {
    refused(() => create(r, [{ id: "d", kind: "email.draft", input: { account: ME, to: "boss@example.test", subject: "Hi", body: "x" } }], mail("draft", ["lead@example.test"]), { sideEffects: true }), /Recipients not granted: boss@example.test/);
    refused(() => create(r, [{ id: "d", kind: "email.draft", input: { account: ME, to: "lead@example.test", subject: "Hi", body: "x" } }], mail("read", ["lead@example.test"]), { sideEffects: true }), /allows read, not draft/);
    refused(() => create(r, [{ id: "d", kind: "email.list", input: { account: "other@example.test" } }], { services: [{ connector: "email", account: "other@example.test", access: "read" }] }), /No email account "other@example.test" is connected/);
    refused(() => create(r, [{ id: "d", kind: "email.draft", input: { account: ME, to: "not an address", subject: "Hi", body: "x" } }], mail("draft", ["lead@example.test"]), { sideEffects: true }), /plain email addresses/);
    const t = create(r, [{ id: "ls", kind: "email.list", input: { account: ME } }, { id: "rd", kind: "email.read", input: { account: ME, messageId: "m1" } },
      { id: "gen", kind: "local.generate", input: { prompt: "Draft a reply.", contextFrom: "rd" } }, { id: "draft", kind: "email.draft", input: { account: ME, to: "Lead@Example.test", subject: "Re: Status?", bodyFrom: "gen" } }],
    mail("draft", ["lead@example.test"]), { sideEffects: true });
    const v = await r.run(t.id);
    assert.equal(v.state, "COMPLETED", JSON.stringify(v.failure));
    assert.equal(result(r, t.id, "ls").messages[0].subject, "Status?");
    const d = result(r, t.id, "draft");
    assert.equal(d.sent, false); assert.deepEqual(d.to, ["lead@example.test"]);
    assert.equal(w.drafts.length, 1); assert.equal(w.sent.length, 0, "a draft never sends");
    assert.equal(w.drafts[0].body, "We are on track; two issues open.");
  } finally { await r.close(); }
});

test("T2-S2 sending waits for permission bound to recipients, subject and body; a crash after the send never sends twice", async () => {
  let armed = false;
  const w = workspace();
  const r = await rig({ services: w, model: fakeModel({ Worker: "Status: green." }), faults: (p) => { if (armed && p === "after-effect") { armed = false; throw new SimulatedCrash(p); } } });
  try {
    const t = create(r, [{ id: "gen", kind: "local.generate", input: { prompt: "status" } }, { id: "send", kind: "email.send", input: { account: ME, to: "lead@example.test, pm@example.test", subject: "Status", bodyFrom: "gen" } }],
      mail("send", ["lead@example.test", "pm@example.test"]), { sideEffects: true });
    const waiting = await r.run(t.id);
    assert.equal(waiting.state, "AWAITING_APPROVAL"); assert.equal(waiting.pendingAction!.reversible, false);
    const p = r.rt.pendingAction(t.id, WS)!;
    assert.match(p.preview, /^To: lead@example.test, pm@example.test\nSubject: Status\n\nStatus: green\.$/);
    assert.deepEqual(p.changes, ["To: lead@example.test", "To: pm@example.test"]);
    assert.ok(p.effects.some(e => /cannot be unsent/.test(e)));
    assert.equal(w.sent.length, 0);
    armed = true;
    r.rt.approveAction(t.id, p.actionId, p.payloadSha256, WS);
    await r.rt.idle();
    assert.equal(armed, false, "the Host died right after the provider accepted the send");
    assert.equal(w.sent.length, 1);
    await r.restart();
    r.rt.resume(t.id, WS);
    const v = await r.run(t.id);
    assert.equal(v.state, "COMPLETED", JSON.stringify(v.failure));
    assert.equal(w.sent.length, 1, "recovery found the message by its key instead of sending again");
    assert.ok(r.connected.ledger.list(t.id).some(x => x.event === "verified_applied"));
    assert.equal(result(r, t.id, "send").messageId, w.sent[0].messageId);
  } finally { await r.close(); }
});

test("T2-S3 a calendar invite interrupted after the provider accepted it becomes UNCERTAIN and is never re-sent without the owner", async () => {
  let armed = false;
  const w = workspace();
  const r = await rig({ services: w, faults: (p) => { if (armed && p === "after-effect") { armed = false; throw new SimulatedCrash(p); } } });
  try {
    const start = Date.UTC(2026, 10, 2, 15), event = { account: ME, title: "Review", start, end: start + 3_600_000, attendees: "lead@example.test" };
    const cal = { services: [{ connector: "calendar", account: ME, access: "write", recipients: ["lead@example.test"] }] };
    const t = create(r, [{ id: "free", kind: "calendar.availability", input: { account: ME, from: start - 3_600_000, to: start + 7_200_000 } }, { id: "prop", kind: "calendar.propose", input: event }, { id: "make", kind: "calendar.create", input: event }], cal, { sideEffects: true });
    await r.run(t.id);
    assert.equal(result(r, t.id, "prop").created, false);
    const p = r.rt.pendingAction(t.id, WS)!;
    assert.ok(p.effects.some(e => /notified immediately/.test(e)));
    armed = true;
    r.rt.approveAction(t.id, p.actionId, p.payloadSha256, WS);
    await r.rt.idle();
    await r.restart();
    const v = r.rt.view(t.id) as TaskView;
    assert.equal(v.state, "UNCERTAIN"); assert.equal(v.activity, "Uncertain");
    r.rt.wake(); await r.rt.idle();
    assert.equal(w.invites.length, 1, "nothing replayed while uncertain");
    // The owner says it did NOT happen: one fresh attempt, which needs a fresh approval (the old one is gone).
    r.rt.reconcile(t.id, "not_happened", WS);
    const again = await r.run(t.id);
    assert.equal(again.state, "AWAITING_APPROVAL");
    assert.equal(w.invites.length, 1);
    const p2 = r.rt.pendingAction(t.id, WS)!;
    assert.notEqual(p2.actionId, p.actionId);
    r.rt.denyAction(t.id, p2.actionId, WS);
    assert.equal(w.invites.length, 1);
  } finally { await r.close(); }
});

test("T2-S4 'happened' records the owner's word and sends nothing; credentials never leave the provider", async () => {
  let armed = false;
  const w = workspace();
  const r = await rig({ services: w, faults: (p) => { if (armed && p === "after-effect") { armed = false; throw new SimulatedCrash(p); } } });
  try {
    const start = Date.UTC(2026, 10, 3, 9), event = { account: ME, title: "Sync", start, end: start + 1_800_000, attendees: "lead@example.test" };
    const t = create(r, [{ id: "make", kind: "calendar.create", input: event }], { services: [{ connector: "calendar", account: ME, access: "write", recipients: ["lead@example.test"] }] }, { sideEffects: true });
    await r.run(t.id);
    const p = r.rt.pendingAction(t.id, WS)!;
    armed = true; r.rt.approveAction(t.id, p.actionId, p.payloadSha256, WS); await r.rt.idle(); await r.restart();
    r.rt.reconcile(t.id, "happened", WS);
    assert.equal((await r.run(t.id)).state, "COMPLETED");
    assert.equal(w.invites.length, 1);
    const everything = JSON.stringify(r.db.db.prepare("SELECT * FROM ma4_tasks").all()) + JSON.stringify(r.db.db.prepare("SELECT * FROM ma4_action_receipts").all()) + JSON.stringify(r.db.db.prepare("SELECT * FROM ma4_task_outputs").all()) + JSON.stringify(r.db.db.prepare("SELECT * FROM ma4_task_checkpoints").all());
    assert.equal(everything.includes(SECRET_TOKEN), false, "the delegated token is in no task row, receipt, output or checkpoint");
    // Without a credential the provider refuses before any effect: a definite failure, not an uncertain one.
    const nocred = workspace(); (nocred as unknown as { vault: unknown }).vault = { token: () => null };
    const r2 = await rig({ services: nocred });
    try {
      const t2 = create(r2, [{ id: "ls", kind: "email.list", input: { account: ME } }], mail("read"));
      const v2 = await r2.run(t2.id);
      assert.equal(v2.state, "FAILED"); assert.match(v2.failure!.detail, /No delegated credential/);
    } finally { await r2.close(); }
  } finally { await r.close(); }
});

test("T2-S5 a document write is conditional on the version that was read; a stale version is refused at preview", async () => {
  const w = workspace();
  const r = await rig({ services: w, model: fakeModel({ Worker: "New plan." }) });
  try {
    const docs = { services: [{ connector: "docs", account: ME, access: "write" }] };
    const t = create(r, [{ id: "rd", kind: "docs.read", input: { account: ME, docId: "d1" } }, { id: "gen", kind: "local.generate", input: { prompt: "rewrite", contextFrom: "rd" } }, { id: "wr", kind: "docs.write", input: { account: ME, docId: "d1", contentFrom: "gen", expectedVersion: "v1" } }], docs, { sideEffects: true });
    await r.run(t.id);
    const p = r.rt.pendingAction(t.id, WS)!;
    w.docsStore.set("d1", { ...w.docsStore.get("d1")!, version: "v2", content: "Edited elsewhere." });
    r.rt.approveAction(t.id, p.actionId, p.payloadSha256, WS);
    const v = await r.run(t.id);
    assert.equal(v.state, "FAILED"); assert.match(v.failure!.detail, /changed since it was read/);
    assert.equal(w.docsStore.get("d1")!.content, "Edited elsewhere.", "the newer version was kept");
    assert.equal(w.calls.filter(c => c.op === "docs.write").length, 0, "no write was attempted");
  } finally { await r.close(); }
});

test("T2-S6 without a supplied provider no service action exists: the step is refused at validation", async () => {
  const r = await rig();
  try {
    refused(() => create(r, [{ id: "s", kind: "email.send", input: { account: ME, to: "a@example.test", subject: "x", body: "y" } }], mail("send", ["a@example.test"]), { sideEffects: true }), /No registered executor for email.send/);
    assert.equal(r.connected.catalog.some(c => c.kind.startsWith("email.")), false, "the Planner is never offered an unconnected provider");
  } finally { await r.close(); }
});

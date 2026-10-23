// MA4-S1R4-G7C: the experiment-only Groq client never exceeds the owner's caps, never sends forbidden data, stops the
// run on quota/payment/credential responses or an invalid approval, and revocation closes access. Offline (fake fetch).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CAPS, MODEL, StopRun, approvalBlock, createCloud, openStore, revoke } from "../../../scripts/ma4-s1r4/g7c-cloud.mjs";

const ok = () => new Response(JSON.stringify({ model: MODEL, choices: [{ message: { content: "```python\npass\n```" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
const setup = (respond: () => Response = ok, approved = () => null as string | null) => {
  const sent: string[] = [];
  const cloud = createCloud({ key: "gsk_test", forbidden: ["HIDDEN-TEST-BODY", "REFERENCE-SOLUTION"], approved, sleep: async () => {},
    fetcher: async (_u: string, init: RequestInit) => { sent.push(String(init.body)); return respond(); } });
  const ask = (prompt = "Implement parse_duration.") => cloud.call({ role: "Worker", prompt, schema: null, signal: new AbortController().signal, attempt: 1 });
  return { cloud, sent, ask };
};

test("per-trial cap refuses the call over the cap without sending it; total cap stops the run", async () => {
  assert.deepEqual({ ...CAPS }, { total: 24, perTrial: 8 }); // owner-approved G7C-2 caps; changing them needs a new approval
  const { cloud, sent, ask } = setup();
  for (let t = 1; t <= 3; t++) {
    cloud.setTrial(`v2#${t}`);
    for (let i = 0; i < CAPS.perTrial; i++) assert.equal((await ask()).ok, true);
    const refused = await ask();
    assert.equal(refused.ok, false);
    assert.match(String(refused.error), /budget exhausted/);
  }
  assert.equal(sent.length, CAPS.total);
  cloud.setTrial("v2#4");
  await assert.rejects(ask(), StopRun);
  assert.equal(sent.length, CAPS.total);
});

test("hidden tests, references and host paths are refused before sending", async () => {
  const { sent, ask } = setup();
  for (const prompt of ["spec\nHIDDEN-TEST-BODY", "REFERENCE-SOLUTION", "see C:\\Users\\owner\\x", "import test_hidden"]) await assert.rejects(ask(prompt), StopRun);
  assert.equal(sent.length, 0);
});

test("429, 402 and 401 stop the run; an invalid approval stops before sending", async () => {
  for (const status of [429, 402, 401]) await assert.rejects(setup(() => new Response("{}", { status })).ask(), StopRun);
  const blocked = setup(ok, () => "External model approval was revoked.");
  await assert.rejects(blocked.ask(), StopRun);
  assert.equal(blocked.sent.length, 0);
});

test("only a workstation-issued approval opens access, and revoke closes it", () => {
  const dir = mkdtempSync(join(tmpdir(), "g7c-"));
  try {
    const opened = openStore(join(dir, "g7c.sqlite"));
    assert.match(approvalBlock(opened.store) ?? "", /owner-issued approval/);
    assert.throws(() => opened.store.issueApproval({ provider_id: "groq", model_id: MODEL, approval_status: "approved", approved_purpose: ["coding"], data_categories: ["synthetic"], spending_limit_usd: 0, expiry: new Date(Date.now() + 86_400_000).toISOString() }, "agent"));
    opened.store.issueApproval({ provider_id: "groq", model_id: MODEL, approval_status: "approved", approved_purpose: ["coding", "debugging"], data_categories: ["synthetic"], spending_limit_usd: 0, expiry: new Date(Date.now() + 86_400_000).toISOString() }, "workstation");
    assert.equal(approvalBlock(opened.store), null);
    revoke(opened);
    assert.match(approvalBlock(opened.store) ?? "", /revoked/);
    opened.db.db.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

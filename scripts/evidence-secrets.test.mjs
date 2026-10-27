import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { assertNoSecrets, findSecretText } from "./evidence-guard.mjs";

// Fixture credentials are built at runtime so this file never matches its own scan.
const fakeToken = ["Zm9vYmFy", "c2VjcmV0", "dG9rZW4x", "MjM0NTY3"].join("");

test("evidence guard refuses Authorization headers, tokens and API keys", () => {
  assert.throws(() => assertNoSecrets({ seen: { authHeader: `Bearer ${fakeToken}` } }), /\$\.seen\.authHeader/);
  assert.throws(() => assertNoSecrets({ authorization: `Basic ${fakeToken}` }), /credential field/);
  assert.throws(() => assertNoSecrets({ token: fakeToken }), /credential field/);
  assert.throws(() => assertNoSecrets({ apiKey: fakeToken }), /credential field/);
  assert.throws(() => assertNoSecrets({ hostToken: fakeToken }), /credential field/);
  assert.throws(() => assertNoSecrets({ log: [`GET /state Bearer ${fakeToken}`] }), /\$\.log\.0/);
  assert.throws(() => assertNoSecrets({ note: `key ${"sk-" + "ant-" + "a".repeat(30)}` }), /contains/);
  assert.throws(() => assertNoSecrets({ out: `prefix ${fakeToken} suffix` }, [fakeToken]), /known credential/);
  // The refusal names the path, never the value.
  try { assertNoSecrets({ a: `Bearer ${fakeToken}` }); } catch (error) { assert.ok(!String(error.message).includes(fakeToken)); }
});

test("evidence guard accepts safe authentication indicators and hashes", () => {
  assertNoSecrets({
    authenticated: true, authScheme: "Bearer", token: null, authHeader: false, authorization: "AWAITING_APPROVAL",
    note: "Bearer credentials are required", ref: "Bearer host.token",
    payloadSha256: "a".repeat(64), digest: "sha256:" + "b".repeat(64), taskId: "30e8d37a-6cb8-462b-b8ed-9e4457342c74",
  });
});

test("no tracked evidence or log file carries a credential", () => {
  const files = execFileSync("git", ["ls-files", "-z", "--", "docs", "test-results"], { encoding: "utf8" })
    .split("\0").filter((f) => /\.(json|jsonl|log|txt|md)$/i.test(f));
  const leaks = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const found = findSecretText(text);
    if (found) { leaks.push(`${file}: ${found}`); continue; }
    if (/\.json$/i.test(file)) {
      try { assertNoSecrets(JSON.parse(text)); } catch (error) { if (error instanceof SyntaxError) continue; leaks.push(`${file}: ${error.message}`); }
    }
  }
  assert.deepEqual(leaks, []);
});

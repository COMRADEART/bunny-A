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

// MA5-S2 privacy hygiene: device-test tools and new milestone evidence carry no workstation paths or pinned device serials.
// Older milestone reports (MA0–MA4) still name the workstation profile folder; see docs/ma5-s2/PRIVACY_HYGIENE.md.
const IDENTIFYING = [
  /\b[A-Za-z]:[\\/]+Users[\\/]+(?!Public\b)[^\\/\s"'`<>]+/i,
  /\/(?:mnt\/)?[a-z]\/Users\/(?!Public\b)[^/\s"'`<>]+/i,
  /\badb(?:\.exe)?["']?\s+-s\s+[A-Za-z0-9]{8,}/,
  /\b(?:ANDROID_)?SERIAL\s*=\s*["']?[A-Za-z0-9]{8,}/,
];

export function findIdentifying(text) {
  return IDENTIFYING.find((pattern) => pattern.test(text))?.source ?? null;
}

test("identifying-path scan flags workstation paths and pinned serials, not placeholders", () => {
  assert.ok(findIdentifying(String.raw`ADB = r"C:\Users\someone\tools\adb.exe"`));
  assert.ok(findIdentifying(`S="/c/Users/someone/scratch"`));
  assert.ok(findIdentifying(`adb.exe -s ABCD1234EF shell`));
  assert.ok(findIdentifying(`SERIAL = "ABCD1234EF"`));
  assert.equal(findIdentifying(`ADB = os.environ.get("BUNNY_ADB", "adb")`), null);
  assert.equal(findIdentifying(String.raw`%USERPROFILE%\AppData and C:\Users\Public`), null);
});

test("device-test tools and MA5 evidence carry no workstation paths or device serials", () => {
  const files = execFileSync("git", ["ls-files", "-z", "--", "scripts/android-device", "docs/ma5-*"], { encoding: "utf8" })
    .split("\0").filter((f) => f && !/\.(png|jpe?g|apk|dex|zip)$/i.test(f));
  assert.ok(files.length > 0);
  const hits = files.flatMap((file) => { const found = findIdentifying(readFileSync(file, "utf8")); return found ? [`${file}: ${found}`] : []; });
  assert.deepEqual(hits, []);
});

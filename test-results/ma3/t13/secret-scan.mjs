// M-A-3 T13 secret scan of the retained evidence and the main report. Reports file:line and the pattern name only, never
// the matched value. Usage: node test-results/ma3/t13/secret-scan.mjs
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";

const ev = resolve(import.meta.dirname);
const root = resolve(ev, "../../..");
const PATTERNS = [
  ["bearer-header", /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/],
  ["json-token-field", /"(?:token|accessToken|refreshToken|secret|password|apiKey|api_key)"\s*:\s*"[A-Za-z0-9._~+/=-]{16,}"/i],
  ["openai-style-key", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{30,}/],
  ["slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["private-key-block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
// Personal values are matched by SHA-256 only, so this file never contains them: the session's adb pairing codes and the
// user's email address.
const sha = (v) => createHash("sha256").update(v).digest("hex");
const PAIRING = new Set(["00000691457f4f0ce13e187b9ab4fda6d42c8647752909b8f71f9dbd8f6bd4ab", "337f064d2f40f967ad7cb556113bb8135e1b782968a4e442e8f2941b0a7b5280", "ea4fd4e2472a15913a68ebb5c24ec1bafa27c9dd466fd7200f4844ce49a3c2c0"]);
const EMAIL = "1855e3bb7250ae87fac6cbad756d9f52c1ad75c10bbc9f72b721b72122fd35dc";
const hashed = (line) =>
  [...(line.match(/\b\d{6}\b/g) ?? [])].some((v) => PAIRING.has(sha(v))) ? "adb-pairing-code"
    : [...(line.match(/[\w.+-]+@[\w.-]+/g) ?? [])].some((v) => sha(v.toLowerCase().replace(/[.,;:]+$/, "")) === EMAIL) ? "user-email" : null;
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) { if (!/^(?:windows-package-|source-checkout$|node_modules$|temp$|tmp-)/.test(name)) walk(p); }
    else if (!/credentials/i.test(name) && s.size < 20 * 1024 * 1024 && !/\.(?:exe|dll|bin|wav|png|jpg|zip)$/i.test(name)) files.push(p);
  }
};
walk(ev);
const report = join(root, "MA3_T13_UI_UX_MASTERY_ACCEPTANCE.md");
if (existsSync(report)) files.push(report);
const findings = [];
for (const file of files) {
  if (file === join(ev, "secret-scan.json")) continue;
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const [name, re] of PATTERNS) if (re.test(line)) findings.push({ file: relative(root, file).replaceAll("\\", "/"), line: i + 1, pattern: name });
    const personal = hashed(line);
    if (personal) findings.push({ file: relative(root, file).replaceAll("\\", "/"), line: i + 1, pattern: personal });
  });
}
writeFileSync(join(ev, "secret-scan.json"), JSON.stringify({ scanned: files.length, patterns: [...PATTERNS.map(([n]) => n), "adb-pairing-code (sha256)", "user-email (sha256)"], findings: findings.length, details: findings }, null, 2) + "\n");
console.log(JSON.stringify({ scanned: files.length, findings: findings.length }));
for (const f of findings.slice(0, 40)) console.log(f.file, f.line, f.pattern);

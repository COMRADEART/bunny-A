// M-A-3 T13.1 secret scan of the retained evidence and the acceptance report (adapted from t13/secret-scan.mjs). Reports
// file:line and the pattern name only, never the matched value. Usage: node test-results/ma3/t13-1/secret-scan.mjs
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { createHash } from "node:crypto";

const ev = resolve(import.meta.dirname);
const root = resolve(ev, "../../..");
const PATTERNS = [
  ["bearer-header", /\bBearer\s+[A-Za-z0-9._~+/-]{20,}/],
  ["json-token-field", /"(?:token|accessToken|refreshToken|secret|password|apiKey|api_key)"\s*:\s*"[A-Za-z0-9._~+/=-]{16,}"/i],
  ["openai-style-key", /\bsk-[A-Za-z0-9_-]{20,}/],
  ["typesafe-style-key", /\bts[-_](?!FIXTURE)[A-Za-z0-9]{24,}/],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{30,}/],
  ["slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}/],
  ["aws-access-key", /\bAKIA[0-9A-Z]{16}\b/],
  ["private-key-block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ["dpapi-blob", /\bAQAAANCMnd8BFdERjHoAwE\/Cl\+sBAAAA/],
];
// The user's email address is matched by SHA-256 only, so this file never contains it.
const sha = (v) => createHash("sha256").update(v).digest("hex");
const EMAIL = "1855e3bb7250ae87fac6cbad756d9f52c1ad75c10bbc9f72b721b72122fd35dc";
const personal = (line) => [...(line.match(/[\w.+-]+@[\w.-]+/g) ?? [])].some((v) => sha(v.toLowerCase().replace(/[.,;:]+$/, "")) === EMAIL);
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) { if (!/^(?:windows-package|source-checkout$|node_modules$|temp$|tmp-)/.test(name)) walk(p); }
    else if (s.size < 20 * 1024 * 1024 && !/\.(?:exe|dll|node|bin|wav|png|jpg|zip)$/i.test(name)) files.push(p);
  }
};
walk(ev);
const report = join(root, "MA3_T13_1_LAYA_JEV_INTEGRATION_ACCEPTANCE.md");
if (existsSync(report)) files.push(report);
const findings = [];
for (const file of files) {
  if (file === join(ev, "secret-scan.json") || file === join(ev, "secret-scan.mjs")) continue;
  readFileSync(file, "utf8").split(/\r?\n/).forEach((line, i) => {
    const where = { file: relative(root, file).replaceAll("\\", "/"), line: i + 1 };
    for (const [name, re] of PATTERNS) if (re.test(line)) findings.push({ ...where, pattern: name });
    if (personal(line)) findings.push({ ...where, pattern: "user-email" });
  });
}
writeFileSync(join(ev, "secret-scan.json"), JSON.stringify({ scanned: files.length, patterns: [...PATTERNS.map(([n]) => n), "user-email (sha256)"], findings: findings.length, details: findings }, null, 2) + "\n");
console.log(JSON.stringify({ scanned: files.length, findings: findings.length }));
for (const f of findings.slice(0, 40)) console.log(f.file, f.line, f.pattern);
if (findings.length) process.exitCode = 1;

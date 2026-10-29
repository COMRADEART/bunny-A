// MA5-S2 Phase 4 (P4-6): removes %TEMP%\bunny-f04-XXXXXX folders left by provider-containment.test.ts workspace(), and
// nothing else. A folder is removed only when every check proves it is that fixture's disposable workspace:
//   name bunny-f04-<6 mkdtemp chars>; a real directory (not a link); only f04-fixture.exe, provider.cjs and host.mjs, all
//   regular files; provider.cjs byte-equal to the source the test writes; host.mjs (when present) the J35 host script for
//   this same folder; f04-fixture.exe a PE image. Anything else is reported and kept.
// Dry run by default. Usage: node scripts/ma5-s2/clean-f04-temp.mjs [--delete]
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const test = readFileSync(new URL("../../src/lib/bunny-host/provider-containment.test.ts", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const start = test.indexOf("writeFileSync(provider, `") + "writeFileSync(provider, `".length;
// The template literal has no interpolation; its only escape is "\\n" (backslash, n).
export const providerSource = test.slice(start, test.indexOf("`);", start)).replace(/\\\\/g, "\\");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const expectedProvider = sha(providerSource);
const ALLOWED = new Set(["f04-fixture.exe", "provider.cjs", "host.mjs"]);

/** null when `dir` is proven to be a leftover F04 fixture workspace, otherwise the reason it is kept. */
export function verdict(dir, name) {
  if (!/^bunny-f04-[A-Za-z0-9]{6}$/.test(name)) return "name";
  const st = lstatSync(dir);
  if (!st.isDirectory() || st.isSymbolicLink()) return "not a plain directory";
  const entries = readdirSync(dir);
  for (const e of entries) {
    if (!ALLOWED.has(e)) return `unexpected entry ${e}`;
    if (!lstatSync(join(dir, e)).isFile()) return `${e} is not a regular file`;
  }
  if (!entries.includes("provider.cjs") || !entries.includes("f04-fixture.exe")) return "fixture files missing";
  if (sha(readFileSync(join(dir, "provider.cjs"))) !== expectedProvider) return "provider.cjs is not the test's fixture";
  const exe = readFileSync(join(dir, "f04-fixture.exe"));
  if (exe.length > 4 * 1024 * 1024 || exe.subarray(0, 2).toString("latin1") !== "MZ") return "f04-fixture.exe is not a small PE image";
  if (entries.includes("host.mjs")) {
    const host = readFileSync(join(dir, "host.mjs"), "utf8");
    if (!host.startsWith("const { spawnSession } = await import(") || !host.includes(`cwd: ${JSON.stringify(dir)}`)) return "host.mjs is not the J35 script for this folder";
  }
  return null;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const del = process.argv.includes("--delete");
  const temp = tmpdir();
  const rows = readdirSync(temp).filter((n) => n.startsWith("bunny-f04-")).map((name) => ({ name, refused: verdict(join(temp, name), name) }));
  let removed = 0;
  const failed = [];
  if (del) for (const r of rows.filter((r) => !r.refused)) {
    try { rmSync(join(temp, r.name), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); removed += 1; } catch (e) { failed.push({ name: r.name, code: e.code }); }
  }
  console.log(JSON.stringify({ mode: del ? "delete" : "dry-run", found: rows.length, proven: rows.filter((r) => !r.refused).length, kept: rows.filter((r) => r.refused).map((r) => ({ name: r.name, why: r.refused })), removed, failed }, null, 2));
}

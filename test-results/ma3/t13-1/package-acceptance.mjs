// M-A-3 T13.1 disposable Host acceptance of the EXACT Windows test package (LIVE VERIFIED on this PC, disposable state).
// 1. Starts the packaged Host with the package's own node.exe (package-host.mjs) on 43892 with temp state.
// 2. Checks AI & Models at the real HTTP surface: defaults, fixture key save with real DPAPI, Test connection refused
//    locally while hosted decisions are off, paired-phone default-deny and stripped projection, key never on disk.
// 3. Renders the package's built dashboard on 127.0.0.1:8081 against that Host and runs shots.mjs (phase "package").
// No TypeSafe request is possible: hosted decisions stay off for the whole run and the jev_usage table is checked empty.
// Usage: node test-results/ma3/t13-1/package-acceptance.mjs
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const here = resolve(import.meta.dirname);
const root = resolve(here, "../../..");
const packageRoot = join(here, "windows-package/Bunny-A-Windows-MA3-T13-1-TEST");
const packagedNode = join(packageRoot, "runtime/node.exe");
const scratch = join(tmpdir(), "bunny-t131-package-host");
const port = 43892;
const FIXTURE_KEY = "ts_FIXTURE_screenshot_not_a_real_key_000";
rmSync(scratch, { recursive: true, force: true });

const checks = [];
const check = (id, ok, detail) => { checks.push({ id, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"} ${id}: ${detail}`); };
const wait = async (predicate, label, ms = 120_000) => {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > ms) throw new Error(`timed out: ${label}`);
    await new Promise((done) => setTimeout(done, 250));
  }
};
const output = [];
const hostProcess = spawn(packagedNode, [join(here, "package-host.mjs"), packageRoot, scratch, String(port)], { cwd: packageRoot, env: { ...process.env }, stdio: ["ignore", "pipe", "pipe"] });
hostProcess.stdout.on("data", (chunk) => output.push(String(chunk)));
hostProcess.stderr.on("data", (chunk) => output.push(String(chunk)));
let preview = null;
try {
  await wait(() => existsSync(join(scratch, "credentials.json")), "packaged Host start");
  const { token } = JSON.parse(readFileSync(join(scratch, "credentials.json"), "utf8"));
  const runtime = JSON.parse(readFileSync(join(scratch, "host.json"), "utf8"));
  check("P01 packaged runtime", runtime.node.toLowerCase() === packagedNode.toLowerCase() && runtime.entry.startsWith(packageRoot), `${runtime.version} from the package; entry ${runtime.entry.replace(root, ".")}`);
  const base = `http://127.0.0.1:${port}`;
  const command = async (action, data = {}, bearer = token) => {
    const response = await fetch(`${base}/command`, { method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body: JSON.stringify({ action, data }) });
    const text = await response.text();
    return { status: response.status, body: JSON.parse(text), text };
  };
  const state = async (bearer = token) => {
    const response = await fetch(`${base}/state`, { headers: { authorization: `Bearer ${bearer}` } });
    const text = await response.text();
    return { status: response.status, body: JSON.parse(text), text };
  };
  await wait(async () => (await state()).body.intelligence?.laya?.probedAt != null || (await state()).body.intelligence?.laya?.status === "offline", "local runtime discovery", 90_000);

  const fresh = (await state()).body.intelligence;
  check("P02 router", fresh.router === "BunnyRouter" && fresh.localDecisionPolicy.label === "Local Decision Policy", `${fresh.router}; fallback "${fresh.localDecisionPolicy.label}"`);
  check("P03 Laya truthful", ["missing", "offline"].includes(fresh.laya.status) && fresh.laya.models.length === 0 && fresh.laya.apiKeyRequired === false, `status ${fresh.laya.status}, ${fresh.laya.models.length} models, no key field`);
  check("P04 Jev defaults", fresh.jev.state === "DISABLED" && fresh.jev.enabled === false && fresh.jev.hasCredential === false && fresh.jev.limits.maxRequestsPerDay === 0 && fresh.jev.limits.maxRequestsPerSession === 0, `state ${fresh.jev.state}, daily/session allowance ${fresh.jev.limits.maxRequestsPerDay}/${fresh.jev.limits.maxRequestsPerSession}`);

  const saved = await command("intelligence.credential.save", { apiKey: FIXTURE_KEY });
  const afterSave = (await state()).body.intelligence.jev;
  check("P05 save (real DPAPI)", saved.status === 200 && afterSave.hasCredential && afterSave.credentialProtection === "Windows DPAPI (current user)" && afterSave.state === "DISABLED" && !saved.text.includes(FIXTURE_KEY), `HTTP ${saved.status}; ${afterSave.credentialProtection}; state stays ${afterSave.state} (saving is not testing)`);
  const tested = await command("intelligence.test", {});
  const afterTest = (await state()).body.intelligence.jev;
  check("P06 test refused while off", afterTest.lastTest === null && /Turn on hosted decision assistance/.test(afterTest.lastError ?? "") && afterTest.usage.dayRequests === 0, `HTTP ${tested.status}; "${afterTest.lastError}"`);

  const pairCode = (await command("pairing.create")).body.pairCode;
  const paired = await fetch(`${base}/pair`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: pairCode, name: "T13.1 package phone" }) });
  const phone = (await paired.json()).token;
  const phoneView = await state(phone);
  check("P07 phone projection", phoneView.status === 200 && phoneView.body.intelligence === undefined && !phoneView.text.includes(FIXTURE_KEY), "paired phone state has no intelligence block and no key");
  const refusals = [];
  for (const [action, data] of [["intelligence.credential.remove", {}], ["intelligence.credential.save", { apiKey: "ts_PHONE_REPLACEMENT_FIXTURE_0000" }], ["intelligence.configure", { policy: { enabled: true } }], ["intelligence.test", {}]]) refusals.push([action, (await command(action, data, phone)).body.code]);
  check("P08 phone default-deny", refusals.every(([, code]) => code === "WORKSTATION_REQUIRED") && (await state()).body.intelligence.jev.hasCredential && !(await state()).body.intelligence.jev.enabled, refusals.map(([action, code]) => `${action}=${code}`).join(", "));

  // Package dashboard render against this Host.
  preview = spawn(packagedNode, [join(here, "package-preview.mjs")], { cwd: root, env: { ...process.env, BUNNY_HOST_CREDENTIALS_FILE: join(scratch, "credentials.json") }, stdio: ["ignore", "pipe", "pipe"] });
  preview.stdout.on("data", (chunk) => output.push(String(chunk)));
  preview.stderr.on("data", (chunk) => output.push(String(chunk)));
  await wait(async () => { try { return (await fetch("http://127.0.0.1:8081/")).ok; } catch { return false; } }, "package preview", 60_000);
  const shots = spawnSync(process.execPath, [join(here, "shots.mjs"), "package"], { cwd: root, encoding: "utf8", env: { ...process.env, T131_BASE: "http://127.0.0.1:8081", PLAYWRIGHT_BROWSERS_PATH: join(process.env.LOCALAPPDATA ?? "", "ms-playwright") } });
  const report = JSON.parse(readFileSync(join(here, "shots-package.json"), "utf8"));
  const bad = report.filter((row) => row.overflowX || row.consoleErrors.length || row.keyInDom || row.keyInStorage || !row.panelLabelled);
  check("P09 package dashboard render", shots.status === 0 && report.length === 12 && bad.length === 0, `${report.length} Settings > AI & Models renders (3 tabs x desktop/phone x light/dark); ${bad.length} with overflow, console errors, key material or unlabelled panel`);

  const removed = await command("intelligence.credential.remove", {});
  check("P10 owner remove", removed.status === 200 && (await state()).body.intelligence.jev.hasCredential === false, `HTTP ${removed.status}; key removed`);
} catch (error) {
  check("P00 run", false, error instanceof Error ? error.message : String(error));
} finally {
  preview?.kill();
  writeFileSync(join(scratch, "close"), "");
  await wait(() => hostProcess.exitCode !== null, "packaged Host stop", 30_000).catch(() => hostProcess.kill());
}

// At rest: no plaintext fixture key in any state file; no TypeSafe usage row was ever written.
const files = [];
const walk = (directory) => { for (const name of readdirSync(directory)) { const path = join(directory, name); if (statSync(path).isDirectory()) walk(path); else files.push(path); } };
walk(join(scratch, "state"));
const leaked = files.filter((path) => readFileSync(path).includes(Buffer.from(FIXTURE_KEY)));
check("P11 key at rest", leaked.length === 0 && !output.join("").includes(FIXTURE_KEY), `${files.length} state files and Host/preview output scanned; ${leaked.length} contain the key`);
const database = new DatabaseSync(join(scratch, "state/host.sqlite"), { readOnly: true });
const usageRows = database.prepare("SELECT COUNT(*) AS n FROM jev_usage").get().n;
database.close();
check("P12 zero TypeSafe usage", usageRows === 0, `jev_usage rows: ${usageRows} (no request reached or was reserved for TypeSafe)`);

const result = {
  classification: "LIVE VERIFIED on a DISPOSABLE Host started from the exact Windows test package (packaged node.exe and packaged source), disposable temp state, port 43892; dashboard rendered from the package on 127.0.0.1:8081. Production 43119/8084 and %LOCALAPPDATA%\\Bunny-A untouched.",
  package: "test-results/ma3/t13-1/windows-package/Bunny-A-Windows-MA3-T13-1-TEST",
  layoutNote: "Development state layout; the installed layout needs a migrated production state and was deliberately not created.",
  typesafeCalls: 0,
  checks,
  result: checks.every((row) => row.ok) ? "PASS" : "FAIL",
};
writeFileSync(join(here, "package-acceptance.json"), JSON.stringify(result, null, 2) + "\n");
rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
console.log(result.result);
process.exitCode = result.result === "PASS" ? 0 : 1;

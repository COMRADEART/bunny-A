import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexAdapter, codexLaunchArgs, probe, providerBase } from "./adapters.server.ts";
import { CodexCompatibilityGate, emptyCodexCompatibility, ExecutableFingerprints, executableStamp, validatedCodexRuntimes, type MetadataProbe } from "./codex-compatibility.server.ts";
import { CODEX_COMPATIBILITY_MAX_AGE_MS, CODEX_SECURITY_POLICY_VERSION, codexMissionExclusion, codexMissionStatus } from "../orch/compatibility.ts";
import { bunnyRoute, eligibility } from "./router.ts";
import { describeChange, materialSignature, ProviderRegistry } from "./registry.server.ts";
import { HostDatabase } from "./persistence.server.ts";
import { TaskManager } from "./manager.server.ts";
import { validateConstraints } from "./http.server.ts";
import { hostStatePaths } from "./state-paths.server.ts";
import type { AdapterHooks } from "./contracts.ts";
import type { OrchTask } from "../orch/types.ts";
import { FIXTURE_FEATURES, FIXTURE_HELP, FIXTURE_INVALID, fixtureProbe, fixtureSecurity, simulatedCodexProfile } from "./testing/codex.test.ts";

const hooks: AdapterHooks = { output: () => {}, event: () => {}, session: () => {} };
const ready = () => ({ ...providerBase("codex"), installed: true, authenticated: true, availability: "ready" as const, capabilities: ["text", "filesystem", "terminal"], current_model: "fixture", models: ["fixture"], securityCompatibility: simulatedCodexProfile() });
function standIn(script: string, options: { version?: string; help?: string; versionCode?: number; helpCode?: number; timeout?: boolean; parserRejects?: boolean; acceptsInvalid?: boolean; features?: string; marker?: string } = {}) {
  writeFileSync(script, `import {appendFileSync} from 'node:fs';
const args=process.argv.slice(2);
if(args.includes('--version')) { ${options.timeout ? "setTimeout(()=>{},10000);" : `console.log(${JSON.stringify(options.version ?? "codex-cli 0.153.4")}); process.exitCode=${options.versionCode ?? 0};`} }
else if(args.includes('--help')) { console.log(${JSON.stringify(options.help ?? FIXTURE_HELP)}); process.exitCode=${options.helpCode ?? 0}; }
else if(args.includes('features')) {
  const invalid=args.some(arg=>arg.includes('bunny_t2_invalid'));
  if(${!!options.parserRejects} || (invalid && !${!!options.acceptsInvalid})) { console.error(${JSON.stringify(FIXTURE_INVALID)}); process.exitCode=1; }
  else console.log(${JSON.stringify(options.features ?? FIXTURE_FEATURES)});
} else {
  ${options.marker ? `appendFileSync(${JSON.stringify(options.marker)},'model session started\\n');` : ""}
  process.stdin.resume();process.stdin.on('end',()=>console.log(JSON.stringify({argv:args})));
}
`);
}
async function fixture(options: Parameters<typeof standIn>[1] = {}, metadata: MetadataProbe = probe) {
  const dir = mkdtempSync(join(tmpdir(), "bunny-t2-")); const script = join(dir, "codex-fixture.mjs"); const marker = join(dir, "model-starts.txt");
  standIn(script, { ...options, marker });
  const security = await fixtureSecurity(script, metadata);
  const adapter = new CodexAdapter(() => security.ctx, security.gate);
  adapter.launchTarget = security.launch; adapter.detected = { ...ready(), executable: script, securityCompatibility: security.profile };
  const task = { id: "t2-fixture", provider: "codex", model: "fixture", prompt: "Return argv only", cwd: dir, executionScope: { access: "read" }, mission: { missionId: "fixture", stepId: "fixture" } } as OrchTask;
  return { ...security, dir, script, marker, adapter, task, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("T2: an exact explicitly registered stand-in validates read and write with real metadata processes", async () => {
  const env = await fixture();
  try {
    assert.equal(env.profile.compatibilityClass, "VALIDATED");
    for (const access of ["read", "write"] as const) {
      assert.equal(eligibility({ ...ready(), securityCompatibility: env.profile }, { missionAccess: access }), null);
      const task = { ...env.task, executionScope: { access } };
      assert.equal((await env.adapter.launch(task, hooks).done).ok, true);
    }
    assert.equal(readFileSync(env.marker, "utf8").trim().split("\n").length, 2);
  } finally { env.cleanup(); }
});

for (const version of ["codex-cli 0.999.0", "codex-cli 0.1.0", "codex-cli 0.153.5", "codex-cli 99.0.0"]) test(`T2: ${version} cannot inherit an exact-version entry`, async () => {
  const env = await fixture({ version });
  try {
    assert.equal(env.profile.compatibilityClass, "UNVALIDATED");
    for (const access of ["read", "write"] as const) assert.match(eligibility({ ...ready(), securityCompatibility: env.profile }, { missionAccess: access })!, /Unvalidated security compatibility/);
    assert.throws(() => env.adapter.launch(env.task, hooks), /excluded/);
    assert.equal(existsSync(env.marker), false);
  } finally { env.cleanup(); }
});
for (const version of ["", "0.153.4", "codex-cli latest", "codex-cli 0.153.4\nother output", "codex-cli 0.153.4-beta"]) test(`T2: malformed version ${JSON.stringify(version)} fails closed`, async () => {
  const env = await fixture({ version });
  try { assert.equal(env.profile.compatibilityClass, "UNVALIDATED"); assert.match(env.profile.reason, /version output/); assert.equal(existsSync(env.marker), false); } finally { env.cleanup(); }
});
for (const failure of ["nonzero", "timeout"] as const) test(`T2: ${failure} version metadata fails closed without a model`, async () => {
  const env = await fixture({ versionCode: failure === "nonzero" ? 3 : 0, timeout: failure === "timeout" }, (launch, args) => probe(launch, args, failure === "timeout" ? 150 : 5000));
  try { assert.equal(env.profile.compatibilityClass, "UNVALIDATED"); assert.match(env.profile.reason, /version probe/); assert.equal(existsSync(env.marker), false); } finally { env.cleanup(); }
});
for (const options of [{ helpCode: 2 }, { help: "Unexpected help" }]) test(`T2: failed or unreadable help ${JSON.stringify(options)} is unvalidated`, async () => {
  const env = await fixture(options);
  try { assert.equal(env.profile.compatibilityClass, "UNVALIDATED"); assert.match(env.profile.reason, /help/); } finally { env.cleanup(); }
});
for (const flag of ["--ignore-user-config", "--ignore-rules", "workspace-write", "read-only", "-c, --config <key=value>", "--disable <FEATURE>"]) test(`T2: claimed current version with missing ${flag} is unsupported`, async () => {
  const env = await fixture({ help: FIXTURE_HELP.replace(flag, "") });
  try { assert.equal(env.profile.compatibilityClass, "UNSUPPORTED"); assert.match(env.profile.reason, /support unavailable/); assert.equal(existsSync(env.marker), false); } finally { env.cleanup(); }
});
for (const options of [{ parserRejects: true }, { acceptsInvalid: true }, { features: FIXTURE_FEATURES.replace("apps\tstable\tfalse", "apps\tstable\ttrue") }]) test(`T2: contradictory Windows setting or extension parser ${JSON.stringify(options)} is incompatible`, async () => {
  const env = await fixture(options);
  try { assert.equal(env.profile.compatibilityClass, "INCOMPATIBLE"); assert.equal(existsSync(env.marker), false); } finally { env.cleanup(); }
});

test("T2: same version and different binary cannot inherit the first stand-in fingerprint", async () => {
  const env = await fixture();
  try {
    const first = env.profile.executable!.sha256;
    writeFileSync(env.script, readFileSync(env.script, "utf8") + "\n// harmless second executable\n");
    const second = await env.gate.inspect(env.launch, env.ctx, true);
    assert.equal(second.versionRaw, env.profile.versionRaw);
    assert.notEqual(second.executable!.sha256, first);
    assert.equal(second.compatibilityClass, "UNVALIDATED");
    assert.equal(existsSync(env.marker), false);
  } finally { env.cleanup(); }
});
test("T2: swapping the binary after discovery refuses Mission spawn even with restored size and mtime", async () => {
  const env = await fixture();
  try {
    const stat = statSync(env.script); const text = readFileSync(env.script, "utf8");
    writeFileSync(env.script, text.replace("Return", "RETURN").replace("argv:args", "ARGV:args"));
    assert.equal(statSync(env.script).size, stat.size);
    utimesSync(env.script, stat.atime, stat.mtime);
    const result = await env.adapter.launch(env.task, hooks).done;
    assert.equal(result.ok, false); assert.match(result.error!, /Unvalidated|identity changed/);
    assert.equal(existsSync(env.marker), false);
  } finally { env.cleanup(); }
});
test("T2: discovery hash cache invalidates a file replacement and the final check rejects it", async () => {
  const env = await fixture();
  try {
    const cached = env.gate.fingerprints.identify(env.launch);
    assert.equal(env.gate.fingerprints.identify(env.launch), cached);
    const replacement = join(env.dir, "replacement.mjs"); writeFileSync(replacement, readFileSync(env.script, "utf8") + "// replacement\n");
    renameSync(env.script, join(env.dir, "original.mjs")); renameSync(replacement, env.script);
    const changed = env.gate.fingerprints.identify(env.launch);
    assert.notEqual(changed.stamp, cached.stamp); assert.notEqual(changed.sha256, cached.sha256);
    assert.throws(() => env.gate.authorize(env.launch, env.profile, "read"), /identity changed/);
  } finally { env.cleanup(); }
});
test("T2: a path change after discovery is refused before metadata or model launch", async () => {
  const env = await fixture();
  try {
    const other = join(env.dir, "other.mjs"); writeFileSync(other, readFileSync(env.script));
    env.ctx.configured.codex = other;
    assert.throws(() => env.adapter.launch(env.task, hooks), /resolved executable changed/);
    assert.equal(existsSync(env.marker), false);
  } finally { env.cleanup(); }
});
test("T2: a changed version result is re-probed at launch, even if file bytes are unchanged", async () => {
  let version = "codex-cli 0.153.4";
  const env = await fixture({}, async (launch, args, timeout) => args.includes("--version") ? { code: 0, timedOut: false, stdout: version, stderr: "" } : probe(launch, args, timeout));
  try {
    version = "codex-cli 0.999.0";
    const result = await env.adapter.launch(env.task, hooks).done;
    assert.equal(result.ok, false); assert.match(result.error!, /0\.999\.0/); assert.equal(existsSync(env.marker), false);
  } finally { env.cleanup(); }
});
test("T2: stop during safe metadata checks prevents the later model spawn", async () => {
  let hold = false; let release!: () => void;
  const env = await fixture({}, async (launch, args, timeout) => { if (hold && args.includes("--version")) await new Promise<void>(resolve => { release = resolve; }); return probe(launch, args, timeout); });
  try {
    hold = true; const running = env.adapter.launch(env.task, hooks);
    await running.stop(); release();
    assert.equal((await running.done).stopped, true); assert.equal(existsSync(env.marker), false);
  } finally { env.cleanup(); }
});
test("T2: retargeting the resolved path during metadata checks prevents final spawn", async () => {
  let change = false;
  const env = await fixture({}, async (launch, args, timeout) => { const result = await probe(launch, args, timeout); if (change && args.includes("--help")) context.configured.codex = process.execPath; return result; });
  const context = env.ctx;
  try { change = true; const result = await env.adapter.launch(env.task, hooks).done; assert.equal(result.ok, false); assert.match(result.error!, /resolved executable changed/); assert.equal(existsSync(env.marker), false); } finally { env.cleanup(); }
});

for (const access of ["read", "write"] as const) test(`T2: ${access} routing excludes Codex before scoring and rejects manual override`, () => {
  const codex = { ...ready(), securityCompatibility: emptyCodexCompatibility("unvalidated future version") };
  const claude = { ...ready(), id: "claude" as const, name: "Claude", securityCompatibility: undefined };
  const result = bunnyRoute({ prompt: "Inspect local source", mode: "deep", providers: [codex, claude], constraints: { missionAccess: access }, learned: id => id === "codex" ? 100 : 0 });
  assert.deepEqual(result.eligible_providers, ["claude"]); assert.equal(result.scores.some(row => row.provider === "codex"), false);
  assert.match(result.excluded!.find(row => row.provider === "codex")!.reason, /unvalidated future version/);
  assert.throws(() => bunnyRoute({ prompt: "Inspect", mode: "deep", providers: [codex, claude], override: "codex", constraints: { missionAccess: access } }), /Selected executor.*unvalidated future version/);
});
test("T2: stale evidence, an unknown policy, or a claimed VALIDATED profile without required facts grants no authority", () => {
  const codex = ready();
  codex.securityCompatibility.checkedAt = Date.now() - CODEX_COMPATIBILITY_MAX_AGE_MS - 1;
  assert.match(codexMissionExclusion(codex, "read")!, /stale/); assert.equal(codexMissionStatus(codex), "Check required");
  codex.securityCompatibility = simulatedCodexProfile(); codex.securityCompatibility.policyVersion++;
  assert.match(codexMissionExclusion(codex, "write")!, /policy version/);
  codex.securityCompatibility = simulatedCodexProfile(); codex.securityCompatibility.mcpIsolationValidated = false;
  assert.match(codexMissionExclusion(codex, "write")!, /isolation/);
  codex.securityCompatibility = simulatedCodexProfile(); codex.securityCompatibility.executable = null;
  assert.match(codexMissionExclusion(codex, "read")!, /identity is incomplete/);
  assert.equal(CODEX_SECURITY_POLICY_VERSION, 1);
});
test("T2: direct legacy task still starts with the exact pre-T2 argv despite unvalidated compatibility", async () => {
  const env = await fixture({ version: "codex-cli 0.999.0" }); const lines: string[] = [];
  try {
    const task = { ...env.task, executionScope: undefined, mission: undefined };
    assert.equal(eligibility({ ...ready(), securityCompatibility: env.profile }, {}), null);
    const result = await env.adapter.launch(task, { ...hooks, raw: (_stream, line) => lines.push(line) }).done;
    assert.equal(result.ok, true); assert.deepEqual(JSON.parse(lines[0]).argv, ["exec", "--json", "--sandbox", "workspace-write", "--skip-git-repo-check", "--cd", env.dir, "--model", "fixture", "-"]);
    assert.deepEqual(codexLaunchArgs(task), JSON.parse(lines[0]).argv);
  } finally { env.cleanup(); }
});
test("T2: persisted validated facts do not make Codex routable after Host restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bunny-t2-restart-")); const path = join(dir, "host.sqlite");
  const db = new HostDatabase(path);
  const adapters = [{ id: "codex" as const, detect: async () => ready(), launch: () => { throw new Error("No fixture model allowed"); } }];
  try {
    const first = new ProviderRegistry(adapters, db); await first.refresh();
    const tasks = new TaskManager(db, dir, adapters);
    assert.equal(tasks.registry.probedThisRun("codex"), false);
    assert.equal(tasks.live()[0].availability, "unknown");
    assert.throws(() => tasks.submit({ prompt: "Inspect", mode: "fast", constraints: { missionAccess: "read" } }), /unknown status/);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
test("T2: compatibility changes emit material status changes, routine check times do not", () => {
  const first = ready(); const later = structuredClone(first); later.securityCompatibility.checkedAt++;
  later.securityCompatibility.validatedAt!++;
  assert.equal(materialSignature(first), materialSignature(later));
  later.securityCompatibility.compatibilityClass = "UNVALIDATED"; later.securityCompatibility.reason = "binary replaced";
  assert.notEqual(materialSignature(first), materialSignature(later)); assert.match(describeChange(first, later), /Mission compatibility UNVALIDATED: binary replaced/);
});
test("T2: health notices file identity changes and expired metadata without launching a model", async () => {
  const env = await fixture({}, fixtureProbe);
  try {
    env.adapter.print = `${statSync(env.script).size}:${statSync(env.script).mtimeMs}`;
    assert.equal(await env.adapter.health(env.adapter.detected!), env.adapter.detected);
    env.adapter.detected!.securityCompatibility!.checkedAt -= CODEX_COMPATIBILITY_MAX_AGE_MS + 1;
    assert.equal(await env.adapter.health(env.adapter.detected!), null);
    env.adapter.detected!.securityCompatibility!.checkedAt = Date.now();
    writeFileSync(env.script, readFileSync(env.script, "utf8") + "// new binary\n");
    assert.equal(await env.adapter.health(env.adapter.detected!), null);
    assert.equal(existsSync(env.marker), false);
  } finally { env.cleanup(); }
});
test("T2: public constraints cannot inject Mission authority or a compatibility override", () => {
  assert.throws(() => validateConstraints({ missionAccess: "write" }), /Unsupported constraint/);
  assert.throws(() => validateConstraints({ bypassCompatibility: true }), /Unsupported constraint/);
});
test("T2: default registry is exact and T1 state root/database paths stay unchanged", () => {
  const entries = validatedCodexRuntimes({ home: "C:\\Users\\fixture" });
  assert.equal(entries.length, 1); assert.equal(entries[0].version, "0.153.4"); assert.equal(entries[0].kind, "native"); assert.deepEqual(entries[0].prefixArgs, []);
  assert.equal(entries[0].sha256, "444a3f0008050605cae73cd9b7a2dcac61294062dfaab56dd20430fd6498518b");
  const state = join(tmpdir(), "fixture-state"); const paths = hostStatePaths(state);
  assert.equal(paths.database, join(state, "host.sqlite"));
  assert.ok(!paths.database.includes(".bunny-a"));
  const gate = new CodexCompatibilityGate({ probe: fixtureProbe });
  assert.ok(gate.fingerprints instanceof ExecutableFingerprints); assert.equal(typeof executableStamp, "function");
});

/**
 * M-A-3 T9R-F04 §10 nested-job validation. A Host-equivalent Node process (the production contained spawnSession with
 * the disposable provider stand-in and process fixture) runs under four enclosing-job conditions created by
 * scripts/fixtures/f04-job-wrapper.c. Each case records whether the provider session was admitted, whether its tree
 * stayed in Bunny's job, and that Stop left no fixture process (independent Win32_Process read).
 * Run from the repository root: node test-results/ma3/t9r-f04/nested-job-validation.mjs
 * Writes test-results/ma3/t9r-f04/nested-job-validation.json
 */
import { execFile, execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const compiler = process.env.BUNNY_NATIVE_CC || "C:\\msys64\\ucrt64\\bin\\gcc.exe";
const directory = mkdtempSync(join(tmpdir(), "bunny-f04-nested-"));
const fixture = join(directory, "f04-nested-fixture.exe"), wrapper = join(directory, "f04-job-wrapper.exe");
execFileSync(compiler, ["-std=c11", "-O2", "-municode", join(repo, "scripts/fixtures/f04-process-fixture.c"), "-o", fixture], { windowsHide: true });
execFileSync(compiler, ["-std=c11", "-O2", "-municode", join(repo, "scripts/fixtures/f04-job-wrapper.c"), "-o", wrapper], { windowsHide: true });
const provider = join(directory, "provider.cjs");
writeFileSync(provider, `const { spawn } = require("child_process");
process.stdin.resume(); process.stdin.on("end", () => { spawn(${JSON.stringify(fixture)}, ["tree", "60000"], { stdio: "ignore", windowsHide: true }).unref(); setTimeout(() => process.exit(0), 60000); });\n`);
const host = join(directory, "host.mjs");
writeFileSync(host, `const { spawnSession } = await import(${JSON.stringify("file:///" + join(repo, "src/lib/bunny-host/adapters.server.ts").replace(/\\/g, "/"))});
const session = spawnSession("claude", { command: process.execPath, args: [${JSON.stringify(provider)}], path: ${JSON.stringify(provider)}, kind: "node-script", source: "nested" }, [], { id: "n", provider: "claude", model: "m", cwd: ${JSON.stringify(directory)}, prompt: "nested" }, { event(){}, session(){}, output(){} }, "s");
const started = Date.now();
for (;;) {
  const c = session.containment();
  if (c.state === "refused" || (c.activeProcesses ?? 0) >= 8 || Date.now() - started > 20000) break;
  await new Promise((r) => setTimeout(r, 100));
}
const during = session.containment();
await session.stop();
const result = await session.done;
const line = "RESULT " + JSON.stringify({ during: { state: during.state, activeProcesses: during.activeProcesses, detail: during.detail }, after: session.containment(), ok: result.ok, error: result.error ?? null });
console.log(line);
(await import("node:fs")).writeFileSync(${JSON.stringify(join(directory, "host-result.txt"))}, line);
`);
async function fixtures() {
  const { stdout } = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${fixture}' }).Count`], { windowsHide: true });
  return Number(stdout.trim());
}
const cases = [];
for (const mode of ["none", "plain", "limit1", "silent"]) {
  let stdout = "", code = 0;
  try { ({ stdout } = await run(wrapper, [mode, process.execPath, "--experimental-strip-types", host], { windowsHide: true, timeout: 90000 })); }
  catch (error) { stdout = String(error.stdout ?? ""); code = error.code ?? -1; }
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  const wrapperLine = lines.find((l) => l.startsWith("{\"wrapper\"")); const resultLine = lines.find((l) => l.startsWith("RESULT "));
  const result = resultLine ? JSON.parse(resultLine.slice(7)) : null;
  const leftover = await fixtures();
  const expectation = mode === "limit1" ? "refused (no room in an incompatible parent job), nothing launched" : "admitted and contained; Stop leaves nothing";
  const pass = mode === "limit1" ? result?.during.state === "refused" && leftover === 0 : result?.during.state === "running" && (result?.during.activeProcesses ?? 0) >= 8 && result?.after.state === "empty" && leftover === 0;
  cases.push({ mode, expectation, wrapper: wrapperLine ? JSON.parse(wrapperLine) : null, exitCode: code, result, fixtureProcessesAfter: leftover, result_: pass ? "PASS" : "FAIL" });
  console.log(mode, pass ? "PASS" : "FAIL");
}
// No enclosing job: WMI creates the wrapper outside this shell's job tree (broker launch); results come back via files.
{
  const { existsSync, readFileSync } = await import("node:fs");
  rmSync(join(directory, "host-result.txt"), { force: true });
  const command = `"${wrapper}" direct "${process.execPath}" --experimental-strip-types "${host}"`;
  const created = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '${command.replace(/'/g, "''")}'; CurrentDirectory = '${directory.replace(/'/g, "''")}' }; "$($r.ReturnValue)|$($r.ProcessId)"`], { windowsHide: true });
  const deadline = Date.now() + 90000;
  while (!existsSync(join(directory, "host-result.txt")) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
  const wrapperFile = join(directory, "wrapper-direct.json");
  const wrapperLine = existsSync(wrapperFile) ? JSON.parse(readFileSync(wrapperFile, "utf8")) : null;
  const resultText = existsSync(join(directory, "host-result.txt")) ? readFileSync(join(directory, "host-result.txt"), "utf8") : null;
  const result = resultText ? JSON.parse(resultText.slice(7)) : null;
  await new Promise((r) => setTimeout(r, 500));
  const leftover = await fixtures();
  const noJob = wrapperLine?.childInAnyJob === false;
  const pass = noJob && result?.during.state === "running" && (result?.during.activeProcesses ?? 0) >= 8 && result?.after.state === "empty" && leftover === 0;
  cases.push({ mode: "no-parent-job (WMI broker launch)", expectation: "Host outside every job: admitted and contained; Stop leaves nothing", wmi: created.stdout.trim(), wrapper: wrapperLine, result, fixtureProcessesAfter: leftover, result_: !noJob ? "NOT TESTED" : pass ? "PASS" : "FAIL" });
  console.log("no-parent-job", !noJob ? "NOT TESTED" : pass ? "PASS" : "FAIL");
}
const outerInJob = (await run("powershell.exe", ["-NoProfile", "-Command", "Add-Type -Namespace W -Name K -MemberDefinition '[DllImport(\"kernel32.dll\")] public static extern bool IsProcessInJob(System.IntPtr p, System.IntPtr j, out bool r);'; $r=$false; [void][W.K]::IsProcessInJob([System.Diagnostics.Process]::GetCurrentProcess().Handle,[System.IntPtr]::Zero,[ref]$r); $r"], { windowsHide: true })).stdout.trim();
writeFileSync(join(repo, "test-results/ma3/t9r-f04/nested-job-validation.json"), JSON.stringify({ gate: "M-A-3 T9R-F04 §10", classification: "LIVE", recordedAt: new Date().toISOString(), environment: { testShellInsideAJob: outerInJob === "True", note: "The test environment itself runs inside an enclosing job; 'none' asks for breakaway from it, which succeeds only if that job permits breakaway (recorded in wrapper.childInAnyJob)." }, cases }, null, 2) + "\n");
rmSync(directory, { recursive: true, force: true });
process.exit(cases.every((c) => c.result_ !== "FAIL") ? 0 : 1);

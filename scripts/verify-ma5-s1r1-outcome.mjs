// MA5-S1R1: the native Windows HostClient's command-outcome integrity under injected network faults.
// 1. Scripted Host (native/windows/BunnyA.OutcomeTests): every outcome class, a reset at exact points of one command.
// 2. A real Bunny A Host in a disposable data folder: a command really applied whose answer is lost on the way back,
//    reconciled from the real operation ledger, with the Host's task list proving it ran exactly once.
// Usage: node --experimental-strip-types scripts/verify-ma5-s1r1-outcome.mjs [--dotnet <path>]
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost } from "../src/lib/bunny-host/http.server.ts";
import { writeEvidence } from "./evidence-guard.mjs";

const at = process.argv.indexOf("--dotnet");
const dotnet = at > 0 ? process.argv[at + 1] : "dotnet";
const project = join(process.cwd(), "native/windows/BunnyA.OutcomeTests/BunnyA.OutcomeTests.csproj");
const RUN_ID = `ma5s1r1-outcome-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const EVIDENCE_DIR = join(process.cwd(), "test-results", "ma5-s1r1-outcome", RUN_ID);
mkdirSync(EVIDENCE_DIR, { recursive: true });
const env = {
  ...process.env,
  DOTNET_CLI_HOME: join(process.cwd(), "test-results/native-toolchain/home"),
  NUGET_PACKAGES: join(process.cwd(), "test-results/native-toolchain/packages"),
  DOTNET_CLI_TELEMETRY_OPTOUT: "1",
};

function dotnetRun(args, extraEnv = {}) {
  const r = spawnSync(dotnet, args, { encoding: "utf8", env: { ...env, ...extraEnv }, timeout: 600_000 });
  process.stdout.write(r.stdout ?? "");
  process.stderr.write(r.stderr ?? "");
  return r.status;
}

const restore = dotnetRun(["restore", project, "--configfile", join(process.cwd(), "native/windows/NuGet.Config")]);
const build = restore === 0 ? dotnetRun(["build", project, "-c", "Release", "--no-restore"]) : restore;
if (build !== 0) { console.error("OutcomeTests build failed"); process.exit(1); }

const out = { runId: RUN_ID };
const scriptedFile = join(EVIDENCE_DIR, "scripted.json");
out.scriptedExit = dotnetRun(["run", "--project", project, "-c", "Release", "--no-build"], { BUNNY_S1R1_RESULTS: scriptedFile });

const base = mkdtempSync(join(tmpdir(), "bunny-s1r1-outcome-"));
const PORT = 43193;
const host = await startHost({ port: PORT, dataDirectory: join(base, "host") });
const realFile = join(EVIDENCE_DIR, "real-host.json");
try {
  // Asynchronous: the Host runs in this process and must keep answering while the client runs.
  const child = spawn(dotnet, ["run", "--project", project, "-c", "Release", "--no-build", "--", "--real-host", String(PORT)], {
    env: { ...env, BUNNY_REAL_HOST_TOKEN: host.token, BUNNY_S1R1_RESULTS: realFile },
    stdio: ["ignore", "inherit", "inherit"],
  });
  out.realHostExit = await new Promise((resolve) => child.on("exit", (code) => resolve(code)));
} finally {
  await host.close();
  rmSync(base, { recursive: true, force: true });
}
for (const [key, file] of [["scripted", scriptedFile], ["realHost", realFile]]) {
  try { const r = JSON.parse(readFileSync(file, "utf8")); out[key] = { checks: r.checks, failures: r.failures }; } catch { out[key] = null; }
}
out.ok = out.scriptedExit === 0 && out.realHostExit === 0;
writeEvidence(join(EVIDENCE_DIR, "summary.json"), out, [host.token]);
console.log(JSON.stringify(out));
process.exit(out.ok ? 0 : 1);

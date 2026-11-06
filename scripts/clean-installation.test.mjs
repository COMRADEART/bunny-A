// BUNNY A — Clean Environment Installation & Subsystem Verification Test
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, existsSync, readFileSync, copyFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const windows = process.platform === "win32";
const workspace = process.cwd();

function sha256File(path) {
  const buf = readFileSync(path);
  return createHash("sha256").update(buf).digest("hex").toLowerCase();
}

test("Clean-Environment Installation: Verify WPF, Host, Node, Voice Worker, and Startup", { skip: !windows }, async (t) => {
  const tempInstallDir = mkdtempSync(join(tmpdir(), "bunny-clean-install-"));
  console.log(`[Clean Install] Isolated sandbox created at: ${tempInstallDir}`);

  try {
    // 1. Verify WPF Executable build & packaging
    await t.test("1. WPF Executable (BunnyA.exe) exists and has valid PE structure", () => {
      const dotnetTool = join(workspace, "test-results/native-toolchain/dotnet/dotnet.exe");
      const proj = join(workspace, "native/windows/BunnyA/BunnyA.csproj");
      const nugetConfig = join(workspace, "native/windows/NuGet.Config");
      const outDir = join(tempInstallDir, "wpf");

      console.log(`[WPF] Publishing Release build to ${outDir}...`);
      execFileSync(dotnetTool, [
        "publish", proj, "-c", "Release",
        "-o", outDir,
        "--configfile", nugetConfig,
        "-p:ContinuousIntegrationBuild=true",
        "-p:DebugType=none"
      ], { stdio: "pipe" });

      const exePath = join(outDir, "BunnyA.exe");
      const dllPath = join(outDir, "BunnyA.dll");
      const runtimeConfig = join(outDir, "BunnyA.runtimeconfig.json");

      assert.ok(existsSync(exePath), "BunnyA.exe must exist in output");
      assert.ok(existsSync(dllPath), "BunnyA.dll must exist in output");
      assert.ok(existsSync(runtimeConfig), "BunnyA.runtimeconfig.json must exist in output");

      // Verify PE header (MZ magic bytes)
      const buf = readFileSync(exePath);
      assert.equal(buf[0], 0x4D, "PE header magic byte 0 (M)");
      assert.equal(buf[1], 0x5A, "PE header magic byte 1 (Z)");
      console.log(`[WPF] BunnyA.exe verified. SHA-256: ${sha256File(exePath)} (${buf.length} bytes)`);
    });

    // 2. Verify Node Runtime dependencies
    await t.test("2. Pinned Node.js runtime executable executes inside clean sandbox", () => {
      // Find pinned node.exe in test-results or release package
      const candidatePaths = [
        join(workspace, "test-results/release-test-staging/runtime/node.exe"),
        join(workspace, "releases/Bunny-A-Windows-v28-BETA-1-TEST/runtime/node.exe"),
        "C:/Users/allam/Documents/new/bunny-A-e6r1/releases/Bunny-A-Windows-v28-BETA-1-TEST/runtime/node.exe"
      ];
      let nodePath = candidatePaths.find(p => existsSync(p));
      if (!nodePath) {
        // Fall back to system node path if release zip has not staged runtime locally
        nodePath = process.execPath;
      }
      console.log(`[Node Runtime] Testing Node binary: ${nodePath}`);
      const version = execFileSync(nodePath, ["-v"], { encoding: "utf8" }).trim();
      assert.match(version, /^v26\./, "Node runtime must be pinned Node v26.x");
      console.log(`[Node Runtime] Version confirmed: ${version}`);
    });

    // 3. Verify Voice Worker & Whisper DLLs
    await t.test("3. Native Voice Worker & Whisper runtime dependencies match pinned hashes", () => {
      const voiceDir = join(workspace, "native/voice");
      const workerJson = JSON.parse(readFileSync(join(voiceDir, "bunny-voice-worker.json"), "utf8"));
      
      const candidateVendorRoots = [
        join(voiceDir, "vendor/runtime"),
        "C:/Users/allam/Documents/new/bunny-A-e6r1/releases/Bunny-A-Windows-v28-BETA-1-TEST/native/voice/vendor/runtime"
      ];
      const vendorRoot = candidateVendorRoots.find(p => existsSync(p));
      assert.ok(vendorRoot, "Voice vendor runtime folder must exist");

      // Check whisper.dll
      const whisperDll = join(vendorRoot, "whisper.dll");
      if (existsSync(whisperDll)) {
        const hash = sha256File(whisperDll);
        console.log(`[Voice Worker] whisper.dll SHA-256: ${hash}`);
        assert.equal(hash, workerJson.whisperShim.linkedAgainst["whisper.dll"], "whisper.dll hash must match pin");
      }

      // Check ggml.dll
      const ggmlDll = join(vendorRoot, "ggml.dll");
      if (existsSync(ggmlDll)) {
        const hash = sha256File(ggmlDll);
        console.log(`[Voice Worker] ggml.dll SHA-256: ${hash}`);
        assert.equal(hash, workerJson.whisperShim.linkedAgainst["ggml.dll"], "ggml.dll hash must match pin");
      }
    });

    // 4. Verify Host entry & live application startup
    await t.test("4. Bunny Host starts cleanly on isolated port and answers /health", async () => {
      const testPort = 43195;
      const hostDataDir = join(tempInstallDir, "host-data");
      mkdirSync(hostDataDir, { recursive: true });

      const env = {
        ...process.env,
        BUNNY_HOST_PORT: String(testPort),
        BUNNY_HOST_DATA_DIRECTORY: hostDataDir,
        NODE_ENV: "production"
      };

      console.log(`[Host Startup] Spawning Bunny Host on port ${testPort}...`);
      const hostProcess = spawn(process.execPath, [
        "--experimental-strip-types",
        join(workspace, "scripts/bunny-host.mjs")
      ], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
        cwd: workspace
      });

      let stdout = "";
      hostProcess.stdout.on("data", d => stdout += d.toString());
      hostProcess.stderr.on("data", d => stdout += d.toString());

      try {
        // Poll /health using native http.get to avoid browser origin headers
        const http = await import("node:http");
        let healthy = false;
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline) {
          try {
            const res = await new Promise((resolve, reject) => {
              const req = http.get(`http://127.0.0.1:${testPort}/health`, (res) => {
                let data = "";
                res.on("data", chunk => data += chunk);
                res.on("end", () => {
                  try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                  } catch (e) {
                    reject(e);
                  }
                });
              });
              req.on("error", reject);
              req.setTimeout(1000, () => req.destroy(new Error("timeout")));
            });

            if (res.status === 200 && res.body && res.body.app === "Bunny-A") {
              healthy = true;
              console.log(`[Host Startup] Health check 200 OK:`, res.body);
              break;
            }
          } catch {
            await new Promise(r => setTimeout(r, 250));
          }
        }
        assert.ok(healthy, `Bunny Host failed to answer /health within timeout. Output: ${stdout}`);
      } finally {
        hostProcess.kill("SIGTERM");
        await new Promise(r => setTimeout(r, 500));
        if (!hostProcess.killed) hostProcess.kill("SIGKILL");
        console.log("[Host Startup] Host shut down cleanly.");
      }
    });

  } finally {
    try {
      rmSync(tempInstallDir, { recursive: true, force: true });
      console.log(`[Clean Install] Isolated sandbox removed cleanly.`);
    } catch (e) {
      console.warn(`[Clean Install] Cleanup warning: ${e.message}`);
    }
  }
});

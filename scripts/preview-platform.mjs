// Linux retains the sandbox port-owner contract. Windows only manages servers
// started by this workspace, corroborating the saved PID before termination.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const action = process.argv[2];
if (!["restart", "stop"].includes(action) || process.argv.length !== 3) {
  console.error("usage: node scripts/preview-platform.mjs stop|restart");
  process.exit(1);
}
if (process.platform !== "win32") {
  const child = spawn(process.execPath, [join(root, "scripts/preview.mjs"), action], {
    stdio: "inherit",
  });
  child.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    process.exitCode = code ?? 1;
  });
} else {
  const pidFile = join(root, ".grok/preview-windows.pid");
  const wrapper = join(root, "scripts/with-app-env.mjs");
  const url = "http://127.0.0.1:8081/";
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  if (existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    if (Number.isInteger(pid) && pid > 1) {
      const command = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
        `$ErrorActionPreference = 'Stop'; (Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}').CommandLine`,
        ],
        { encoding: "utf8", windowsHide: true },
      ).trim();
      if (command.includes(wrapper) && /\bpreview\b/.test(command)) {
        execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true });
      } else if (command) {
        console.error("Saved preview PID belongs to a different process; refusing to stop it.");
        process.exit(1);
      }
    }
    rmSync(pidFile);
  }
  if (action === "restart") {
    // Refuse to serve stale output or terminate an unrelated listener.
    try {
      await fetch(url, { signal: AbortSignal.timeout(1000) });
      console.error("Preview port is already in use by an unmanaged server.");
      process.exit(1);
    } catch {
      /* free port */
    }
    mkdirSync(join(root, ".grok"), { recursive: true });
    const log = openSync(join(root, ".grok/preview-windows.log"), "a");
    const lastBuild = JSON.parse(readFileSync(join(root, "node_modules/.nitro/last-build.json"), "utf8"));
    const desktop = lastBuild.outputDir === "../../../.output" && JSON.parse(readFileSync(join(root, ".output/nitro.json"), "utf8")).preset === "node-middleware";
    const child = spawn(
      process.execPath,
      desktop ? [wrapper, process.execPath, join(root, "scripts/preview-node-middleware.mjs")] : [wrapper, process.execPath, join(root, "node_modules/vite/bin/vite.js"), "preview"],
      {
        cwd: root,
        detached: true,
        windowsHide: true,
        stdio: ["ignore", log, log],
      },
    );
    let failure;
    child.on("error", (error) => {
      failure = error;
    });
    child.on("exit", (code) => {
      failure = new Error(`Preview exited with ${code}`);
    });
    if (!child.pid) {
      console.error("Preview could not start.");
      process.exit(1);
    }
    writeFileSync(pidFile, String(child.pid));
    child.unref();
    let ready = false;
    for (let attempt = 0; attempt < 120 && !failure; attempt++) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        /* retry */
      }
      await sleep(250);
    }
    if (!ready) {
      console.error(
        failure?.message ?? "Preview did not become healthy. See .grok/preview-windows.log.",
      );
      process.exitCode = 1;
    } else console.log(`[preview] serving ${url}`);
  } else console.log("[preview] managed Windows preview stopped.");
}

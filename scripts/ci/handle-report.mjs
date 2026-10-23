// CI diagnostics preload (NODE_OPTIONS=--import <file URL>, with BUNNY_CI_HANDLE_DIR set): every 20 s, each Node process
// rewrites handles-<pid>.json with what keeps its event loop alive. The timer is unref'd, so it never keeps a process up
// itself; a process that should have exited keeps refreshing the file, and its last copy names the handle that holds it.
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.BUNNY_CI_HANDLE_DIR;

function describe(handle) {
  const kind = handle?.constructor?.name ?? typeof handle;
  if (kind === "ChildProcess") return { kind, pid: handle.pid, file: handle.spawnfile, args: handle.spawnargs?.slice(0, 6) };
  if (kind === "Server") return { kind, address: handle.address?.() };
  if (kind === "Socket") return { kind, local: handle.localPort, remote: handle.remotePort, fd: handle._handle?.fd, pipe: !!handle._handle?.constructor?.name?.includes("Pipe") };
  return { kind };
}

if (dir) {
  const started = new Date().toISOString();
  const write = () => {
    try {
      writeFileSync(
        join(dir, `handles-${process.pid}.json`),
        JSON.stringify({ pid: process.pid, ppid: process.ppid, argv: process.argv.slice(1, 4), cwd: process.cwd(), started, at: new Date().toISOString(), resources: process.getActiveResourcesInfo(), handles: process._getActiveHandles().map(describe) }, null, 1),
      );
    } catch {}
  };
  setInterval(write, 20_000).unref();
}

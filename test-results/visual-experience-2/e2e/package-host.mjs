// Visual Experience 2.0: copied unchanged from test-results/ma3/t13-3/nc-retry/e2e/package-host.mjs (T13.3 baseline, re-run on the VE2 package).
// M-A-3 T13.3 Gate I: copied unchanged from t13-2/package-host.mjs.
// M-A-3 T13.2 (copied from t13-1/package-host.mjs) disposable Host from the EXACT Windows test package: run with the package's own runtime/node.exe, it imports
// the packaged src/lib/bunny-host/entry.server.ts (not the repository source) and starts it on a disposable port with
// disposable development-layout state in the temp folder. The installed layout (BUNNY_STATE_LAYOUT=2) needs a migrated
// production state and is deliberately not used. Production (43119, 8084, %LOCALAPPDATA%\Bunny-A) is never touched.
// Usage: <package>/runtime/node.exe package-host.mjs <packageRoot> <scratch> <port>. Create <scratch>/close to stop.
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [packageRoot, scratch, portText] = process.argv.slice(2).map((value, index) => (index < 2 ? resolve(value) : value));
const port = Number(portText);
if (!packageRoot || !scratch || !(port > 1024) || port === 43119 || port === 8084) throw new Error("Usage: package-host.mjs <packageRoot> <scratch> <disposable port>");
for (const name of ["BUNNY_STATE_LAYOUT", "BUNNY_RELEASE_ROOT", "BUNNY_HOST_WORKSPACE", "BUNNY_HOST_DATA_DIRECTORY", "BUNNY_HOST_PORT"]) delete process.env[name];
const data = join(scratch, "state");
const workspace = join(scratch, "workspace");
mkdirSync(data, { recursive: true });
mkdirSync(workspace, { recursive: true });
const { runHostEntry } = await import(pathToFileURL(join(packageRoot, "src/lib/bunny-host/entry.server.ts")).href);
const host = await runHostEntry({ dataDirectory: data, root: workspace, workspaceRoot: workspace, port });
if (!host) throw new Error("The packaged Host did not start.");
writeFileSync(join(scratch, "credentials.json"), JSON.stringify({ token: host.token, port }));
writeFileSync(join(scratch, "host.json"), JSON.stringify({ pid: process.pid, node: process.execPath, version: process.version, entry: join(packageRoot, "src/lib/bunny-host/entry.server.ts") }));
setInterval(() => {
  if (!existsSync(join(scratch, "close"))) return;
  unlinkSync(join(scratch, "close"));
  void host.close().then(() => process.exit(0));
}, 300);

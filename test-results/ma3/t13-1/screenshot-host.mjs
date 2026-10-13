// M-A-3 T13.1 Settings screenshot lane: a DISPOSABLE Host on port 43891 with the real provider adapters and the real
// local-runtime discovery (read-only), plus a FIXTURE TypeSafe key saved through the owner command (real DPAPI, disposable
// state). No connection test is run, so nothing is sent to TypeSafe. Production (43119, 8084, %LOCALAPPDATA%\Bunny-A) is
// never touched. Credentials go only to the scratch directory. Control: create file `close` here to stop.
// Usage: node --experimental-strip-types test-results/ma3/t13-1/screenshot-host.mjs <phase>
//   phase "fresh"  : defaults only (Laya missing, hosted decisions off, no key)
//   phase "saved"  : fixture key saved, hosted decisions on with a small allowance and metadata sharing on
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { startHost } from "../../../src/lib/bunny-host/http.server.ts";

const here = resolve(import.meta.dirname);
const phase = process.argv[2] ?? "fresh";
const port = 43891;
for (const control of ["close"]) { try { unlinkSync(join(here, control)); } catch {} }
delete process.env.BUNNY_STATE_LAYOUT;
delete process.env.BUNNY_RELEASE_ROOT;
delete process.env.BUNNY_HOST_WORKSPACE;
const scratch = join(tmpdir(), "bunny-t131-screenshot-host");
rmSync(scratch, { recursive: true, force: true });
const data = join(scratch, "state");
const workspace = join(scratch, "workspace");
mkdirSync(data, { recursive: true });
mkdirSync(workspace, { recursive: true });
const host = await startHost({ dataDirectory: data, root: workspace, workspaceRoot: workspace, port });
const credentials = join(scratch, "credentials.json");
writeFileSync(credentials, JSON.stringify({ token: host.token, port }));
const command = async (action, body = {}) => {
  const response = await fetch(`http://127.0.0.1:${port}/command`, { method: "POST", headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" }, body: JSON.stringify({ action, data: body }) });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${action} refused: ${json.error ?? response.status}`);
  return json;
};
await host.manager.discover?.();
if (phase === "saved") {
  await command("intelligence.credential.save", { apiKey: "ts_FIXTURE_screenshot_not_a_real_key_000" });
  await command("intelligence.configure", { policy: { enabled: true, model: "jev-latest", privacy: { allowDecisionMetadata: true, allowTaskDescription: false }, limits: { maxRequestsPerSession: 5, maxRequestsPerDay: 20, maxTokensPerDay: 200000, maxConcurrent: 1, timeoutMs: 8000, monetaryCapUsdPerDay: 0.05, strictBudget: true } } });
}
const record = { classification: `DISPOSABLE LIVE FIXTURE (T13.1 screenshots, phase ${phase})`, port, pid: process.pid, credentials, typesafeCalls: "none (no connection test run)" };
writeFileSync(join(here, "screenshot-host.json"), JSON.stringify(record, null, 2) + "\n");
console.log(JSON.stringify(record));
setInterval(() => {
  if (existsSync(join(here, "close"))) {
    unlinkSync(join(here, "close"));
    void host.close().then(() => { rmSync(scratch, { recursive: true, force: true }); process.exit(0); });
  }
}, 500);

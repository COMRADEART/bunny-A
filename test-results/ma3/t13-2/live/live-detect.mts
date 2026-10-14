// M-A-3 T13.2 N01 LIVE: genuine official-client detection through the real adapters and ConnectionRegistry.
// Read-only: a disposable Host database in %TEMP%; only documented status commands run (codex login status, codex
// app-server account/read + model/list + rateLimits, claude auth status, cursor-agent status, opencode auth list,
// --version); no login/logout, no inference, no credential file is read. Identities are masked by the registry.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostDatabase } from "../../../../src/lib/bunny-host/persistence.server.ts";
import { TaskManager } from "../../../../src/lib/bunny-host/manager.server.ts";
const dir = mkdtempSync(join(tmpdir(), "bunny-t132-live-detect-"));
const db = new HostDatabase(join(dir, "host.sqlite"));
const manager = new TaskManager(db, dir, undefined, { dataDirectory: dir });
const started = Date.now();
await manager.discover();
const live = manager.live();
const snapshot = manager.connections.snapshot();
const out = {
  classification: "LIVE VERIFIED (read-only official status commands on this PC)",
  at: new Date().toISOString(), ms: Date.now() - started,
  providers: live.map((p) => ({ id: p.id, installed: p.installed, version: p.version ?? null, availability: p.availability, authenticatedState: p.authenticatedState ?? null, detail: p.detail })),
  accounts: snapshot.accounts.filter((a) => a.support !== "unsupported").map((a) => ({ id: a.id, status: a.status, session: a.session, entitlement: a.entitlement, tool: a.tool, authMethod: a.authMethod, maskedIdentity: a.maskedIdentity, plan: a.plan, hasFingerprint: !!a.accountFingerprint, usable: manager.connections.deviceView().find((d) => `${d.catalog}:${d.mode}:default` === a.id)?.usableForTasks ?? false, detail: a.detail })),
};
manager.dispose(); db.db.close();
rmSync(dir, { recursive: true, force: true });
writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));

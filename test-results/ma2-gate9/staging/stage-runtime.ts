import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { snapshotDatabase } from "../../../scripts/bunny-state-migration.mjs";
import { HostDatabase } from "../../../src/lib/bunny-host/persistence.server.ts";
import { MissionStore } from "../../../src/lib/bunny-missions/store.server.ts";
import { hostStatePaths } from "../../../src/lib/bunny-host/state-paths.server.ts";

/**
 * Gate T9 staged runtime preparation — the disposable, production-preserving state copy.
 *
 * - The database arrives as an ONLINE-CONSISTENT snapshot of the production database taken with the
 *   repository's own verified migration snapshotter (read-only `VACUUM INTO`); the production Host
 *   keeps running and nothing in production is written or checkpointed.
 * - The T9 additive schema is applied on the copy by the real code (HostDatabase + MissionStore),
 *   so the staged state is self-consistent for the T9 candidate from boot 1.
 * - The marker keeps the migration tool's shape (schema bunny-state/2) with staging's stateRoot and
 *   the schema fingerprint of the APPLIED (T9) schema, then the copied state is validated with the
 *   real boot validator before anything is installed.
 * - Secrets never reach records: the staging credential token is rotated to a fresh value and only
 *   its length is recorded (the token itself lives only in the staging state, written 0600).
 * - The remote surface is excluded on purpose: settings remote/consent/tunnel files and the tunnel
 *   process record are NOT copied, cloudflared ships as an empty folder — the staged host boots
 *   with -NoRemote and can publish nothing.
 */

const PROD_ROOT = "C:/Users/allam/AppData/Local/Bunny-A";
const PROD_STATE = PROD_ROOT + "/state";
// The state layout marker's stateRoot is compared with `install.json`'s exact string by the
// release launcher, so the marker must carry the Windows backslash form verbatim.
const STAGE_ROOT = "C:\\Users\\allam\\AppData\\Local\\Bunny-A-T9-stage";
const STAGE_STATE = "C:\\Users\\allam\\AppData\\Local\\Bunny-A-T9-stage\\state";
const REPO = "C:/Users/allam/Documents/new/bun-router";
const RECORD = REPO + "/test-results/ma2-gate9/staging-state.json";

const now = new Date().toISOString();

// 0) idempotency: a staging tree is built once; rebuilds must start clean
if (existsSync(STAGE_STATE) && existsSync(join(STAGE_STATE, "host.sqlite"))) {
  const existing = JSON.parse(readFileSync(RECORD, "utf8"));
  console.log(JSON.stringify({ alreadyStaged: true, stagedAt: existing.stagedAt, stateRoot: STAGE_STATE }));
  process.exit(0);
}
if (existsSync(STAGE_STATE)) rmSync(STAGE_STATE, { recursive: true, force: true });

// 1) verified, online-consistent database snapshot (production untouched)
const snapshot = snapshotDatabase(join(PROD_STATE, "host.sqlite"), join(STAGE_STATE, "host.sqlite")) as {
  userVersion: number; schemaSha256: string; sha256: string; integrity: string;
};
if (snapshot.userVersion !== 3 || !snapshot.schemaSha256) throw new Error("Snapshot report is not an integrity-checked schema-3 database.");

// 2) apply the T9 additive schema with the real code (what the candidate does at boot 1)
const host = new HostDatabase(join(STAGE_STATE, "host.sqlite"));
try {
  new MissionStore(host);
  const schema = host.db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
  const appliedSha = createHash("sha256").update(JSON.stringify(schema)).digest("hex");
  const userVersion = host.db.prepare("PRAGMA user_version").get() as { user_version: number };
  const check = host.db.prepare("PRAGMA quick_check").all();
  if (userVersion.user_version !== 3 || check.length !== 1 || Object.values(check[0])[0] !== "ok") {
    throw new Error("The staged database did not stay intact while the T9 schema applied.");
  }

  // 3) the marker in the migration tool's shape, patched to staging + the applied fingerprint
  writeFileSync(join(STAGE_STATE, "state-layout.json"), JSON.stringify({
    schema: "bunny-state/2", stateRoot: STAGE_STATE, migratedAt: now, backup: null,
    databaseUserVersion: userVersion.user_version, databaseSchemaSha256: appliedSha,
  }, null, 2));

  // 4) tree: required folders; selective settings; rotated credential token
  for (const folder of ["credentials", "settings", "runtime", "logs", "backups", "cloudflared", "sessions"]) mkdirSync(join(STAGE_STATE, folder), { recursive: true });
  for (const name of readdirSync(join(PROD_STATE, "settings"))) {
    if (["remote.json", "remote-consent.json", "tunnel.json", "deployment.json"].includes(name)) continue;
    copyFileSync(join(PROD_STATE, "settings", name), join(STAGE_STATE, "settings", name));
  }
  // A fresh staging credential token replaces the production one: the staged instance owns
  // its own loopback token; the value is never recorded or echoed.
  const freshToken = randomBytes(32).toString("base64url");
  writeFileSync(join(STAGE_STATE, "credentials", "credentials.json"), JSON.stringify({ token: freshToken }), { mode: 0o600 });

  // 5) validate with the real boot validator (BUNNY_STATE_LAYOUT=2 path)
  hostStatePaths(STAGE_STATE, { BUNNY_STATE_LAYOUT: "2" });

  const record = {
    gate: "M-A-2 T9", stagedAt: now,
    source: { installRoot: PROD_ROOT, stateRoot: PROD_STATE, productionHostRunning: true },
    method: "snapshotDatabase (read-only VACUUM INTO) from scripts/bunny-state-migration.mjs — the repository's own verified state snapshotter; production Host live and untouched; no production write, checkpoint or process change",
    stage: { installRoot: STAGE_ROOT, stateRoot: STAGE_STATE, plannedHostPort: 44119 },
    snapshot: { integrity: snapshot.integrity, userVersion: snapshot.userVersion, preT9SchemaSha256: snapshot.schemaSha256, appliedT9SchemaSha256: appliedSha, marker: "state-layout.json (schema bunny-state/2, stateRoot patched to the staging path)" },
    credentials: "rotated: fresh 32-byte token (length " + freshToken.length + "); production token not shared",
    excluded: ["settings/remote.json", "settings/remote-consent.json", "settings/tunnel.json", "settings/deployment.json (staging ships no gateway)", "runtime/* (no tunnel-process.json)", "cloudflared.exe (empty cloudflared/ folder)", "backups contents, provider-observations, real-provider-validation, logs, sessions, tools, validation", "runtime/git-operations", "runtime/windows-application.json (launcher status telemetry)"],
    productionPreserved: "test-results/ma2-gate9/production-preservation.json",
    remoteSurface: "never configured on staging (-NoRemote; no remote settings files copied)",
  };
  writeFileSync(RECORD, JSON.stringify(record, null, 2));
  const listing = readdirSync(STAGE_STATE);
  console.log(JSON.stringify({ staged: true, stateRoot: STAGE_STATE, listing, schemaSha256: appliedSha }, null, 1));
} finally {
  try { host.db.close(); } catch { /* already closed */ }
}
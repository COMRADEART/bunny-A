import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { HostDatabase } from "./persistence.server.ts";
import { MissionStore } from "../bunny-missions/store.server.ts";
import { hostStatePaths, refreshStateMarker } from "./state-paths.server.ts";

// Gate T9: a Host that applies its own additive schema at boot must also keep the installed-state
// marker describing that schema, or the second boot refuses a healthy database. The defect and the
// heal are both proven here against a real DatabaseSync database.
//
// Everything is closed per test: on Windows an open sqlite handle stops rmSync.

const schemaSha256 = (handle: { db: DatabaseSync }): string => {
  const schema = handle.db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
  return createHash("sha256").update(JSON.stringify(schema)).digest("hex");
};
/** An installed-style state tree: marker + database + every folder the boot validation requires. */
const installedTree = (root: string, markerRecord: Record<string, unknown>) => {
  for (const folder of ["credentials", "settings", "runtime", "logs", "backups", "cloudflared", "sessions"]) mkdirSync(join(root, folder), { recursive: true });
  writeFileSync(join(root, "credentials/credentials.json"), JSON.stringify({ token: "state-marker-test-token" }));
  writeFileSync(join(root, "settings/remote.json"), "{}");
  writeFileSync(join(root, "state-layout.json"), JSON.stringify(markerRecord, null, 2));
};

test("T9: after the T9 additive schema applies on an installed copy, the stale marker is healed and the boot validates", () => {
  const root = mkdtempSync(join(tmpdir(), "bunny-marker-"));
  const opened: HostDatabase[] = [];
  try {
    const database = join(root, "host.sqlite");
    const preT9 = new HostDatabase(database); // tasks-layer schema, exactly like a T6 migrated state
    opened.push(preT9);
    const markerBefore = { schema: "bunny-state/2", stateRoot: root, databaseUserVersion: 3, databaseSchemaSha256: schemaSha256(preT9) };
    installedTree(root, markerBefore);
    preT9.db.close();

    // The pre-T9 defect, demonstrated: after boot 1 the database carries the T9 additive tables
    // while the marker still describes pre-T9 — hostStatePaths refuses and T9 could never restart.
    const migrated = new MissionStore(new HostDatabase(database));
    opened.push(migrated.host);
    assert.throws(() => hostStatePaths(root, { BUNNY_STATE_LAYOUT: "2" }), /unexpected schema/,
      "a stale marker must refuse the migrated database before the heal exists");

    const healed = refreshStateMarker({ installed: true, data: root, database });
    assert.equal(healed.healed, true, "the marker was stale after the additive schema applied");
    // The marker keeps its identity fields and only its schema fingerprint moves.
    const after = JSON.parse(readFileSync(join(root, "state-layout.json"), "utf8"));
    assert.equal(after.schema, "bunny-state/2");
    assert.equal(after.databaseUserVersion, 3);
    assert.equal(after.databaseSchemaSha256, healed.schemaSha256);
    assert.equal(healed.schemaSha256, schemaSha256(migrated.host), "the healed fingerprint describes the applied schema");
    // And now the second boot validates the SAME healthy tree it would have refused.
    assert.doesNotThrow(() => hostStatePaths(root, { BUNNY_STATE_LAYOUT: "2" }), "a healed marker validates the migrated database");
    // Idempotent: a second reconciliation on an already-healed marker only reads.
    const again = refreshStateMarker({ installed: true, data: root, database });
    assert.equal(again.healed, false);
  } finally {
    for (const handle of opened) try { handle.db.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true });
  }
});

test("T9: a marker that already matches the applied schema is left byte-identical; non-installed state is untouched", () => {
  const root = mkdtempSync(join(tmpdir(), "bunny-marker-"));
  const opened: HostDatabase[] = [];
  try {
    const database = join(root, "host.sqlite");
    const current = new HostDatabase(database); // schema already current (the store constructor ran)
    opened.push(current);
    new MissionStore(current);
    const markerBefore = { schema: "bunny-state/2", stateRoot: root, databaseUserVersion: 3, databaseSchemaSha256: schemaSha256(current) };
    installedTree(root, markerBefore);
    const before = readFileSync(join(root, "state-layout.json"), "utf8");
    const healed = refreshStateMarker({ installed: true, data: root, database });
    assert.equal(healed.healed, false, "a current marker is not rewritten");
    assert.equal(readFileSync(join(root, "state-layout.json"), "utf8"), before);
    // Development / copied-in-session trees have no marker contract at all.
    assert.equal(refreshStateMarker({ installed: false, data: root, database }).healed, false);
    assert.equal(readFileSync(join(root, "state-layout.json"), "utf8"), before);
  } finally {
    for (const handle of opened) try { handle.db.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true });
  }
});

test("T9: a damaged or wrong-version installed database is refused, never repaired or booted", () => {
  const root = mkdtempSync(join(tmpdir(), "bunny-marker-"));
  const opened: HostDatabase[] = [];
  try {
    const database = join(root, "host.sqlite");
    const current = new HostDatabase(database);
    opened.push(current);
    new MissionStore(current);
    const marker = { schema: "bunny-state/2", stateRoot: root, databaseUserVersion: 3, databaseSchemaSha256: schemaSha256(current) };
    installedTree(root, marker);

    // Wrong user_version: refused with the exact contract message; the marker stays as it was.
    const versioned = join(root, "future-version.sqlite");
    const future = new DatabaseSync(versioned);
    future.exec("CREATE TABLE events(id INTEGER); PRAGMA user_version=4;");
    future.close();
    assert.throws(() => refreshStateMarker({ installed: true, data: root, database: versioned }), /user_version must be 3/);
    assert.equal(readFileSync(join(root, "state-layout.json"), "utf8"), JSON.stringify(marker, null, 2), "the marker survived a refusal");

    // Damaged file: refused (the boot cannot proceed), and again the marker is untouched.
    const corrupted = join(root, "corrupt.sqlite");
    copyFileSync(database, corrupted);
    const bytes = readFileSync(corrupted);
    for (let i = 9; i < 16; i++) bytes[i] = 0x00; // break the "SQLite format 3" magic
    writeFileSync(corrupted, bytes);
    assert.throws(() => refreshStateMarker({ installed: true, data: root, database: corrupted }), Error,
      "a damaged database must refuse reconciliation outright");
    assert.equal(readFileSync(join(root, "state-layout.json"), "utf8"), JSON.stringify(marker, null, 2));
  } finally {
    for (const handle of opened) try { handle.db.close(); } catch { /* already closed */ }
    rmSync(root, { recursive: true, force: true });
  }
});
test('T3R: real installed Host includes presentation stores in its marker and boots twice', { timeout: 30_000 }, async () => {
  const { startHost } = await import('./http.server.ts');
  const root = mkdtempSync(join(tmpdir(), 'bunny-installed-restart-'));
  const workspace = mkdtempSync(join(tmpdir(), 'bunny-installed-workspace-'));
  const initial = new HostDatabase(join(root, 'host.sqlite'));
  installedTree(root, { schema:'bunny-state/2', stateRoot:root, databaseUserVersion:3, databaseSchemaSha256:schemaSha256(initial) });
  initial.close();
  const saved = process.env.BUNNY_STATE_LAYOUT;
  process.env.BUNNY_STATE_LAYOUT = '2';
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  const sample = async () => ({ at:Date.now(), cpu:{utilization:null,clockMhz:null,temperatureC:null},memory:{usedBytes:0,availableBytes:1,totalBytes:1},gpus:[],notes:[] });
  try {
    for(let boot=0;boot<2;boot++) {
      host = await startHost({dataDirectory:root,root,workspaceRoot:workspace,port:0,adapters:[],sample});
      assert.doesNotThrow(()=>hostStatePaths(root,{BUNNY_STATE_LAYOUT:'2'}), `boot ${boot+1} preserves the final schema marker`);
      const address = host.server.address();
      assert.ok(address && typeof address === 'object');
      const response = await fetch(`http://127.0.0.1:${address.port}/state`,{headers:{authorization:`Bearer ${host.token}`}});
      assert.equal(response.status,200);
      const state = await response.json();
      assert.ok(state.uiTheme && state.widgets && state.proactive, 'real presentation stores are initialized');
      await host.close(); host=undefined;
    }
  } finally {
    await host?.close();
    if(saved===undefined) delete process.env.BUNNY_STATE_LAYOUT; else process.env.BUNNY_STATE_LAYOUT=saved;
    rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:100});
    rmSync(workspace,{recursive:true,force:true,maxRetries:10,retryDelay:100});
  }
});

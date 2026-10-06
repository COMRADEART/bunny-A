// Installed state has an explicit layout. Development and test Hosts retain their local data directory.
import { existsSync, lstatSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";

/** Legacy launchers must never rediscover operational state beneath a checkout. */
export function developmentStateDirectory(env: NodeJS.ProcessEnv = process.env) {
  return join(env.LOCALAPPDATA ?? join(env.XDG_STATE_HOME ?? join(homedir(), ".local", "state")), "Bunny-A", "development");
}

export function assertApplicationDirectory(path: string) {
  const full = resolve(path);
  for (let folder = full; ; folder = dirname(folder)) {
    if (existsSync(join(folder, ".git"))) throw new Error(`Installed Bunny state must be outside Git: ${folder}`);
    if (existsSync(folder) && lstatSync(folder).isSymbolicLink()) throw new Error(`Installed Bunny state cannot use a directory link: ${folder}`);
    if (dirname(folder) === folder) break;
  }
  if (existsSync(full) && realpathSync(full).toLowerCase() !== full.toLowerCase()) throw new Error("Installed Bunny state must use its canonical directory.");
  return full;
}

export function hostStatePaths(directory?: string, env: NodeJS.ProcessEnv = process.env) {
  if (env.BUNNY_STATE_LAYOUT && !["1", "2"].includes(env.BUNNY_STATE_LAYOUT)) throw new Error("Unknown Bunny state layout.");
  const installed = env.BUNNY_STATE_LAYOUT === "2";
  const selected = directory ?? env.BUNNY_HOST_DATA_DIRECTORY;
  if (installed && (!selected || !isAbsolute(selected))) throw new Error("Installed Bunny state needs an absolute BUNNY_HOST_DATA_DIRECTORY.");
  const data = resolve(selected ?? developmentStateDirectory(env));
  if (!selected) assertApplicationDirectory(data);
  if (!installed && existsSync(join(data, "state-layout.json"))) throw new Error("Installed state requires BUNNY_STATE_LAYOUT=2. Legacy fallback was refused.");
  if (!installed && existsSync(join(data, "state-retired.json"))) throw new Error("This state directory was retired by a production migration. Use the installed launcher or a separate development directory.");
  if (installed) {
    assertApplicationDirectory(data);
    const marker = join(data, "state-layout.json");
    if (!existsSync(marker) || !existsSync(join(data, "host.sqlite"))) throw new Error("Installed Bunny state is missing. Restore a verified backup; a new database was not created.");
    const record = JSON.parse(readFileSync(marker, "utf8"));
    if (record.schema !== "bunny-state/2" || resolve(record.stateRoot).toLowerCase() !== data.toLowerCase()) throw new Error("Installed Bunny state layout does not match its configured directory.");
    for (const child of ["credentials", "settings", "runtime", "logs", "backups", "cloudflared", "sessions"]) {
      if (!existsSync(join(data, child))) throw new Error(`Installed Bunny state folder is missing: ${child}`);
      assertApplicationDirectory(join(data, child));
    }
    for (const file of ["host.sqlite", "state-layout.json", "credentials/credentials.json", "settings/remote.json"]) {
      const path = join(data, file);
      if (existsSync(path) && (lstatSync(path).isSymbolicLink() || lstatSync(path).nlink > 1)) throw new Error("Installed Bunny state cannot use a file link.");
    }
    const database = new DatabaseSync(join(data, "host.sqlite"), { readOnly: true });
    try {
      const version = database.prepare("PRAGMA user_version").get()?.user_version;
      const integrity = database.prepare("PRAGMA quick_check").all();
      const schema = database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
      const schemaHash = createHash("sha256").update(JSON.stringify(schema)).digest("hex");
      if (version !== record.databaseUserVersion || version !== 3 || integrity.length !== 1 || Object.values(integrity[0])[0] !== "ok" || schemaHash !== record.databaseSchemaSha256) throw new Error("Installed Bunny database is damaged or has an unexpected schema. Restore a verified backup.");
    } finally { database.close(); }
  }
  return {
    installed, data, database: join(data, "host.sqlite"), sessions: join(data, "sessions"),
    diagnostics: assertApplicationDirectory(join(data, "logs")), runtime: assertApplicationDirectory(join(data, "runtime")),
    credentials: join(data, installed ? "credentials/credentials.json" : "credentials.json"),
    remote: join(data, installed ? "settings/remote.json" : "remote.json"),
    marker: join(data, "state-layout.json"),
  };
}

/**
 * M-A-2 T9: an installed Host applies its own additive schema at boot (CREATE TABLE IF NOT
 * EXISTS), but boot validation compares the database against the marker's schema fingerprint,
 * which still describes the previous schema. Without reconciliation, the second boot after any
 * additive migration refuses a healthy database. Keep the marker describing exactly the applied
 * schema — additive reconciliation only; a damaged database is never repaired or booted.
 * This never claims anything was activated or installed; it only updates two marker fields.
 */
export function refreshStateMarker(paths: { installed: boolean; data: string; database: string }): { healed: boolean; schemaSha256: string; userVersion: number } {
  if (!paths.installed) return { healed: false, schemaSha256: "", userVersion: 0 };
  const markerPath = join(paths.data, "state-layout.json");
  const record = JSON.parse(readFileSync(markerPath, "utf8")) as Record<string, unknown>;
  if (record.schema !== "bunny-state/2") return { healed: false, schemaSha256: "", userVersion: 0 };
  const database = new DatabaseSync(paths.database, { readOnly: true });
  try {
    const version = database.prepare("PRAGMA user_version").get()?.user_version;
    const integrity = database.prepare("PRAGMA quick_check").all();
    if (version !== 3) throw new Error("Installed Bunny database user_version must be 3.");
    if (integrity.length !== 1 || Object.values(integrity[0])[0] !== "ok") {
      throw new Error("Installed Bunny database did not pass quick_check; the state marker was left unchanged.");
    }
    const schema = database.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
    const schemaHash = createHash("sha256").update(JSON.stringify(schema)).digest("hex");
    const healed = record.databaseSchemaSha256 !== schemaHash || record.databaseUserVersion !== version;
    if (healed) {
      const next = { ...record, databaseUserVersion: version, databaseSchemaSha256: schemaHash };
      writeFileSync(markerPath, JSON.stringify(next, null, 2));
    }
    return { healed, schemaSha256: schemaHash, userVersion: version };
  } finally { database.close(); }
}

// Installed state has an explicit layout. Development and test Hosts retain their local data directory.
import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

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
  const data = resolve(selected ?? ".bunny-a");
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
    credentials: join(data, installed ? "credentials/credentials.json" : "credentials.json"),
    remote: join(data, installed ? "settings/remote.json" : "remote.json"),
  };
}

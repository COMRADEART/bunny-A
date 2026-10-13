// The PowerShell controller stops verified production processes before prepareMigration runs.
// SQLite VACUUM INTO produces a complete snapshot, including committed WAL data. Raw state stays intact.
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const digest = (value) => createHash("sha256").update(value).digest("hex");
export const fileDigest = (path) => digest(readFileSync(path));
const identifier = (value) => '"' + value.replaceAll('"', '""') + '"';
const encode = (row) => JSON.stringify(row, (_key, value) => typeof value === "bigint" ? `${value}n` : value instanceof Uint8Array ? { bytes: Buffer.from(value).toString("base64") } : value);
export function inside(path, parent) {
  const rel = relative(resolve(parent), resolve(path));
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !/^([a-z]:|\/)/i.test(rel));
}
export function assertNoLinks(root) {
  for (let folder = resolve(root); ; folder = dirname(folder)) {
    if (existsSync(folder) && lstatSync(folder).isSymbolicLink()) throw new Error(`State cannot use directory links: ${folder}`);
    if (dirname(folder) === folder) break;
  }
  for (const path of files(root)) if (lstatSync(join(root, path)).nlink > 1) throw new Error(`Copied state still has a hard link: ${path}`);
}
export function assertOutsideCheckout(path) {
  for (let folder = resolve(path); ; folder = dirname(folder)) {
    if (existsSync(join(folder, ".git"))) throw new Error(`Application state must be outside Git: ${folder}`);
    if (existsSync(folder) && lstatSync(folder).isSymbolicLink()) throw new Error(`Application state cannot use a link: ${folder}`);
    if (dirname(folder) === folder) break;
  }
}
export function files(root) {
  const result = [];
  function visit(folder) {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const full = join(folder, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`State contains a reparse point: ${full}`);
      if (entry.isDirectory()) visit(full); else result.push(relative(root, full));
    }
  }
  visit(root);
  return result.sort();
}
function readDatabase(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    db.exec("PRAGMA query_only=ON; BEGIN");
    const integrity = db.prepare("PRAGMA integrity_check").all().map((r) => Object.values(r)[0]);
    if (integrity.length !== 1 || integrity[0] !== "ok") throw new Error("Database integrity check failed.");
    const version = db.prepare("PRAGMA user_version").get().user_version;
    const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
    const rows = new Map();
    for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()) {
      const statement = db.prepare(`SELECT * FROM ${identifier(name)}`); statement.setReadBigInts(true);
      rows.set(name, statement.all());
    }
    return { version, schema: digest(encode(schema)), rows };
  } finally { db.close(); }
}
export function databaseReport(path) {
  const { version, schema, rows } = readDatabase(path);
  const reports = [...rows].map(([name, data]) => ({ name, count: data.length, rowsSha256: digest(data.map(encode).sort().join("\n")) }));
  return { integrity: "ok", userVersion: version, schemaSha256: schema, sha256: fileDigest(path), tables: reports.filter((r) => !r.name.startsWith("sqlite_")), internalTables: reports.filter((r) => r.name.startsWith("sqlite_")) };
}
export function assertIdleDatabase(path) {
  const { rows } = readDatabase(path);
  const tasks = (rows.get("tasks") ?? []).map((r) => JSON.parse(r.record));
  const missions = (rows.get("missions") ?? []).map((r) => JSON.parse(r.record));
  if (tasks.some((t) => !["completed", "failed", "stopped"].includes(t.state)) || missions.some((m) => ["ready", "running", "waiting_for_user", "verifying"].includes(m.state))) throw new Error("State migration refused: active tasks or Missions exist.");
}
export function snapshotDatabase(source, destination) {
  if (existsSync(destination)) throw new Error("A database backup cannot overwrite an existing file.");
  mkdirSync(dirname(destination), { recursive: true });
  const db = new DatabaseSync(source, { readOnly: true });
  try { db.prepare("VACUUM INTO ?").run(destination); } finally { db.close(); }
  return databaseReport(destination);
}
export function compareDatabases(before, after, { rebases = [], live = false } = {}) {
  const a = readDatabase(before); const b = readDatabase(after);
  if (a.version !== b.version || a.schema !== b.schema) throw new Error("Database schema changed during the state migration.");
  const mismatches = []; const reports = [];
  for (const [table, rows] of a.rows) {
    const expected = rows.map((row) => {
      if (table !== "projects" || !row.record) return row;
      const project = JSON.parse(row.record);
      const change = rebases.find((r) => r.id === project.id);
      if (!change) return row;
      if (project.path !== change.before) throw new Error("Project rebase does not match the backup.");
      return { ...row, record: JSON.stringify({ ...project, path: change.after }) };
    });
    const actual = b.rows.get(table) ?? [];
    const actualRows = new Map();
    for (const row of actual) { const key = encode(row); actualRows.set(key, (actualRows.get(key) ?? 0) + 1); }
    let missing = 0;
    for (const row of expected) { const key = encode(row); const count = actualRows.get(key) ?? 0; if (count) actualRows.set(key, count - 1); else missing++; }
    const additional = [...actualRows.values()].reduce((x, y) => x + y, 0);
    const telemetry = live && table === "providers";
    const sequenceAdvance = live && table === "sqlite_sequence" && expected.length === actual.length && expected.every((row) => {
      const next = actual.find((r) => r.name === row.name);
      return next && (row.name === "events" ? next.seq >= row.seq : encode(next) === encode(row));
    });
    // Only provider discovery records are mutable during restart; historical events can only be appended.
    if (!telemetry && !sequenceAdvance && (missing || (additional && !(live && table === "events")))) mismatches.push({ table, missingOrChanged: missing, unexpectedRows: additional });
    if (telemetry && (rows.length !== actual.length || rows.some((r) => !actual.some((next) => next.id === r.id)))) mismatches.push({ table, error: "Provider identities changed" });
    const changedProviderFields = telemetry ? [...new Set(expected.flatMap((row) => {
      const next = actual.find((r) => r.id === row.id); if (!row.record || !next?.record) return [];
      const previousRecord = JSON.parse(row.record); const nextRecord = JSON.parse(next.record);
      return [...new Set([...Object.keys(previousRecord), ...Object.keys(nextRecord)])].filter((key) => encode(previousRecord[key]) !== encode(nextRecord[key]));
    }))].sort() : [];
    reports.push({ table, before: rows.length, after: actual.length, missingOrChanged: missing, additional, expectedProviderTelemetry: telemetry, expectedSequenceAdvance: sequenceAdvance, changedProviderFields });
  }
  for (const table of b.rows.keys()) if (!a.rows.has(table)) mismatches.push({ table, error: "Unexpected table" });
  return { ok: !mismatches.length, userVersion: a.version, tables: reports, mismatches };
}
const locations = new Map([
  ["credentials.json", "credentials/credentials.json"],
  ["deployment.json", "settings/deployment.json"], ["remote.json", "settings/remote.json"],
  ["remote-consent.json", "settings/remote-consent.json"], ["island-ui.json", "settings/island-ui.json"],
  ["tunnel.json", "settings/tunnel.json"], ["tunnel-process.json", "runtime/tunnel-process.json"],
  ["tools/cloudflared.exe", "cloudflared/cloudflared.exe"],
]);
export function mappedPath(path) {
  const key = path.split(sep).join("/");
  return locations.get(key) ?? (/^[^/]+\.log$/.test(key) ? `logs/${key}` : key);
}
export function migrationPreflight(source, target) {
  assertOutsideCheckout(target);
  const inventory = files(source).map((path) => ({ from: path.split(sep).join("/"), to: mappedPath(path), bytes: statSync(join(source, path)).size }));
  assertIdleDatabase(join(source, "host.sqlite"));
  const database = databaseReport(join(source, "host.sqlite"));
  if (database.userVersion !== 3) throw new Error("State migration supports Host schema 3 only.");
  const deployment = join(source, "deployment.json");
  if (existsSync(deployment)) assertOutsideCheckout(JSON.parse(readFileSync(deployment, "utf8")).packagePath);
  const named = join(source, "tunnel.json");
  if (existsSync(named) && JSON.parse(readFileSync(named, "utf8")).mode === "named") throw new Error("Named-tunnel credential migration requires an explicit credential/config inventory. No state was switched.");
  return { database, inventory };
}
function copyTree(source, target, map = (path) => path) {
  if (existsSync(target)) throw new Error("Migration destination already exists.");
  mkdirSync(target, { recursive: true });
  const pending = [source];
  while (pending.length) {
    const folder = pending.pop();
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const path = join(folder, entry.name); const mapped = map(relative(source, path));
      if (mapped !== null) {
        const destination = join(target, mapped);
        if (!inside(destination, target)) throw new Error("State directory escaped the migration destination.");
        mkdirSync(destination, { recursive: true });
      }
      pending.push(path);
    }
  }
  const copied = [];
  for (const path of files(source)) {
    const mapped = map(path);
    if (mapped === null) continue;
    const out = join(target, mapped);
    if (!inside(out, target) || existsSync(out)) throw new Error("State migration path collision.");
    mkdirSync(dirname(out), { recursive: true }); copyFileSync(join(source, path), out);
    const hash = fileDigest(out);
    if (hash !== fileDigest(join(source, path))) throw new Error(`State copy changed bytes: ${path}`);
    copied.push({ from: path.split(sep).join("/"), to: mapped.split(sep).join("/"), sha256: hash, bytes: statSync(out).size });
  }
  assertNoLinks(target);
  return copied;
}
export function rebaseProjects(database, source, target) {
  assertOutsideCheckout(database); assertOutsideCheckout(target);
  const db = new DatabaseSync(database); const rebases = [];
  try {
    db.exec("BEGIN IMMEDIATE");
    for (const row of db.prepare("SELECT id,record FROM projects").all()) {
      const project = JSON.parse(row.record);
      if (!inside(project.path, source)) continue;
      const after = join(target, relative(source, project.path));
      db.prepare("UPDATE projects SET record=? WHERE id=?").run(JSON.stringify({ ...project, path: after }), row.id);
      rebases.push({ id: project.id, before: project.path, after });
    }
    db.exec("COMMIT");
  } finally { db.close(); }
  return rebases;
}
export function prepareMigration({ source, stage, target, backup }) {
  migrationPreflight(source, target);
  for (const path of [stage, target, backup]) assertOutsideCheckout(path);
  if (inside(stage, source) || inside(backup, source) || inside(target, source) || inside(source, target)) throw new Error("State source and destinations must be separate.");
  if (existsSync(stage) || existsSync(backup)) throw new Error("Migration stage or backup already exists.");
  // Validate before copying. The caller has stopped the writer; this snapshot is the cutover baseline.
  assertIdleDatabase(join(source, "host.sqlite"));
  const before = databaseReport(join(source, "host.sqlite"));
  if (before.userVersion !== 3) throw new Error("State migration supports Host schema 3 only.");
  const copiedBackup = copyTree(source, join(backup, "original-state"));
  const snapshot = join(backup, "host.sqlite"); const verifiedBackup = snapshotDatabase(join(source, "host.sqlite"), snapshot);
  const backupCheck = compareDatabases(join(source, "host.sqlite"), snapshot);
  if (!backupCheck.ok) throw new Error("The verified backup differs from the stopped Host.");
  const copied = copyTree(source, stage, (path) => /^host\.sqlite(?:-(?:wal|shm))?$/i.test(path) || path === "tunnel-process.json" ? null : mappedPath(path));
  copyFileSync(snapshot, join(stage, "host.sqlite"));
  for (const folder of ["backups", "runtime", "cloudflared", "credentials", "logs", "settings", "sessions", "provider-observations"]) mkdirSync(join(stage, folder), { recursive: true });
  const deploymentPath = join(stage, "settings/deployment.json");
  if (existsSync(deploymentPath)) assertOutsideCheckout(JSON.parse(readFileSync(deploymentPath, "utf8")).packagePath);
  const tunnelConfig = join(stage, "settings/tunnel.json");
  if (existsSync(tunnelConfig)) {
    const config = JSON.parse(readFileSync(tunnelConfig, "utf8"));
    if (config.mode === "named") throw new Error("Named-tunnel credential migration requires an explicit credential/config inventory. No state was switched.");
  }
  const binary = join(stage, "cloudflared/cloudflared.exe");
  const tool = existsSync(binary) ? { schema: "bunny-tool/1", name: "cloudflared", sha256: fileDigest(binary), bytes: statSync(binary).size } : null;
  if (tool) writeFileSync(join(stage, "cloudflared/tool.json"), JSON.stringify(tool, null, 2));
  const rebases = rebaseProjects(join(stage, "host.sqlite"), source, target);
  const preservation = compareDatabases(snapshot, join(stage, "host.sqlite"), { rebases });
  if (!preservation.ok) throw new Error("State preservation check failed before cutover.");
  writeFileSync(join(stage, "state-layout.json"), JSON.stringify({ schema: "bunny-state/2", stateRoot: target, migratedAt: new Date().toISOString(), backup, databaseUserVersion: before.userVersion, databaseSchemaSha256: before.schemaSha256 }, null, 2));
  const report = { schema: "bunny-state-migration/1", source, target, stage, backup, before, verifiedBackup, copiedBackup, copied, rebases, preservation, tool };
  writeFileSync(join(backup, "migration.json"), JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, ...args] = process.argv.slice(2);
  const result = action === "snapshot" ? snapshotDatabase(args[0], args[1])
    : action === "rebase" ? { rebases: rebaseProjects(args[0], args[1], args[2]) }
    : action === "preflight" ? migrationPreflight(args[0], args[1])
    : action === "inspect" ? databaseReport(args[0])
    : action === "prepare" ? prepareMigration(JSON.parse(readFileSync(args[0], "utf8")))
    : action === "compare" ? compareDatabases(args[0], args[1], args[2] ? JSON.parse(readFileSync(args[2], "utf8")) : {})
    : null;
  if (!result) throw new Error("Usage: bunny-state-migration.mjs inspect|snapshot|prepare|compare");
  console.log(JSON.stringify(result, null, 2));
  if (result.ok === false) process.exitCode = 1;
}

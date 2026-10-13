// M-A-3 T9R-F01: read-only observation of installed production v26. Opens nothing for writing.
// Usage: node --experimental-strip-types production-observe.mjs <out.json>
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const sha = (data) => createHash("sha256").update(data).digest("hex");
const root = join(process.env.LOCALAPPDATA, "Bunny-A");
const install = JSON.parse(readFileSync(join(root, "install.json"), "utf8").replace(/^﻿/, ""));
const dbPath = join(install.dataDirectory, "host.sqlite");
const db = new DatabaseSync(dbPath, { readOnly: true });
const tables = {};
for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()) {
  const rows = db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}" ORDER BY rowid`).all();
  tables[name] = { count: rows.length, sha256: sha(JSON.stringify(rows)) };
}
db.close();
const releaseDir = install.currentRelease?.folder ?? null;
const manifest = (() => {
  if (!releaseDir || !existsSync(releaseDir)) return null;
  const files = [];
  const walk = (dir) => { for (const entry of readdirSync(dir)) { const p = join(dir, entry); const s = statSync(p); if (s.isDirectory()) walk(p); else files.push(`${p.slice(releaseDir.length)}:${sha(readFileSync(p))}`); } };
  walk(releaseDir);
  return { files: files.length, sha256: sha(files.sort().join("\n")) };
})();
const netstat = execFileSync("netstat", ["-ano", "-p", "TCP"], { encoding: "utf8" }).split(/\r?\n/).filter((line) => /LISTENING/.test(line) && /:(8084|43119)\s/.test(line)).map((line) => line.trim().split(/\s+/));
const pids = [...new Set(netstat.map((cols) => cols.at(-1)))];
const processes = pids.map((pid) => {
  try { return { pid, detail: execFileSync("powershell.exe", ["-NoProfile", "-Command", `Get-Process -Id ${pid} | Select-Object Id,ProcessName,StartTime | ConvertTo-Json -Compress`], { encoding: "utf8" }).trim() }; }
  catch { return { pid, detail: "unavailable" }; }
});
const out = {
  classification: "LIVE read-only observation",
  at: new Date().toISOString(),
  installJsonSha256: sha(readFileSync(join(root, "install.json"))),
  currentRelease: install.currentRelease?.name ?? null,
  releaseManifest: manifest,
  databasePath: dbPath,
  tables,
  listeners: netstat.map((cols) => ({ local: cols[1], pid: cols.at(-1) })),
  processes,
  startupShortcutExists: existsSync(install.shortcut),
};
writeFileSync(process.argv[2], JSON.stringify(out, null, 2));
console.log(JSON.stringify({ release: out.currentRelease, listeners: out.listeners, tables: Object.keys(tables).length, manifest }, null, 0));

// M-A-3 T12: copied unchanged from t11/production-observe.mjs.
// M-A-3 T11: copied unchanged from t10/production-observe.mjs. T10: copied from t9r-f04/production-observe.mjs (read-only production observation) plus a read-only audio-settings receipt.
// M-A-3 T9R-F03: read-only observation of installed production v26. Opens nothing for writing.
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
// M-A-3 T10 §45/V57: read-only audio and microphone-privacy receipt (registry reads only; nothing is written).
const regPs = (path) => { try { return execFileSync("powershell.exe", ["-NoProfile", "-Command", `(Get-ItemProperty -LiteralPath '${path}' -Name Value -ErrorAction Stop).Value`], { encoding: "utf8" }).trim() || null; } catch { return null; } };
const consent = ["Registry::HKEY_CURRENT_USER", "Software", "Microsoft", "Windows", "CurrentVersion", "CapabilityAccessManager", "ConsentStore", "microphone"].join(String.fromCharCode(92));
const audio = {
  micPrivacyUser: regPs(consent),
  micPrivacyUserNonPackaged: regPs(consent + String.fromCharCode(92) + "NonPackaged"),
  micPrivacyMachine: regPs(consent.replace("HKEY_CURRENT_USER", "HKEY_LOCAL_MACHINE")),
  endpointsSha256: sha(execFileSync("powershell.exe", ["-NoProfile", "-Command", "Get-PnpDevice -Class AudioEndpoint | Sort-Object InstanceId | ForEach-Object { $_.InstanceId + '|' + $_.Status + '|' + $_.FriendlyName }"], { encoding: "utf8" })),
};
const prior = JSON.parse(readFileSync(process.argv[2], "utf8"));
prior.audio = audio;
writeFileSync(process.argv[2], JSON.stringify(prior, null, 2));
console.log(JSON.stringify({ audio }));

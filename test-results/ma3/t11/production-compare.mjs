// M-A-3 T11 §47: read-only comparison of production-before.json with production-final-observation.json. The production
// database is opened read-only only to list the events written after the baseline. Nothing in production is written.
// Usage: node --experimental-strip-types production-compare.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = "test-results/ma3/t11";
const a = JSON.parse(readFileSync(join(dir, "production-before.json"), "utf8"));
const b = JSON.parse(readFileSync(join(dir, "production-final-observation.json"), "utf8"));
const install = JSON.parse(readFileSync(join(process.env.LOCALAPPDATA, "Bunny-A", "install.json"), "utf8").replace(/^﻿/, ""));
const db = new DatabaseSync(join(install.dataDirectory, "host.sqlite"), { readOnly: true });
const events = db.prepare("SELECT sequence, at, type, detail FROM events WHERE at > ? ORDER BY sequence").all(Date.parse(a.at));
db.close();
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const unchangedChecks = {
  installJson: a.installJsonSha256 === b.installJsonSha256,
  currentRelease: a.currentRelease === b.currentRelease,
  releaseManifest: same(a.releaseManifest, b.releaseManifest),
  listeners: same(a.listeners, b.listeners),
  processesSamePidsAndStartTimes: same(a.processes, b.processes),
  startupShortcut: a.startupShortcutExists === b.startupShortcutExists,
  micPrivacy: a.audio.micPrivacyUser === b.audio.micPrivacyUser && a.audio.micPrivacyUserNonPackaged === b.audio.micPrivacyUserNonPackaged && a.audio.micPrivacyMachine === b.audio.micPrivacyMachine,
};
const types = [...new Set(events.map((e) => e.type))];
const onlyProbe = types.every((t) => t === "provider.status_changed");
const out = {
  classification: "LIVE read-only comparison of installed production (no writes, no restart)",
  release: b.currentRelease,
  before: a.at,
  final: b.at,
  unchangedChecks,
  changed: {
    databaseTables: Object.keys(b.tables).filter((t) => !same(a.tables[t], b.tables[t])),
    newEventCount: events.length,
    newEventTypes: types,
    newEvents: events.map((e) => ({ sequence: e.sequence, at: new Date(e.at).toISOString(), type: e.type })),
    explanation:
      onlyProbe ? "New event types are limited to the running production Host's provider observations. T11 used the shared Ollama service from disposable Hosts. Production database inspection was read-only; no whole-database byte-equality claim is made." : "Other production activity was observed. Event content is withheld; this comparison cannot certify unchanged operational state.",
    audioEndpointsSha256: {
      before: a.audio.endpointsSha256,
      final: b.audio.endpointsSha256,
      explanation:
        a.audio.endpointsSha256 === b.audio.endpointsSha256 ? "Read-only endpoint enumeration hash is unchanged." : "Read-only endpoint enumeration differs; the cause was not established by this task. No driver, privacy, or audio-setting mutation was performed.",
    },
  },
  notPerformed: ["deploy T11", "restart production", "migrate production SQLite", "modify credentials", "modify paired phone records", "start the tunnel", "change firewall rules", "modify Startup", "replace installed files", "change microphone privacy", "modify audio drivers", "kill unrelated processes", "enable Missions/Triggers", "push"],
  unchanged: Object.values(unchangedChecks).every(Boolean) && onlyProbe,
  summary:
    "See unchangedChecks for exact immutable-release, install, listener/process, Startup and microphone-privacy comparisons. T11 performed no production write, restart or installation. Other observations are listed separately, without attributing unexplained changes.",
};
out.result = out.unchanged ? "PASS" : "FAIL";
writeFileSync(join(dir, "production-final.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ unchanged: out.unchanged, unchangedChecks, newEvents: events.length, types }));

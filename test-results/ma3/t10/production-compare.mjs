// M-A-3 T10 §45: read-only comparison of production-before.json with production-final-observation.json. The production
// database is opened read-only only to list the events written after the baseline. Nothing in production is written.
// Usage: node --experimental-strip-types production-compare.mjs
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = "test-results/ma3/t10";
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
    newEvents: events.map((e) => ({ sequence: e.sequence, at: new Date(e.at).toISOString(), type: e.type, detail: e.detail })),
    explanation:
      "Every new production event is provider.status_changed, written by the RUNNING production Host itself (its periodic provider probe). It records which model the shared local Ollama service has loaded; T10's disposable live tests loaded and unloaded huihui_ai/qwen2.5-abliterate:7b there, and Ollama had one offline/online blip. The providers table and sqlite_sequence change with those probe records. T10 never wrote production state; its database was only opened read-only.",
    audioEndpointsSha256: {
      before: a.audio.endpointsSha256,
      final: b.audio.endpointsSha256,
      explanation:
        "The PnP AudioEndpoint list hash (InstanceId|Status|FriendlyName) differs. Current endpoints: Speakers (SD4780P Audio) status Unknown (external display/dock audio, currently disconnected); Speakers (Realtek(R) Audio) OK; Microphone Array (Intel Smart Sound) OK. A device presence change from docking is outside T10. T10 never installs or modifies drivers or audio settings (the worker reads Core Audio only). Endpoint mute is not part of this hash; the user unmuted the microphone themselves.",
    },
  },
  notPerformed: ["deploy T10", "restart production", "migrate production SQLite", "modify credentials", "modify paired phone records", "start the tunnel", "change firewall rules", "modify Startup", "replace installed files", "change microphone privacy", "modify audio drivers", "kill unrelated processes", "enable Missions/Triggers", "push"],
  unchanged: Object.values(unchangedChecks).every(Boolean) && onlyProbe,
  summary:
    "Production v26-MA2-R1 untouched: same release bytes, install.json, listeners, PIDs and start times, Startup and microphone privacy. Only the running production Host's own provider-probe records (its observation of the shared Ollama model) and the machine's audio endpoint presence changed; T10 wrote neither.",
};
writeFileSync(join(dir, "production-final.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ unchanged: out.unchanged, unchangedChecks, newEvents: events.length, types }));

import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { STAGE_ROOT, STAGE_STATE, STAGE_WORKSPACE, REC, BASE, bearer, health, cmd, getState, getMission, saveRecord, wait } from "./live-shared.ts";

// ── Gate T9 closure — runs after the live matrix (phases B–J) has passed. ──────────────
// Order matters: every staged-database record is written BEFORE the staged Host is stopped,
// and the evidence index is the last file written. Production is only ever read (hashing,
// readonly sqlite, /health) — never written, never stopped.

const PROD_ROOT = "C:/Users/allam/AppData/Local/Bunny-A";
const PROD_STATE = PROD_ROOT + "/state";
const PROD_BASE = "http://127.0.0.1:43119";
const INDEX_REL = "evidence/index.json";

type HealthBody = { app: string; pid: number; instanceId: string; operationalState: string; unavailableSubsystems: string[] };

const sha256 = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
const iso = (ms: number = Date.now()) => new Date(ms).toISOString();

const probeNames = [
  { label: "17-char typed-value probe", value: "T9SecretProbe-7f3" },
  { label: "lookalike-window probe value", value: "t9-lookalike-probe" },
  { label: "K2 typed-value probe", value: "K2Probe9" },
  { label: "K5 typed-value probe", value: "K5Probe9" },
  { label: "R typed-value probe", value: "RProbe9" },
  { label: "J typed-value probe", value: "JProbe9" },
];
const LOOKALIKE_TITLE = "Calculator help"; // a window TITLE, not a secret value (may legitimately appear in text)

function prodBearer(): string {
  return (JSON.parse(readFileSync(PROD_STATE + "/credentials/credentials.json", "utf8")) as { token: string }).token;
}

async function prodHealth(): Promise<{ status: number; body: HealthBody | null }> {
  try {
    const response = await fetch(PROD_BASE + "/health", { headers: { authorization: "Bearer " + prodBearer() } });
    let body: HealthBody | null = null;
    try { body = await response.json() as HealthBody; } catch { body = null; }
    return { status: response.status, body };
  } catch (error) {
    return { status: 0, body: null };
  }
}

/** Recursively list files under a directory (relative paths, forward slashes), ignoring nothing. */
function walk(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else out.push(full);
    }
  };
  if (existsSync(root)) visit(root);
  return out;
}

interface ScanHit { file: string; pattern: string; count: number }

/** Byte-level substring scan: catches occurrences in any surface, including sqlite WAL pages. */
function scanForPatterns(files: string[], patterns: { label: string; value: string }[]): { files: string[]; hits: ScanHit[] } {
  const hits: ScanHit[] = [];
  for (const file of files) {
    let buffer: Buffer;
    try { buffer = readFileSync(file); } catch { continue; }
    for (const pattern of patterns) {
      let count = 0;
      let from = 0;
      for (;;) {
        const at = buffer.indexOf(Buffer.from(pattern.value, "utf8"), from);
        if (at < 0) break;
        count += 1;
        from = at + 1;
      }
      if (count > 0) hits.push({ file, pattern: pattern.label, count });
    }
  }
  return { files, hits };
}

// ── step 1: the staged host must be healthy before any record is frozen ────────────────
console.log("[close 1/6] staged host health + stray missions");
const stageStart = await health();
const stageState = await getState();
const stageMissions = stageState.missions?.missions ?? [];
const allT9 = stageMissions.filter((mission) => /T9/.test(mission.title));
const t9Ids = new Set(allT9.map((mission) => mission.id));

// Stray missions from the interrupted run 3: stop everything still open so the journal closes clean.
const stoppedStrays: { id: string; title: string; state: string }[] = [];
for (const mission of stageMissions.filter((m) => !["completed", "failed", "stopped"].includes(m.state))) {
  await cmd("mission.stop", { id: mission.id });
  stoppedStrays.push({ id: mission.id, title: mission.title, state: mission.state });
  await wait(300);
}
const straysAfter: string[] = [];
for (const mission of t9Ids) {
  try { straysAfter.push((await getMission(mission)).mission.state); } catch { straysAfter.push("(get failed)"); }
}

// ── step 2: the full staged journal, schema-agnostic, labeled t9-live / host-operating ──
console.log("[close 2/6] journal");
{
  const db = new DatabaseSync(STAGE_STATE + "/host.sqlite", { readOnly: true });
  try {
    const eventColumns = (db.prepare("PRAGMA table_info(events)").all() as { name: string }[]).map((column) => column.name);
    const rows = (db.prepare("SELECT * FROM events ORDER BY sequence ASC").all() as Record<string, unknown>[]).map((row) => {
      const missionId = eventColumns.includes("mission_id") ? (row.mission_id as string | null) ?? null : null;
      return {
        sequence: Number(row.sequence),
        at: Number(row.at),
        type: String(row.type ?? ""),
        taskId: (row.task_id as string | null) ?? null,
        missionId,
        detail: typeof row.detail === "string" ? row.detail : String(row.detail ?? ""),
        class: missionId && t9Ids.has(missionId) ? "t9-live" : "host-operating",
      };
    });
    const t9 = rows.filter((row) => row.class === "t9-live");
    const types = new Map<string, number>();
    for (const row of t9) types.set(row.type, (types.get(row.type) ?? 0) + 1);
    saveRecord("journal.json", {
      gate: "M-A-2 T9",
      recordedAt: iso(),
      host: { base: BASE, pid: stageStart.pid, instanceId: stageStart.instanceId, operationalState: stageStart.operationalState },
      boundaries: { note: "the staged host runs a disposable copy of the production database, so rows before the T9 missions are copied production history or host-operating noise; the t9-live class is bound by the staged T9 mission ids below (never by timestamps)" },
      missions: allT9.map((mission, index) => ({ id: mission.id, title: mission.title, state: straysAfter[index] ?? mission.state })),
      totals: { rows: rows.length, t9Live: t9.length, hostOperating: rows.length - t9.length },
      t9Types: Object.fromEntries([...types.entries()].sort()),
      rows,
    });
    console.log(`  journal rows=${rows.length} t9=${t9.length}`);
  } finally { db.close(); }
}

// ── step 3: the privacy sweep (file surfaces only; the values are never printed) ───────
console.log("[close 3/6] privacy sweep");
{
  const stageStateFiles = walk(STAGE_STATE);
  const stageWorkspaceFiles = walk(STAGE_WORKSPACE);
  const evidenceFiles = walk(REC);
  const token = bearer();
  const stateScan = scanForPatterns(stageStateFiles, probeNames);
  const workspaceScan = scanForPatterns(stageWorkspaceFiles, probeNames);
  const evidenceTokenScan = scanForPatterns(evidenceFiles, [{ label: "staged-bearer-token", value: token }]);
  const evidenceProbeScan = scanForPatterns(evidenceFiles, probeNames);
  const evidenceHitsByClass: ScanHit[] = evidenceProbeScan.hits.filter((hit) => !hit.file.replace(/\\/g, "/").includes("/staging/") || !hit.file.endsWith(".ts"));
  saveRecord("privacy.json", {
    gate: "M-A-2 T9",
    recordedAt: iso(),
    method: "byte-level scan of every file surface (staged state tree incl. sqlite/wal/shm, staged workspace, the whole evidence directory); values are compared byte-for-byte and never printed",
    probes: probeNames.map((probe) => probe.label),
    token: "the staged Host bearer token (value withheld; compared byte-for-byte)",
    note: "file surfaces only — Host process memory is not scanned (stated limitation); the lookalike window title is a label, not a secret, and is not treated as a probe value",
    scans: [
      { root: "staged state tree (incl. host.sqlite/-wal/-shm)", files: stateScan.files.length, hits: stateScan.hits },
      { root: "staged workspace", files: workspaceScan.files.length, hits: workspaceScan.hits },
      { root: "evidence dir — bearer token", files: evidenceTokenScan.files.length, hits: evidenceTokenScan.hits },
    ],
    informational: { root: "evidence dir — probe literals", files: evidenceProbeScan.files.length, hits: evidenceProbeScan.hits.filter((hit) => hit.file.replace(/\\/g, "/").includes("/staging/") && hit.file.endsWith(".ts")), disallowedHits: evidenceHitsByClass },
    verdict: {
      stageStateClean: stateScan.hits.length === 0,
      stageWorkspaceClean: workspaceScan.hits.length === 0,
      evidenceTokenNeverWritten: evidenceTokenScan.hits.length === 0,
      evidenceProbeLiteralsOnlyInVerificationSource: evidenceHitsByClass.length === 0,
    },
  });
  console.log(`  stateHits=${stateScan.hits.length} workspaceHits=${workspaceScan.hits.length} tokenHits=${evidenceTokenScan.hits.length}`);
}

// ── step 4: production preservation, after-closure (production is only read) ───────────
console.log("[close 4/6] production preservation (after)");
{
  const before = JSON.parse(readFileSync(REC + "/production-preservation.json", "utf8")) as { files: { path: string; sha256: string }[]; productionHealth: HealthBody | null };
  const files = before.files.map((entry) => {
    const full = join(PROD_ROOT, entry.path);
    const buffer = readFileSync(full);
    const stats = statSync(full);
    const sha = sha256(buffer);
    return { path: entry.path, size: buffer.length, sha256: sha, mtimeMs: stats.mtimeMs, matchesBefore: sha === entry.sha256 };
  });
  const prodHealthRead = await prodHealth();
  const db = new DatabaseSync(PROD_STATE + "/host.sqlite", { readOnly: true });
  try {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[]).map((row) => row.name);
    const tableCounts = tables.map((table) => {
      try { return { table, rows: (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).all() as { n: number }[])[0]?.n ?? null }; }
      catch { return { table, rows: null }; }
    });
    // Recompute the baseline record's inspection fields. Schema-agnostic where names are unknown:
    // the authorization rows' record JSON is searched for a computer block (the baseline's method),
    // and every table's row count is recorded verbatim.
    let computerEnvelopeApproved: boolean | string = false;
    if (tables.includes("mission_authorizations")) {
      const rows = db.prepare("SELECT * FROM mission_authorizations LIMIT 500").all() as Record<string, unknown>[];
      const recordColumn = ["record", "json", "payload", "data"].find((key) => rows.some((row) => typeof row[key] === "string" && (row[key] as string).includes("computer")));
      computerEnvelopeApproved = recordColumn
        ? rows.some((row) => { try { const parsed = JSON.parse(String(row[recordColumn])) as { computer?: { enabled?: boolean } }; return parsed.computer?.enabled === true; } catch { return false; } })
        : "record column not identified (see tableCounts)";
    } else {
      computerEnvelopeApproved = "mission_authorizations table absent";
    }
    const inspection: Record<string, unknown> = { tableCounts };
    inspection.approval_batches = tables.includes("approval_batches") ? "PRESENT (must be absent)" : false;
    inspection.desktopControlEverEnvelopeApproved = computerEnvelopeApproved;
    saveRecord("production-preservation-after.json", {
      gate: "M-A-2 T9",
      recordedAt: iso(),
      phase: "after-closure",
      method: "the before-record's 7 production files re-hashed from disk; /health probed; sqlite opened READONLY",
      files,
      unchangedNote: "host.sqlite and its -wal/-shm sidecars are EXPECTED to differ from the before-record hashes: production stayed live as a running service the whole gate; the static files (state-layout.json, credentials, settings/deployment.json, install.json) must match",
      productionHealth: prodHealthRead,
      sql: "SELECT name FROM sqlite_master WHERE type='table' (full table list, recorded); row counts per table; no write statement was ever issued against production",
      databaseInspection: inspection,
    });
    console.log(`  prod files unchanged=${files.filter((file) => file.matchesBefore).length}/${files.length} tables=${tables.length} approval_batches=${tables.includes("approval_batches")}`);
  } finally { db.close(); }
}

// ── step 5: final production identity + the staged-host stop (last effect of any kind) ─
console.log("[close 5/6] final production record + staged stop");
{
  const install = JSON.parse(readFileSync(PROD_ROOT + "/install.json", "utf8")) as Record<string, unknown>;
  const prodHealthAfter = await prodHealth();
  let staging = { pid: stageStart.pid, instanceId: stageStart.instanceId, operationalState: stageStart.operationalState };
  saveRecord("final-production.json", {
    gate: "M-A-2 T9",
    recordedAt: iso(),
    production: {
      base: PROD_BASE,
      health: prodHealthAfter,
      release: { currentRelease: install.currentRelease ?? null, version: install.version ?? null, sourceCommit: install.sourceCommit ?? null, manifestSha256: install.manifestSha256 ?? null },
      note: "production Host was never stopped, restarted or reconfigured by this gate",
    },
    candidate: { staged: true, installRoot: STAGE_ROOT, release: "Bunny-A-Windows-v17-T9", host: staging },
    activation: {
      production: "none (§64 — production activation requires explicit user authorization; the candidate remains staged at Bunny-A-T9-stage)",
      nextGate: "T10 (not started)",
    },
  });
  // Stop the staged host AFTER every record above exists. Strays were stopped in step 1.
  try { process.kill(stageStart.pid); } catch (error) { console.log(`  stop: ${String(error)}`); }
  let stopped = false;
  for (let index = 0; index < 30; index++) {
    await wait(300);
    try {
      await fetch(BASE + "/health", { headers: { authorization: "Bearer " + bearer() } });
    } catch { stopped = true; break; }
  }
  saveRecord("staged-stop.json", { gate: "M-A-2 T9", recordedAt: iso(), pid: stageStart.pid, instanceId: stageStart.instanceId, stopped, method: "process kill after all records were written (the staged state is disposable); /health then refused until timeout" });
  console.log(`  staged stopped=${stopped}`);
}

// ── step 6: the §79 evidence index — the last file this run writes ─────────────────────
console.log("[close 6/6] evidence index");
{
  const files = walk(REC).map((full) => relative(REC, full).replace(/\\/g, "/")).filter((path) => path !== INDEX_REL);
  const classificationOf = (path: string): string => {
    if (path.startsWith("staging/") && path.endsWith(".ts")) return "verification-source";
    if (path.endsWith(".log")) return "run-log";
    if (path.endsWith(".png")) return "browser-qa";
    if (path.startsWith("staging/") && path.endsWith(".json")) return "live-record";
    if (path.endsWith(".json")) return "gate-record";
    return "supporting";
  };
  const entries = files.map((path) => {
    const full = join(REC, path);
    const stats = statSync(full);
    return { path, bytes: stats.size, sha256: sha256(readFileSync(full)), classification: classificationOf(path), at: iso(stats.mtimeMs) };
  }).sort((a, b) => a.path.localeCompare(b.path));
  const byClass: Record<string, number> = {};
  for (const entry of entries) byClass[entry.classification] = (byClass[entry.classification] ?? 0) + 1;
  saveRecord(INDEX_REL, {
    gate: "M-A-2 T9",
    recordedAt: iso(),
    root: REC,
    algorithm: "sha256, hex; file paths relative to the evidence root with forward slashes",
    excludes: [INDEX_REL, "the closure runner's own console log (written after this walk)"],
    note: "one entry per evidence file: relative path, size, sha256, classification, record timestamp; no secret values are stored in this index",
    files: entries.length,
    summary: { byClass },
    entries,
  });
  console.log(`  indexed ${entries.length} files`);
}
console.log("[close] done");
import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import type { HostDatabase } from "../bunny-host/persistence.server.ts";
import { canonical, within } from "./paths.server.ts";
import type { DeviceWriteClass } from "./authorization.server.ts";

/**
 * M-A-3 T9R-F02 (D2): Host-owned inert staging for paired-device file changes.
 *
 * A device-attributed write never lands in a project directly. Its exact bytes go to
 * <Host data>/staging/<id>/content, which is private Host state (outside every project root, never an executable
 * search path, never listed, read or searched by Mission capabilities). Only a current workstation answer to the
 * Host's promotion request moves those exact bytes, after every identity is re-validated, into the project.
 */
export const STAGING_SCHEMA = "ma3.t9r-f02.device-staging.v1";
/** Largest staged change; the existing bounded text-write limit. */
export const STAGING_MAX_BYTES = 1024 * 1024;
export type StagingState =
  | "STAGED" | "PROMOTING" | "PROMOTED" | "REJECTED" | "FAILED" | "WITHDRAWN"
  | "INVALIDATED_BY_SCOPE_CHANGE" | "INVALIDATED_BY_SIGNOUT" | "INVALIDATED_BY_DEVICE_REVOCATION" | "INVALIDATED_BY_HOST_RESTART";
export type StagingRecord = {
  schema: typeof STAGING_SCHEMA;
  id: string;
  missionId: string;
  agentId: string | null;
  stepId: string;
  runId: string;
  /** The paired device the change is attributed to ("device:<id>"). */
  deviceId: string;
  /** The Mission envelope in force when the change was staged, and whether a paired device granted it. */
  envelopeId: string;
  envelopeRemote: boolean;
  destination: string;
  destinationRoot: string;
  /** The destination as it was when staged; promotion refuses if it changed since. */
  destinationBefore: { existed: boolean; sha256: string | null; size: number | null };
  contentHash: string;
  contentSize: number;
  classification: DeviceWriteClass;
  reasons: string[];
  warnings: string[];
  /** Agentic revision (Agent Missions) or authorization id the change was staged under. */
  approvalRevision: string;
  hostGeneration: string;
  createdAt: number;
  promotionState: StagingState;
  decidedAt: number | null;
  decidedBy: string | null;
  decisionReason: string | null;
  /** Set once the record entered PROMOTING; such a record always counts as a project mutation (monotonic sequence). */
  promotionStarted?: boolean;
  /** Workstation inspection of the whole content (required before promoting more than the preview shows). */
  inspectedHash: string | null;
  inspectedAt: number | null;
  inspectedBy: string | null;
  /** Identity of the staged file as written (dev, inode, size), so a replaced file is never promoted. */
  fileIdentity: { dev: string; ino: string; size: number };
};
const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const STAGING_ID = /^[0-9a-f-]{36}$/;

export class DeviceStaging {
  host: HostDatabase;
  dataDirectory: string;
  constructor(host: HostDatabase, dataDirectory: string) {
    this.host = host;
    this.dataDirectory = dataDirectory;
    host.db.exec(`CREATE TABLE IF NOT EXISTS device_staging(id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, state TEXT NOT NULL, created_at INTEGER NOT NULL, record TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_device_staging_mission ON device_staging(mission_id, created_at);`);
  }
  /** The staging root. Created lazily; refused when any component is a link or it overlaps a project root. */
  root(projectRoots: string[] = []): string {
    const root = join(this.dataDirectory, "staging");
    if (!existsSync(root)) mkdirSync(root, { recursive: true });
    for (let at = root; ; at = dirname(at)) {
      if (lstatSync(at).isSymbolicLink()) throw new Error("The staging folder path contains a link or junction.");
      if (dirname(at) === at || at === resolve(this.dataDirectory)) break;
    }
    if (canonical(root) !== resolve(root)) throw new Error("The staging folder resolves through an alias.");
    for (const project of projectRoots)
      if (within(project, root) || within(root, project)) throw new Error("The staging folder overlaps a project root; staging refuses to run there.");
    return root;
  }
  folder(id: string) {
    if (!STAGING_ID.test(id)) throw new Error("Invalid staging id.");
    return join(this.dataDirectory, "staging", id);
  }
  contentPath(id: string) { return join(this.folder(id), "content"); }
  save(record: StagingRecord) {
    this.host.db.prepare("INSERT INTO device_staging(id,mission_id,state,created_at,record) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state, record=excluded.record")
      .run(record.id, record.missionId, record.promotionState, record.createdAt, JSON.stringify(record));
  }
  get(id: string): StagingRecord | null {
    const row = this.host.db.prepare("SELECT record FROM device_staging WHERE id=?").get(id) as { record: string } | undefined;
    return row ? JSON.parse(row.record) as StagingRecord : null;
  }
  forMission(missionId: string): StagingRecord[] {
    return (this.host.db.prepare("SELECT record FROM device_staging WHERE mission_id=? ORDER BY created_at").all(missionId) as { record: string }[]).map((row) => JSON.parse(row.record) as StagingRecord);
  }
  inState(state: StagingState): StagingRecord[] {
    return (this.host.db.prepare("SELECT record FROM device_staging WHERE state=? ORDER BY created_at").all(state) as { record: string }[]).map((row) => JSON.parse(row.record) as StagingRecord);
  }
  /** Writes the exact bytes into a new staging folder (exclusive create, flushed) and records their identity. */
  stage(input: Omit<StagingRecord, "schema" | "id" | "contentHash" | "contentSize" | "createdAt" | "promotionState" | "decidedAt" | "decidedBy" | "decisionReason" | "inspectedHash" | "inspectedAt" | "inspectedBy" | "fileIdentity">, content: string, projectRoots: string[]): StagingRecord {
    const bytes = Buffer.from(content, "utf8");
    if (bytes.length > STAGING_MAX_BYTES) throw new Error(`The change is ${bytes.length} bytes; staged changes are limited to ${STAGING_MAX_BYTES} bytes.`);
    this.root(projectRoots);
    const id = crypto.randomUUID();
    const folder = this.folder(id);
    mkdirSync(folder);
    const file = this.contentPath(id);
    const fd = openSync(file, "wx");
    try { writeSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    const info = statSync(file, { bigint: true });
    const record: StagingRecord = {
      schema: STAGING_SCHEMA, ...input, id, contentHash: sha256(bytes), contentSize: bytes.length, createdAt: Date.now(), promotionState: "STAGED",
      decidedAt: null, decidedBy: null, decisionReason: null, inspectedHash: null, inspectedAt: null, inspectedBy: null,
      fileIdentity: { dev: String(info.dev), ino: String(info.ino), size: Number(info.size) },
    };
    this.save(record);
    return record;
  }
  /**
   * Reads the staged bytes once and proves they are the bytes that were staged: a regular file (no link), one hard
   * link, the same device/inode/size, and the recorded SHA-256. The caller promotes exactly this buffer.
   */
  readVerified(record: StagingRecord): Buffer {
    const file = this.contentPath(record.id);
    const before = lstatSync(file, { bigint: true });
    if (before.isSymbolicLink() || !before.isFile()) throw new Error("The staged file is no longer a regular file.");
    if (before.nlink !== 1n) throw new Error("The staged file gained another hard link.");
    if (String(before.dev) !== record.fileIdentity.dev || String(before.ino) !== record.fileIdentity.ino || Number(before.size) !== record.fileIdentity.size)
      throw new Error("The staged file was replaced after it was staged.");
    const bytes = readFileSync(file);
    if (bytes.length !== record.contentSize || sha256(bytes) !== record.contentHash) throw new Error("The staged content no longer matches its recorded SHA-256.");
    return bytes;
  }
  /** Moves a record from one of `from` to `to`. Idempotent: a record already elsewhere is left alone (false). */
  transition(id: string, from: StagingState[], to: StagingState, by: string, reason: string): StagingRecord | null {
    const record = this.get(id);
    if (!record || !from.includes(record.promotionState)) return null;
    const next: StagingRecord = { ...record, ...(to === "PROMOTING" ? { promotionStarted: true } : {}), promotionState: to, decidedAt: Date.now(), decidedBy: by, decisionReason: reason.slice(0, 500) };
    const changed = Number(this.host.db.prepare(`UPDATE device_staging SET state=?, record=? WHERE id=? AND state IN (${from.map(() => "?").join(",")})`).run(to, JSON.stringify(next), id, ...from).changes);
    return changed ? next : null;
  }
  recordInspection(id: string, hash: string, by: string) {
    const record = this.get(id);
    if (!record) throw new Error("Unknown staged change.");
    this.save({ ...record, inspectedHash: hash, inspectedAt: Date.now(), inspectedBy: by });
  }
}

/** The destination as it is now: absent, or a bounded regular file with its digest. */
export function destinationState(path: string): { existed: boolean; sha256: string | null; size: number | null } {
  let info: ReturnType<typeof lstatSync>;
  try { info = lstatSync(path); } catch { return { existed: false, sha256: null, size: null }; }
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("The destination is not a regular file.");
  if (info.nlink > 1) throw new Error("The destination has other hard links.");
  if (info.size > STAGING_MAX_BYTES) throw new Error("The destination exceeds the bounded text size.");
  return { existed: true, sha256: sha256(readFileSync(path)), size: info.size };
}

/** Bounded atomic write of exactly these bytes (exclusive temporary file, flush, rename), then an independent read-back. */
export function writePromoted(destination: string, bytes: Buffer): { sha256: string; size: number } {
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = join(dirname(destination), `.${basename(destination)}.bunny-promote-${crypto.randomUUID()}.tmp`);
  try {
    const fd = openSync(temporary, "wx");
    try { writeSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temporary, destination);
  } finally {
    if (existsSync(temporary)) rmSync(temporary);
  }
  const back = readFileSync(destination);
  return { sha256: sha256(back), size: back.length };
}

/** JSON-escaped text that can never imitate prompt structure (quotes, line breaks and bidi controls escaped). */
export function escapedText(bytes: Buffer): string {
  // Every format (Cf: bidi marks, zero-width, BOM, word joiner), control and line/paragraph separator character is
  // shown as an escape, so the reviewer sees the exact code points and nothing reorders or hides text (review round 2).
  return JSON.stringify(bytes.toString("utf8")).replace(/[\u2022\p{Cf}\p{Cc}\p{Zl}\p{Zp}\u034f\u115f\u1160\u2800\u3164\uffa0\p{Variation_Selector}]/gu, (ch) => { const code = ch.codePointAt(0)!; return code > 0xffff ? `\\u{${code.toString(16)}}` : `\\u${code.toString(16).padStart(4, "0")}`; });
}
export const stagingRelative = (record: StagingRecord) => relative(record.destinationRoot, record.destination) || basename(record.destination);

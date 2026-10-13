import { createHash } from "node:crypto";
import { createReadStream, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { MissionStore } from "./store.server.ts";
import type { Artifact, ArtifactType } from "./types.ts";

const INLINE_LIMIT = 64 * 1024;
const HASH_LIMIT = 200 * 1024 * 1024;
const safeName = (value: string) => value.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "artifact";
export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
function hashFile(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const hash = createHash("sha256"); const stream = createReadStream(path);
    stream.on("data", (chunk) => {try {hash.update(chunk);} catch(error) {stream.destroy();reject(error);}}); stream.on("error", reject); stream.on("end", () => {try {resolveHash(hash.digest("hex"));} catch(error) {reject(error);}});
  });
}

/**
 * Mission artifacts are exchanged by reference. Small text/JSON lives inline in the Host database; larger
 * bodies and binary evidence live as files under the Host data folder (or stay where a capability wrote
 * them inside an approved root). Every artifact carries a SHA-256 of its content.
 */
export class ArtifactStore {
  store: MissionStore; directory: string;
  constructor(store: MissionStore, dataDirectory: string) { this.store = store; this.directory = join(dataDirectory, "artifacts"); }
  folder(missionId: string) { const path = join(this.directory, safeName(missionId)); mkdirSync(path, { recursive: true }); return path; }
  async create(input: { missionId: string; stepId: string | null; type: ArtifactType; title: string; inline?: string; path?: string; mediaType: string; provenance: string; verification?: Artifact["verification"] }): Promise<Artifact> {
    const id = crypto.randomUUID(); const createdAt = Date.now();
    let location: Artifact["location"]; let body: string | null = null; let digest: string; let bytes: number;
    if (input.inline !== undefined && Buffer.byteLength(input.inline) <= INLINE_LIMIT) {
      location = { kind: "inline", mediaType: input.mediaType }; body = input.inline; digest = sha256(input.inline); bytes = Buffer.byteLength(input.inline);
    } else if (input.inline !== undefined) {
      const path = join(this.folder(input.missionId), `${id.slice(0, 8)}-${safeName(input.title)}.txt`);
      writeFileSync(path, input.inline, "utf8");
      location = { kind: "file", path, mediaType: input.mediaType }; digest = sha256(input.inline); bytes = Buffer.byteLength(input.inline);
    } else if (input.path) {
      const info = statSync(input.path);
      if (!info.isFile()) throw new Error("Artifact path must be a file.");
      location = { kind: "file", path: input.path, mediaType: input.mediaType }; bytes = info.size;
      digest = info.size <= HASH_LIMIT ? await hashFile(input.path) : "not-hashed:file-too-large";
    } else throw new Error("An artifact needs inline content or a file path.");
    const artifact: Artifact = { id, missionId: input.missionId, stepId: input.stepId, type: input.type, title: input.title.slice(0, 160), location, sha256: digest, bytes, createdAt, verification: input.verification ?? "unverified", consumers: [], provenance: input.provenance };
    this.store.saveArtifact(artifact, body);
    return artifact;
  }
  get(id: string) { return this.store.artifact(id); }
  /** Records that a step consumed an artifact; the consumer receives the reference, not a copy. */
  consume(id: string, consumer: string) {
    const { artifact, body } = this.store.artifact(id);
    if (!artifact.consumers.includes(consumer)) this.store.saveArtifact({ ...artifact, consumers: [...artifact.consumers, consumer] }, body);
  }
  mark(id: string, verification: Artifact["verification"]) {
    const { artifact, body } = this.store.artifact(id);
    this.store.saveArtifact({ ...artifact, verification }, body);
  }
  /** A bounded excerpt for agent context: references carry the location, never the whole body. */
  excerpt(id: string, max = 1200): string {
    const { artifact, body } = this.store.artifact(id);
    const where = artifact.location.kind === "file" ? ` at ${artifact.location.path}` : "";
    const text = body ? (body.length > max ? `${body.slice(0, max)}… [${body.length - max} more characters in artifact ${artifact.id}]` : body) : "";
    return `[artifact ${artifact.id} · ${artifact.type} · ${artifact.bytes} bytes · sha256 ${artifact.sha256.slice(0, 12)}${where}]${text ? `\n${text}` : ""}`;
  }
}

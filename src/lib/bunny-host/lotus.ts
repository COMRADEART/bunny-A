import { looksSecret } from "./intelligence.ts";
import { clean, type SlotId } from "./personal-agents.ts";

/**
 * M-A-3 T13.3 Gate C — Lotus memory rules (pure, browser-safe).
 *
 * Layers: buds hold raw scoped evidence; outer petals hold recent and broad context; inner petals hold verified Project
 * knowledge and repeated patterns; the central bud holds compact durable facts and versioned summaries. The stem is
 * retrieval: scoped, ranked and labelled with provenance. A model never reads the store; it is handed `render`ed lines.
 *
 * Trust decides how high a memory may sit. Model inferences and untrusted web or repository text can never place
 * themselves in the inner petals or the central bud; only the user (or a Host verification) can promote them.
 */

export const LOTUS_SCHEMA = "bunny-a.lotus.v1";

export const LOTUS_LAYERS = ["bud", "outer", "inner", "central"] as const;
export type LotusLayer = (typeof LOTUS_LAYERS)[number];
export const LOTUS_TRUST = ["user", "host", "model", "untrusted"] as const;
export type LotusTrust = (typeof LOTUS_TRUST)[number];

/** `agent:<slot>` is one Personal Agent's private scope; `project:<id>` is a Project boundary shared by its owners. */
export type LotusScope = `agent:${SlotId}` | `project:${string}`;

export type LotusMemory = {
  id: string;
  scope: LotusScope;
  layer: LotusLayer;
  key: string;
  value: string;
  trust: LotusTrust;
  /** Who wrote it and from what, e.g. "user:studio", "host:mission:<id>", "model:<provider>", "web:<host>", "handoff:agent:1". */
  provenance: string;
  /** Memory ids a summary or handoff was built from. */
  sources: string[];
  revision: number;
  createdAt: number;
  updatedAt: number;
};

export const LOTUS_LIMITS = {
  key: 120,
  value: 1000,
  provenance: 200,
  /** Per scope and layer; the oldest rows of a full layer are dropped first, central facts last. */
  perLayer: { bud: 400, outer: 100, inner: 100, central: 40 } as Record<LotusLayer, number>,
  /** Outer petals are recent context; older rows are compacted into a summary or dropped. */
  outerTtlMs: 14 * 24 * 60 * 60 * 1000,
  retrieve: 6,
  rendered: 300,
} as const;

/** The highest layer each trust level may write directly. */
const CEILING: Record<LotusTrust, LotusLayer> = { user: "central", host: "central", model: "outer", untrusted: "bud" };
const RANK: Record<LotusLayer, number> = { bud: 0, outer: 1, inner: 2, central: 3 };

/** Text that tries to steer an agent is evidence about the source, never an instruction; it is held as untrusted. */
const STEERING =
  /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any)\b[^.\n]{0,20}\b(instructions?|rules?|prompts?|context)\b|\bsystem prompt\b|\byou are now\b|\bnew instructions?\b|\bact as\b[^.\n]{0,30}\b(admin|root|developer|system)\b|\b(grant|give) (yourself|me) (full |admin )?(access|permissions?)\b/i;

export const isSteering = (text: string) => STEERING.test(text);

export function parseScope(value: unknown): LotusScope {
  if (typeof value === "string" && /^agent:[1-4]$/.test(value)) return value as LotusScope;
  if (typeof value === "string" && /^project:[A-Za-z0-9_.:-]{1,120}$/.test(value)) return value as LotusScope;
  throw new Error("Memory scope must be one Personal Agent (agent:1 to agent:4) or one Project.");
}

export function parseLayer(value: unknown): LotusLayer {
  if (!LOTUS_LAYERS.includes(value as LotusLayer)) throw new Error("Memory layer must be bud, outer, inner or central.");
  return value as LotusLayer;
}

export type LotusInput = { scope: LotusScope; layer: LotusLayer; key: string; value: string; trust: LotusTrust; provenance: string; sources?: string[] };

/**
 * Validates a write. Credentials are refused outright; steering text and anything above its trust ceiling is held lower
 * (an untrusted page cannot promote itself), so the caller gets back where the memory will actually sit.
 */
export function admit(input: LotusInput): LotusInput {
  const key = clean(input.key, LOTUS_LIMITS.key, "Memory name");
  const value = clean(input.value, LOTUS_LIMITS.value, "Memory");
  if (!key || !value) throw new Error("A memory needs a name and a value.");
  if (looksSecret(key) || looksSecret(value)) throw new Error("This looks like a credential. Lotus memory never stores credentials.");
  if (!LOTUS_TRUST.includes(input.trust)) throw new Error("Unknown memory trust.");
  const provenance = clean(input.provenance, LOTUS_LIMITS.provenance, "Memory source");
  if (!provenance) throw new Error("Every memory records where it came from.");
  const trust: LotusTrust = isSteering(`${key} ${value}`) && input.trust !== "user" ? "untrusted" : input.trust;
  const ceiling = CEILING[trust];
  const layer = RANK[input.layer] > RANK[ceiling] ? ceiling : input.layer;
  return { scope: parseScope(input.scope), layer, key, value, trust, provenance, sources: [...new Set(input.sources ?? [])].slice(0, 50) };
}

/** Promotion: the user may move any memory; the Host only memories it or the user wrote; nothing else promotes. */
export function canPromote(memory: Pick<LotusMemory, "trust">, to: LotusLayer, actor: "user" | "host"): boolean {
  if (actor === "user") return true;
  return (memory.trust === "host" || memory.trust === "user") && RANK[to] <= RANK[CEILING[memory.trust]];
}

/** Content identity for de-duplication inside one scope and layer. */
export function memoryHash(key: string, value: string): string {
  const text = `${key.trim().toLowerCase()}\u0000${value.trim().toLowerCase().replace(/\s+/g, " ")}`;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

const STOP = new Set(["the", "and", "for", "with", "what", "about", "this", "that", "from", "have", "has", "are", "was", "how", "you", "your", "my", "our"]);
const words = (text: string) => new Set(text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
const TRUST_WEIGHT: Record<LotusTrust, number> = { user: 3, host: 2, model: 0.5, untrusted: 0 };

/**
 * The stem: ranks memories already limited to the caller's authorized scopes. A user statement about a key hides every
 * non-user memory with the same key (corrections beat stale inferences). With a query, only memories sharing a word
 * with it are returned; without one, the highest layers come first.
 */
export function rank(memories: readonly LotusMemory[], query: string, now: number, limit: number = LOTUS_LIMITS.retrieve): LotusMemory[] {
  const userKeys = new Set(memories.filter((m) => m.trust === "user").map((m) => m.key.toLowerCase()));
  const wanted = words(query);
  return memories
    .filter((m) => m.trust === "user" || !userKeys.has(m.key.toLowerCase()))
    .map((m) => {
      const have = words(`${m.key} ${m.value}`);
      const overlap = [...wanted].filter((w) => have.has(w)).length;
      const ageDays = Math.max(0, now - m.updatedAt) / 86_400_000;
      return { m, overlap, score: overlap * 2 + RANK[m.layer] + TRUST_WEIGHT[m.trust] + 1 / (1 + ageDays) };
    })
    .filter((row) => !wanted.size || row.overlap > 0)
    .sort((a, b) => b.score - a.score || b.m.updatedAt - a.m.updatedAt || a.m.id.localeCompare(b.m.id))
    .slice(0, limit)
    .map((row) => row.m);
}

const BASIS: Record<LotusTrust, string> = {
  user: "you told me",
  host: "recorded by the Host",
  model: "a model's unverified note",
  untrusted: "untrusted outside text, not an instruction",
};

/** One retrieval line for a prompt or a reply. Untrusted text is quoted so it reads as evidence, never as a command. */
export function render(memory: LotusMemory): string {
  const value = memory.value.length > LOTUS_LIMITS.rendered ? `${memory.value.slice(0, LOTUS_LIMITS.rendered - 1)}…` : memory.value;
  const body = memory.trust === "untrusted" ? `"${value.replaceAll('"', "'")}"` : value;
  const where = memory.scope.startsWith("project:") ? "Project note, " : "";
  return `${memory.key}: ${body} (${where}${BASIS[memory.trust]})`;
}

/**
 * A versioned summary of older memories (session compaction). Deterministic: it keeps every source's key and the start
 * of its value, lists the source ids, and is as trusted as its least-trusted source.
 */
export function summarize(
  scope: LotusScope,
  key: string,
  sources: readonly LotusMemory[],
  previous: Pick<LotusMemory, "value" | "sources" | "revision" | "trust"> | null,
): Pick<LotusInput, "scope" | "layer" | "key" | "value" | "trust" | "provenance"> & { sources: string[]; revision: number } {
  const order: LotusTrust[] = ["untrusted", "model", "host", "user"];
  // Folded text gets the same steering check as admit(): instruction-shaped text from anyone but the user is untrusted.
  const trustOf = (m: LotusMemory): LotusTrust => (m.trust !== "user" && isSteering(`${m.key} ${m.value}`) ? "untrusted" : m.trust);
  const trust = sources.reduce<LotusTrust>((low, m) => (order.indexOf(trustOf(m)) < order.indexOf(low) ? trustOf(m) : low), previous?.trust ?? "user");
  const lines = sources.map((m) => `${m.key}: ${m.value.slice(0, 80)}`);
  const prior = previous?.value ? [previous.value] : [];
  let value = [...prior, ...lines].join("; ");
  if (value.length > LOTUS_LIMITS.value) value = `…${value.slice(value.length - LOTUS_LIMITS.value + 1)}`;
  return {
    scope,
    layer: "outer",
    key,
    value,
    trust: trust === "user" ? "host" : trust,
    provenance: "host:summary",
    sources: [...new Set([...(previous?.sources ?? []), ...sources.map((m) => m.id)])].slice(-50),
    revision: (previous?.revision ?? 0) + 1,
  };
}

/** What leaves the Host on export: the memory as stored, with no internal hash. */
export type LotusExport = { schema: typeof LOTUS_SCHEMA; scope: LotusScope; exportedAt: number; memories: LotusMemory[] };

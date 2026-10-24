import { z } from "zod";
import { ACCOUNT_ID, EMAIL_ADDRESS, sha256 } from "../task-runtime.ts";
import { ACTION_SCHEMA, RESULT_SCHEMA, type ActionContext, type ActionContract, type Connector, type ConnectorOutcome, type Prepared, type Requirement } from "../action-broker.server.ts";

/**
 * MA4-S2-T2 provider-neutral service adapters: email, calendar and cloud documents. Each operation is a contract over a
 * provider interface; a real provider (Gmail, Microsoft Graph, Drive...) would implement the same interface with
 * delegated OAuth scopes. Credentials never cross the interface: a provider fetches its own token from a vault by account
 * id, so tokens are absent from step inputs, results, prompts, receipts and logs.
 *
 * This milestone ships no live provider. SyntheticWorkspace is a recorded emulator used for qualification; the Host
 * registers these adapters only when a provider is supplied, so in production every email/calendar/docs step is refused
 * at validation ("no registered executor") and nothing claims to be connected.
 */
export type MailSummary = { id: string; from: string; subject: string; receivedAt: number; snippet: string };
export type MailMessage = MailSummary & { to: string[]; body: string };
export type Draft = { to: string[]; subject: string; body: string };
export type CalendarEvent = { id: string; title: string; start: number; end: number; attendees: string[] };
export type Doc = { id: string; title: string; version: string; content: string };
/** Thrown by a provider when the call was rejected before any effect (auth, validation, not found). */
export class ProviderRejected extends Error {}

export interface ServiceProvider {
  readonly id: string;
  accounts(connector: "email" | "calendar" | "docs"): string[];
  mail: {
    list(account: string, folder: "inbox" | "sent" | "drafts", limit: number): Promise<MailSummary[]>;
    read(account: string, id: string): Promise<MailMessage>;
    /** Idempotent by key: the same key returns the same draft. */
    createDraft(account: string, draft: Draft, key: string): Promise<{ draftId: string }>;
    findDraft(account: string, key: string): Promise<{ draftId: string } | null>;
    /** Idempotent by key (client message id): a repeat with the same key never sends twice. */
    send(account: string, draft: Draft, key: string): Promise<{ messageId: string }>;
    findSent(account: string, key: string): Promise<{ messageId: string } | null>;
  };
  calendar: {
    events(account: string, from: number, to: number): Promise<CalendarEvent[]>;
    /** Notifies attendees. No lookup by key exists: an interrupted create is genuinely uncertain. */
    create(account: string, event: Omit<CalendarEvent, "id">): Promise<{ eventId: string }>;
  };
  docs: {
    list(account: string): Promise<Omit<Doc, "content">[]>;
    read(account: string, id: string): Promise<Doc>;
    /** Conditional on the expected version; the provider refuses a stale write. */
    write(account: string, id: string, content: string, expectedVersion: string): Promise<{ version: string }>;
  };
}

export type CredentialVault = { token(provider: string, account: string): string | null };
type Call = { op: string; account: string; key?: string; at: number };
/**
 * Recorded synthetic emulator of one person's mail, calendar and documents. Every call needs the vault's bearer token
 * (as a real API would) and is recorded. `fault` lets a test fail an operation before or after its effect.
 */
export class SyntheticWorkspace implements ServiceProvider {
  readonly id = "synthetic";
  readonly calls: Call[] = [];
  readonly sent: (Draft & { messageId: string; key: string; account: string })[] = [];
  readonly drafts: (Draft & { draftId: string; key: string; account: string })[] = [];
  readonly invites: (Omit<CalendarEvent, "id"> & { eventId: string; account: string })[] = [];
  inbox: MailMessage[] = [];
  events: CalendarEvent[] = [];
  docsStore = new Map<string, Doc>();
  fault: { op: string; when: "before" | "after" } | null = null;
  private vault: CredentialVault;
  private n = 0;
  readonly accountIds: Record<"email" | "calendar" | "docs", string[]>;
  constructor(vault: CredentialVault, accountIds: Record<"email" | "calendar" | "docs", string[]>) { this.vault = vault; this.accountIds = accountIds; }
  accounts(connector: "email" | "calendar" | "docs") { return this.accountIds[connector]; }
  private auth(op: string, account: string, key?: string) {
    if (!this.vault.token(this.id, account)) throw new ProviderRejected(`No delegated credential for ${account}.`);
    this.calls.push({ op, account, key, at: Date.now() });
    if (this.fault?.op === op && this.fault.when === "before") { this.fault = null; throw new Error(`${op}: network error before the request was accepted`); }
  }
  private after(op: string) { if (this.fault?.op === op && this.fault.when === "after") { this.fault = null; throw new Error(`${op}: connection lost before the provider answered`); } }
  private id_(prefix: string) { return `${prefix}-${++this.n}`; }
  mail = {
    list: async (account: string, folder: "inbox" | "sent" | "drafts", limit: number) => {
      this.auth("mail.list", account);
      const rows = folder === "inbox" ? this.inbox : folder === "sent" ? this.sent.map(s => ({ id: s.messageId, from: account, subject: s.subject, receivedAt: 0, snippet: s.body.slice(0, 80), to: s.to, body: s.body })) : this.drafts.map(d => ({ id: d.draftId, from: account, subject: d.subject, receivedAt: 0, snippet: d.body.slice(0, 80), to: d.to, body: d.body }));
      return rows.slice(0, limit).map(({ id, from, subject, receivedAt, snippet }) => ({ id, from, subject, receivedAt, snippet }));
    },
    read: async (account: string, id: string) => {
      this.auth("mail.read", account);
      const m = this.inbox.find(x => x.id === id);
      if (!m) throw new ProviderRejected(`Message ${id} not found.`);
      return m;
    },
    createDraft: async (account: string, draft: Draft, key: string) => {
      this.auth("mail.createDraft", account, key);
      const existing = this.drafts.find(d => d.key === key && d.account === account);
      if (existing) return { draftId: existing.draftId };
      const draftId = this.id_("draft"); this.drafts.push({ ...draft, draftId, key, account }); this.after("mail.createDraft");
      return { draftId };
    },
    findDraft: async (account: string, key: string) => { this.auth("mail.findDraft", account, key); const d = this.drafts.find(x => x.key === key && x.account === account); return d ? { draftId: d.draftId } : null; },
    send: async (account: string, draft: Draft, key: string) => {
      this.auth("mail.send", account, key);
      const existing = this.sent.find(s => s.key === key && s.account === account);
      if (existing) return { messageId: existing.messageId };
      const messageId = this.id_("msg"); this.sent.push({ ...draft, messageId, key, account }); this.after("mail.send");
      return { messageId };
    },
    findSent: async (account: string, key: string) => { this.auth("mail.findSent", account, key); const s = this.sent.find(x => x.key === key && x.account === account); return s ? { messageId: s.messageId } : null; },
  };
  calendar = {
    events: async (account: string, from: number, to: number) => { this.auth("calendar.events", account); return this.events.filter(e => e.end > from && e.start < to); },
    create: async (account: string, event: Omit<CalendarEvent, "id">) => {
      this.auth("calendar.create", account);
      const eventId = this.id_("evt"); this.invites.push({ ...event, eventId, account }); this.events.push({ ...event, id: eventId }); this.after("calendar.create");
      return { eventId };
    },
  };
  docs = {
    list: async (account: string) => { this.auth("docs.list", account); return [...this.docsStore.values()].map(({ content: _c, ...d }) => d); },
    read: async (account: string, id: string) => { this.auth("docs.read", account); const d = this.docsStore.get(id); if (!d) throw new ProviderRejected(`Document ${id} not found.`); return d; },
    write: async (account: string, id: string, content: string, expectedVersion: string) => {
      this.auth("docs.write", account);
      const d = this.docsStore.get(id);
      if (!d) throw new ProviderRejected(`Document ${id} not found.`);
      if (d.version !== expectedVersion) throw new ProviderRejected(`Document ${id} is at version ${d.version}, not ${expectedVersion}.`);
      const version = sha256(content).slice(0, 16); this.docsStore.set(id, { ...d, content, version }); this.after("docs.write");
      return { version };
    },
  };
}

const account = z.string().regex(ACCOUNT_ID);
const stepRef = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/);
/** "a@x.com, b@y.org" → exact, validated, lower-cased, de-duplicated recipients (at most 20). */
const recipients = z.string().max(2_000).transform((raw, ctx) => {
  const list = [...new Set(raw.split(/[,;]/).map(s => s.trim().toLowerCase()).filter(Boolean))];
  if (!list.length || list.length > 20 || list.some(r => !EMAIL_ADDRESS.test(r))) { ctx.addIssue({ code: "custom", message: "Give 1-20 plain email addresses separated by commas." }); return z.NEVER; }
  return list.sort();
});
const fail = (error: unknown, dispatched = false): ConnectorOutcome => ({ ok: false, error: error instanceof Error ? error.message : String(error), dispatched, definite: error instanceof ProviderRejected });
/** Text a generating step produced; never a connector's (untrusted) result. */
function textFrom(ctx: ActionContext, inline: string | undefined, from: string | undefined, what: string): string {
  if ((inline === undefined) === (from === undefined)) throw new ProviderRejected(`Give exactly one of ${what} or ${what}From.`);
  const text = inline ?? ctx.outputOf(from!);
  if (text === null || text === undefined) throw new ProviderRejected(`Step ${from} has no result.`);
  if (text.includes(`"schema":"${RESULT_SCHEMA}"`)) throw new ProviderRejected(`${what}From must name a generating step, not a connector result.`);
  return text.slice(0, 20_000);
}

export function serviceConnectors(provider: ServiceProvider): Connector<never>[] {
  const available = (r: Requirement) => r.kind === "service" && !provider.accounts(r.connector).includes(r.account) ? `No ${r.connector} account "${r.account}" is connected on this PC.` : null;
  const base = { schema: ACTION_SCHEMA, maxResultChars: 60_000, timeoutMs: 30_000, untrusted: true };
  const read = <I>(c: Omit<ActionContract<I>, "schema" | "maxResultChars" | "timeoutMs" | "untrusted" | "category" | "sideEffect" | "consequential" | "idempotency">, run: Connector<I>["run"]): Connector<I> =>
    ({ available, contract: { ...base, ...c, category: "read_only", sideEffect: false, consequential: false, idempotency: "none" }, run });

  // ── email ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  type DraftIn = { account: string; to: string[]; subject: string; body?: string; bodyFrom?: string };
  const draftIn = z.object({ account, to: recipients, subject: z.string().trim().min(1).max(200), body: z.string().max(8_000).optional(), bodyFrom: stepRef.optional() }).strict();
  const draftOf = (i: DraftIn, ctx: ActionContext): Draft => ({ to: i.to, subject: i.subject, body: textFrom(ctx, i.body, i.bodyFrom, "body") });
  const mailList = read<{ account: string; folder: "inbox" | "sent" | "drafts"; limit: number }>({ kind: "email.list", connector: "email", operation: "list", resource: "message", activity: "Reading files",
    input: z.object({ account, folder: z.enum(["inbox", "sent", "drafts"]).default("inbox"), limit: z.number().int().min(1).max(50).default(20) }).strict(),
    result: z.object({ account: z.string(), messages: z.array(z.object({ id: z.string(), from: z.string(), subject: z.string(), receivedAt: z.number(), snippet: z.string() })) }),
    requires: i => [{ kind: "service", connector: "email", account: i.account, access: "read", recipients: [] }] },
  async (i) => { try { return { ok: true, result: { account: i.account, messages: await provider.mail.list(i.account, i.folder, i.limit) } }; } catch (e) { return fail(e); } });
  const mailRead = read<{ account: string; messageId: string }>({ kind: "email.read", connector: "email", operation: "read", resource: "message", activity: "Reading files",
    input: z.object({ account, messageId: z.string().min(1).max(200) }).strict(),
    result: z.object({ account: z.string(), message: z.object({ id: z.string(), from: z.string(), to: z.array(z.string()), subject: z.string(), receivedAt: z.number(), body: z.string() }) }),
    requires: i => [{ kind: "service", connector: "email", account: i.account, access: "read", recipients: [] }] },
  async (i) => { try { const m = await provider.mail.read(i.account, i.messageId); return { ok: true, result: { account: i.account, message: { id: m.id, from: m.from, to: m.to, subject: m.subject, receivedAt: m.receivedAt, body: m.body.slice(0, 20_000) } } }; } catch (e) { return fail(e); } });
  const mailDraft: Connector<DraftIn> = {
    available,
    contract: { ...base, untrusted: false, kind: "email.draft", connector: "email", operation: "create-draft", resource: "draft", category: "idempotent", sideEffect: true, consequential: false, activity: "Preparing draft", idempotency: "key",
      input: draftIn, result: z.object({ account: z.string(), draftId: z.string(), to: z.array(z.string()), subject: z.string(), bodySha256: z.string(), sent: z.literal(false) }),
      requires: i => [{ kind: "service", connector: "email", account: i.account, access: "draft", recipients: i.to }] },
    async run(i, ctx) {
      let d: Draft; try { d = draftOf(i, ctx); } catch (e) { return fail(e); }
      try { const r = await provider.mail.createDraft(i.account, d, ctx.idempotencyKey); return { ok: true, result: { account: i.account, draftId: r.draftId, to: d.to, subject: d.subject, bodySha256: sha256(d.body), sent: false }, receipt: `draft:${r.draftId}` }; }
      catch (e) { return fail(e, !(e instanceof ProviderRejected)); }
    },
    async verify(i, ctx) {
      const r = await provider.mail.findDraft(i.account, ctx.idempotencyKey); if (!r) return { found: false };
      const d = draftOf(i, ctx); return { found: true, result: { account: i.account, draftId: r.draftId, to: d.to, subject: d.subject, bodySha256: sha256(d.body), sent: false }, receipt: `draft:${r.draftId}` };
    },
  };
  const mailSend: Connector<DraftIn> = {
    available,
    contract: { ...base, untrusted: false, kind: "email.send", connector: "email", operation: "send", resource: "message", category: "idempotent", sideEffect: true, consequential: true, activity: "Executing", idempotency: "key",
      input: draftIn, result: z.object({ account: z.string(), messageId: z.string(), to: z.array(z.string()), subject: z.string(), bodySha256: z.string() }),
      requires: i => [{ kind: "service", connector: "email", account: i.account, access: "send", recipients: i.to }] },
    async prepare(i, ctx): Promise<Prepared> {
      const d = draftOf(i, ctx);
      return { target: `Email · ${i.account}`, summary: `Send "${d.subject}" to ${d.to.length} recipient${d.to.length === 1 ? "" : "s"}`,
        effects: [`Delivers an email to ${d.to.length} recipient${d.to.length === 1 ? "" : "s"}.`, "It cannot be unsent."], data: [`Sends the subject and a ${d.body.length}-character body from account ${i.account}.`],
        changes: d.to.map(r => `To: ${r}`), preview: `To: ${d.to.join(", ")}\nSubject: ${d.subject}\n\n${d.body}`, reversible: false,
        payload: { account: i.account, to: d.to, subject: d.subject, bodySha256: sha256(d.body) } };
    },
    async run(i, ctx) {
      let d: Draft; try { d = draftOf(i, ctx); } catch (e) { return fail(e); }
      try { const r = await provider.mail.send(i.account, d, ctx.idempotencyKey); return { ok: true, result: { account: i.account, messageId: r.messageId, to: d.to, subject: d.subject, bodySha256: sha256(d.body) }, receipt: `message:${r.messageId}` }; }
      catch (e) { return fail(e, !(e instanceof ProviderRejected)); }
    },
    async verify(i, ctx) {
      const r = await provider.mail.findSent(i.account, ctx.idempotencyKey); if (!r) return { found: false };
      const d = draftOf(i, ctx); return { found: true, result: { account: i.account, messageId: r.messageId, to: d.to, subject: d.subject, bodySha256: sha256(d.body) }, receipt: `message:${r.messageId}` };
    },
  };

  // ── calendar ──────────────────────────────────────────────────────────────────────────────────────────────────────
  type EventIn = { account: string; title: string; start: number; end: number; attendees: string[] };
  const eventIn = z.object({ account, title: z.string().trim().min(1).max(200), start: z.number().int().positive(), end: z.number().int().positive(), attendees: recipients }).strict().refine(e => e.end > e.start && e.end - e.start <= 24 * 3_600_000, "An event ends after it starts and lasts at most a day.");
  const window = z.object({ account, from: z.number().int().positive(), to: z.number().int().positive() }).strict().refine(w => w.to > w.from && w.to - w.from <= 31 * 86_400_000, "Look at most 31 days ahead.");
  const eventShape = z.object({ id: z.string(), title: z.string(), start: z.number(), end: z.number(), attendees: z.array(z.string()) });
  const calEvents = read<{ account: string; from: number; to: number }>({ kind: "calendar.events", connector: "calendar", operation: "list", resource: "event", activity: "Reading files", input: window,
    result: z.object({ account: z.string(), events: z.array(eventShape) }), requires: i => [{ kind: "service", connector: "calendar", account: i.account, access: "read", recipients: [] }] },
  async (i) => { try { return { ok: true, result: { account: i.account, events: (await provider.calendar.events(i.account, i.from, i.to)).slice(0, 200) } }; } catch (e) { return fail(e); } });
  const calFree = read<{ account: string; from: number; to: number; minutes: number }>({ kind: "calendar.availability", connector: "calendar", operation: "free-busy", resource: "event", activity: "Reading files",
    input: z.object({ account, from: z.number().int().positive(), to: z.number().int().positive(), minutes: z.number().int().min(15).max(480).default(30) }).strict(),
    result: z.object({ account: z.string(), free: z.array(z.object({ start: z.number(), end: z.number() })) }), requires: i => [{ kind: "service", connector: "calendar", account: i.account, access: "read", recipients: [] }] },
  async (i) => {
    try {
      const busy = (await provider.calendar.events(i.account, i.from, i.to)).sort((a, b) => a.start - b.start), free: { start: number; end: number }[] = [];
      let cursor = i.from;
      for (const e of busy) { if (e.start - cursor >= i.minutes * 60_000) free.push({ start: cursor, end: e.start }); cursor = Math.max(cursor, e.end); }
      if (i.to - cursor >= i.minutes * 60_000) free.push({ start: cursor, end: i.to });
      return { ok: true, result: { account: i.account, free: free.slice(0, 50) } };
    } catch (e) { return fail(e); }
  });
  const invitePrep = (i: EventIn): Prepared => ({ target: `Calendar · ${i.account}`, summary: `Create "${i.title}" with ${i.attendees.length} attendee${i.attendees.length === 1 ? "" : "s"}`,
    effects: [`Sends an invitation to ${i.attendees.length} attendee${i.attendees.length === 1 ? "" : "s"}.`, "Attendees are notified immediately; cancelling later sends another notice."],
    data: [`Shares the title and time with the attendees from account ${i.account}.`], changes: [`New event ${new Date(i.start).toISOString()} - ${new Date(i.end).toISOString()}`, ...i.attendees.map(a => `Attendee: ${a}`)],
    preview: `${i.title}\n${new Date(i.start).toISOString()} - ${new Date(i.end).toISOString()}\nAttendees: ${i.attendees.join(", ")}`, reversible: false,
    payload: { account: i.account, title: i.title, start: i.start, end: i.end, attendees: i.attendees } });
  const calPropose = read<EventIn>({ kind: "calendar.propose", connector: "calendar", operation: "propose", resource: "event", activity: "Preparing draft", input: eventIn as unknown as z.ZodType<EventIn>,
    result: z.object({ account: z.string(), title: z.string(), start: z.number(), end: z.number(), attendees: z.array(z.string()), effects: z.array(z.string()), conflicts: z.array(eventShape), created: z.literal(false) }),
    requires: i => [{ kind: "service", connector: "calendar", account: i.account, access: "draft", recipients: i.attendees }] },
  async (i) => {
    try { const conflicts = await provider.calendar.events(i.account, i.start, i.end); return { ok: true, result: { account: i.account, title: i.title, start: i.start, end: i.end, attendees: i.attendees, effects: invitePrep(i).effects, conflicts, created: false } }; }
    catch (e) { return fail(e); }
  });
  const calCreate: Connector<EventIn> = {
    available,
    contract: { ...base, untrusted: false, kind: "calendar.create", connector: "calendar", operation: "create", resource: "event", category: "irreversible", sideEffect: true, consequential: true, activity: "Executing", idempotency: "none",
      input: eventIn as unknown as z.ZodType<EventIn>, result: z.object({ account: z.string(), eventId: z.string(), attendees: z.array(z.string()) }),
      requires: i => [{ kind: "service", connector: "calendar", account: i.account, access: "write", recipients: i.attendees }] },
    prepare: async i => invitePrep(i),
    async run(i) {
      try { const r = await provider.calendar.create(i.account, { title: i.title, start: i.start, end: i.end, attendees: i.attendees }); return { ok: true, result: { account: i.account, eventId: r.eventId, attendees: i.attendees }, receipt: `event:${r.eventId}` }; }
      catch (e) { return fail(e, !(e instanceof ProviderRejected)); }
    },
  };

  // ── documents ─────────────────────────────────────────────────────────────────────────────────────────────────────
  type DocWrite = { account: string; docId: string; content?: string; contentFrom?: string; expectedVersion: string };
  const docWriteIn = z.object({ account, docId: z.string().min(1).max(120), content: z.string().max(8_000).optional(), contentFrom: stepRef.optional(), expectedVersion: z.string().min(1).max(64) }).strict();
  const docsList = read<{ account: string }>({ kind: "docs.list", connector: "docs", operation: "list", resource: "document", activity: "Reading files", input: z.object({ account }).strict(),
    result: z.object({ account: z.string(), documents: z.array(z.object({ id: z.string(), title: z.string(), version: z.string() })) }), requires: i => [{ kind: "service", connector: "docs", account: i.account, access: "read", recipients: [] }] },
  async (i) => { try { return { ok: true, result: { account: i.account, documents: (await provider.docs.list(i.account)).slice(0, 200) } }; } catch (e) { return fail(e); } });
  const docsRead = read<{ account: string; docId: string }>({ kind: "docs.read", connector: "docs", operation: "read", resource: "document", activity: "Reading files", input: z.object({ account, docId: z.string().min(1).max(120) }).strict(),
    result: z.object({ account: z.string(), document: z.object({ id: z.string(), title: z.string(), version: z.string(), content: z.string() }) }), requires: i => [{ kind: "service", connector: "docs", account: i.account, access: "read", recipients: [] }] },
  async (i) => { try { const d = await provider.docs.read(i.account, i.docId); return { ok: true, result: { account: i.account, document: { ...d, content: d.content.slice(0, 40_000) } } }; } catch (e) { return fail(e); } });
  const docsWrite: Connector<DocWrite> = {
    available,
    contract: { ...base, untrusted: false, kind: "docs.write", connector: "docs", operation: "replace", resource: "document", category: "idempotent", sideEffect: true, consequential: true, activity: "Executing", idempotency: "conditional",
      input: docWriteIn, result: z.object({ account: z.string(), docId: z.string(), previousVersion: z.string(), version: z.string() }),
      requires: i => [{ kind: "service", connector: "docs", account: i.account, access: "write", recipients: [] }] },
    async prepare(i, ctx) {
      const d = await provider.docs.read(i.account, i.docId), next = textFrom(ctx, i.content, i.contentFrom, "content");
      if (d.version !== i.expectedVersion) throw new ProviderRejected(`"${d.title}" changed since it was read (now version ${d.version}).`);
      return { target: `Documents · ${i.account}`, summary: `Replace the text of "${d.title}"`, effects: ["Changes a shared document; collaborators see the new text."], data: [`Writes ${next.length} characters to ${i.account}.`],
        changes: [`${d.title}: version ${d.version} → new version`], preview: next, reversible: true, payload: { account: i.account, docId: i.docId, expectedVersion: d.version, contentSha256: sha256(next) } };
    },
    async run(i, ctx) {
      try { const next = textFrom(ctx, i.content, i.contentFrom, "content"); const r = await provider.docs.write(i.account, i.docId, next, i.expectedVersion); return { ok: true, result: { account: i.account, docId: i.docId, previousVersion: i.expectedVersion, version: r.version }, receipt: `version:${r.version}` }; }
      catch (e) { return fail(e, !(e instanceof ProviderRejected)); }
    },
    async verify(i, ctx) {
      const d = await provider.docs.read(i.account, i.docId), next = textFrom(ctx, i.content, i.contentFrom, "content");
      return d.content === next ? { found: true, result: { account: i.account, docId: i.docId, previousVersion: i.expectedVersion, version: d.version }, receipt: `version:${d.version}` } : { found: false };
    },
  };
  return [mailList, mailRead, mailDraft, mailSend, calEvents, calFree, calPropose, calCreate, docsList, docsRead, docsWrite] as unknown as Connector<never>[];
}

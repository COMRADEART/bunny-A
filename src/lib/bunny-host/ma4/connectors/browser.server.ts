import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { BrowserCapability } from "../../../bunny-missions/capabilities/browser.server.ts";
import { safeUrl } from "../../../bunny-missions/capabilities/browser-network.server.ts";
import type { ExecutionContext } from "../../../bunny-missions/capabilities/bus.server.ts";
import type { HostContainment } from "../../failure.server.ts";
import { sha256 } from "../task-runtime.ts";
import { ACTION_SCHEMA, type ActionContext, type Connector, type ConnectorOutcome, type Requirement } from "../action-broker.server.ts";

/**
 * MA4-S2-T2 controlled browser connector: read-only browsing of exactly the origins a task's grant names. It reuses the
 * MA3 isolated Bunny browser (BrowserCapability): a task-scoped profile that is deleted when the session ends (never the
 * user's own browser profile, cookies or saved passwords), every request — subresources and redirects included — checked
 * against the origin allowlist and the private-network block, websockets closed, non-GET/HEAD refused, downloads off.
 *
 * Every page script here is fixed Host code; a task supplies only URLs, link text and CSS selectors. Pages are untrusted
 * data: their text reaches models only fenced as data. Form fields are described by name and type, never by value, and
 * no form is ever submitted: submission is not an action this milestone offers.
 */
type Deps = { dataDirectory: string; allowLoopback: boolean; headless?: boolean; containment?: HostContainment; maxSessions?: number };
type Session = { cap: BrowserCapability; origins: string; profile: string; tail: Promise<void> };

export class BrowserSessions {
  private sessions = new Map<string, Session>();
  readonly deps: Deps;
  constructor(deps: Deps) { this.deps = deps; }
  get allowLoopback() { return this.deps.allowLoopback; }
  /** One serialized session per task; a different origin set gets a fresh, empty profile. */
  async with<T>(taskId: string, origins: string[], work: (cap: BrowserCapability) => Promise<T>): Promise<T> {
    const key = JSON.stringify([...origins].sort());
    let session = this.sessions.get(taskId);
    if (session && session.origins !== key) { await this.close(taskId); session = undefined; }
    if (!session) {
      if (this.sessions.size >= (this.deps.maxSessions ?? 3)) throw new Error("Too many browser sessions are open; try again when another task finishes.");
      const profile = join(this.deps.dataDirectory, "browser-tasks", taskId.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80));
      rmSync(profile, { recursive: true, force: true }); mkdirSync(profile, { recursive: true });
      const cap = new BrowserCapability(join(this.deps.dataDirectory, "browser-tasks"), { headless: this.deps.headless ?? true, allowLoopback: this.deps.allowLoopback, network: { allowedOrigins: [...origins] }, containment: this.deps.containment });
      cap.profile = profile;
      session = { cap, origins: key, profile, tail: Promise.resolve() };
      this.sessions.set(taskId, session);
    }
    const active = session, previous = active.tail;
    let release!: () => void;
    active.tail = new Promise<void>(r => { release = r; });
    await previous;
    try { return await work(active.cap); } finally { release(); }
  }
  private closing = new Set<Promise<void>>();
  /** Ends a task's session: the browser exits first, then its profile (cookies, storage, cache) is deleted. */
  close(taskId: string): Promise<void> {
    const session = this.sessions.get(taskId);
    if (!session) return Promise.resolve();
    this.sessions.delete(taskId);
    const done = (async () => {
      await session.tail.catch(() => undefined);
      await session.cap.close().catch(() => undefined);
      rmSync(session.profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    })().finally(() => this.closing.delete(done));
    this.closing.add(done);
    return done;
  }
  /** Host shutdown: also waits for closes already in flight (a task that just ended). */
  async closeAll() { await Promise.allSettled([...[...this.sessions.keys()].map(id => this.close(id)), ...this.closing]); }
  /** Sessions with a live browser or one still shutting down. */
  open() { return this.sessions.size + this.closing.size; }
}

type Snapshot = { url: string; title: string; text: string; headings: string[]; links: { text: string; href: string }[]; forms: { index: number; action: string; method: string; fields: { name: string; type: string; label: string }[] }[] };
/** Fixed in-page reader. Reads visible text, headings, link targets and form structure; never values, cookies or storage. */
async function snapshot(page: { evaluate<T>(fn: (arg: number) => T, arg: number): Promise<T> }, maxChars: number): Promise<Omit<Snapshot, "url" | "title">> {
  return page.evaluate((limit: number) => {
    const text = (document.body?.innerText ?? "").slice(0, limit);
    const headings = [...document.querySelectorAll("h1,h2,h3")].slice(0, 40).map(n => (n as HTMLElement).innerText.trim()).filter(Boolean);
    const links = [...document.querySelectorAll("a[href]")].slice(0, 300).map(n => ({ text: ((n as HTMLAnchorElement).innerText || n.getAttribute("aria-label") || "").trim().slice(0, 120), href: (n as HTMLAnchorElement).href }));
    const forms = [...document.forms].slice(0, 10).map((form, index) => ({ index, action: form.action, method: (form.method || "get").toLowerCase(),
      fields: [...form.elements].slice(0, 40).flatMap(el => {
        const field = el as HTMLInputElement;
        if (!field.name || field.type === "hidden" || field.type === "submit" || field.type === "button") return [];
        const label = (field.labels?.[0]?.innerText ?? field.getAttribute("aria-label") ?? field.placeholder ?? "").trim().slice(0, 80);
        return [{ name: field.name.slice(0, 80), type: (field.type || field.tagName.toLowerCase()).slice(0, 20), label }];
      }) }));
    return { text, headings, links, forms };
  }, maxChars);
}

const execution = (ctx: ActionContext, dataDirectory: string): ExecutionContext => ({ missionId: null, stepId: ctx.stepId, cwd: dataDirectory, roots: [], dataDirectory, signal: ctx.signal, timeoutMs: 45_000 });
const originOf = (raw: string) => { try { return new URL(raw).origin; } catch { return "invalid"; } };

export function browserConnectors(sessions: BrowserSessions): Connector<never>[] {
  const allow = sessions.allowLoopback;
  const available = (r: Requirement) => {
    if (r.kind !== "origin") return null;
    try { safeUrl(r.origin, allow); return null; }
    catch { return `Site ${r.origin} is on this PC or a private network; that needs a separate authorization.`; }
  };
  const base = { schema: ACTION_SCHEMA, connector: "browser" as const, resource: "web-page", untrusted: true, maxResultChars: 60_000, category: "read_only" as const, sideEffect: false, consequential: false, activity: "Browsing" as const, idempotency: "none" as const, timeoutMs: 60_000 };
  const pageResult = z.object({ url: z.string(), title: z.string(), status: z.number().nullable(), retrievedAt: z.number(), textSha256: z.string(), text: z.string(), headings: z.array(z.string()),
    links: z.array(z.object({ text: z.string(), href: z.string() })), outOfScopeLinks: z.number(), forms: z.array(z.object({ index: z.number(), action: z.string(), method: z.string(), fields: z.array(z.object({ name: z.string(), type: z.string(), label: z.string() })) })) });
  const inScope = (raw: string, origins: string[]) => { try { const u = safeUrl(raw, allow); return origins.includes(u.origin); } catch { return false; } };

  /** Navigate within the grant, then read. A redirect or final URL outside the grant is a refusal, not a page. */
  const visit = async (url: string, maxChars: number, ctx: ActionContext): Promise<ConnectorOutcome> => {
    const origins = ctx.grants.origins;
    if (!inScope(url, origins)) return { ok: false, error: `${originOf(url)} is not granted to this task.`, dispatched: false, denied: true };
    return sessions.with(ctx.taskId, origins, async cap => {
      const nav = await cap.perform("browser.navigate", { url }, execution(ctx, sessions.deps.dataDirectory));
      const { page } = await cap.page();
      if (!inScope(page.url(), origins)) return { ok: false, error: `The page moved to ${originOf(page.url())}, which is not granted; nothing from it was read.`, dispatched: false, denied: true };
      if (!nav.ok) return { ok: false, error: nav.summary, dispatched: true, definite: true };
      return { ok: true, result: await read(page, (nav.output as { status?: number | null }).status ?? null, maxChars, origins) };
    });
  };
  const read = async (page: Awaited<ReturnType<BrowserCapability["page"]>>["page"], status: number | null, maxChars: number, origins: string[]) => {
    const s = await snapshot(page, maxChars);
    const links = s.links.filter(l => inScope(l.href, origins)).slice(0, 100);
    return { url: page.url(), title: (await page.title().catch(() => "")).slice(0, 200), status, retrievedAt: Date.now(), textSha256: sha256(s.text), text: s.text, headings: s.headings,
      links, outOfScopeLinks: s.links.length - links.length,
      forms: s.forms.map(f => ({ ...f, action: inScope(f.action, origins) ? f.action : `(outside the grant: ${originOf(f.action)})` })) };
  };

  const open: Connector<{ url: string; maxChars: number }> = {
    available,
    contract: { ...base, kind: "browser.open", operation: "navigate-read", input: z.object({ url: z.string().url().max(2_000), maxChars: z.number().int().min(500).max(30_000).default(20_000) }).strict(), result: pageResult,
      requires: i => [{ kind: "origin", origin: originOf(i.url) }] },
    run: (i, ctx) => visit(i.url, i.maxChars, ctx),
  };
  const follow: Connector<{ linkText: string; maxChars: number }> = {
    available,
    contract: { ...base, kind: "browser.follow", operation: "follow-link", input: z.object({ linkText: z.string().trim().min(1).max(120), maxChars: z.number().int().min(500).max(30_000).default(20_000) }).strict(), result: pageResult,
      // The target is only known on the page; it is checked there against the same grant.
      requires: () => [] },
    async run(i, ctx) {
      if (!ctx.grants.origins.length) return { ok: false, error: "This task is not granted any site.", dispatched: false, denied: true };
      const target = await sessions.with(ctx.taskId, ctx.grants.origins, async cap => {
        if (!cap.current) return null;
        const { page } = await cap.page();
        const s = await snapshot(page, 0);
        return s.links.find(l => l.text.toLowerCase() === i.linkText.toLowerCase()) ?? s.links.find(l => l.text.toLowerCase().includes(i.linkText.toLowerCase())) ?? null;
      });
      if (!target) return { ok: false, error: `No link "${i.linkText}" on the current page (open a page first).`, dispatched: false };
      return visit(target.href, i.maxChars, ctx);
    },
  };
  const extract: Connector<{ selector: string; attribute?: string; limit: number }> = {
    available,
    contract: { ...base, kind: "browser.extract", operation: "extract", input: z.object({ selector: z.string().min(1).max(200), attribute: z.enum(["href", "title", "alt", "datetime", "aria-label"]).optional(), limit: z.number().int().min(1).max(200).default(50) }).strict(),
      result: z.object({ url: z.string(), selector: z.string(), items: z.array(z.string()) }), requires: () => [] },
    async run(i, ctx) {
      if (!ctx.grants.origins.length) return { ok: false, error: "This task is not granted any site.", dispatched: false, denied: true };
      return sessions.with(ctx.taskId, ctx.grants.origins, async cap => {
        if (!cap.current) return { ok: false, error: "Open a page first.", dispatched: false };
        const { page } = await cap.page();
        if (!inScope(page.url(), ctx.grants.origins)) return { ok: false, error: "The current page is outside the grant.", dispatched: false, denied: true };
        const r = await cap.perform("browser.extract", { selector: i.selector, attribute: i.attribute, limit: i.limit }, execution(ctx, sessions.deps.dataDirectory));
        if (!r.ok) return { ok: false, error: r.summary, dispatched: false };
        return { ok: true, result: { url: page.url(), selector: i.selector, items: ((r.output as { items: string[] }).items ?? []).map(s => s.slice(0, 500)) } };
      });
    },
  };
  const prepareForm: Connector<{ form: number; values: string }> = {
    available,
    contract: { ...base, kind: "browser.form.prepare", operation: "prepare-form", activity: "Preparing draft", input: z.object({ form: z.number().int().min(0).max(9), values: z.string().max(2_000) }).strict(),
      result: z.object({ url: z.string(), action: z.string(), method: z.string(), fills: z.array(z.object({ field: z.string(), type: z.string(), value: z.string() })), unknown: z.array(z.string()), submitted: z.literal(false), note: z.string() }), requires: () => [] },
    async run(i, ctx) {
      let values: Record<string, unknown>;
      try { values = JSON.parse(i.values); if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error(); } catch { return { ok: false, error: "values must be a JSON object of field name to text.", dispatched: false }; }
      return sessions.with(ctx.taskId, ctx.grants.origins, async cap => {
        if (!cap.current) return { ok: false, error: "Open a page first.", dispatched: false };
        const { page } = await cap.page();
        if (!inScope(page.url(), ctx.grants.origins)) return { ok: false, error: "The current page is outside the grant.", dispatched: false, denied: true };
        const form = (await snapshot(page, 0)).forms[i.form];
        if (!form) return { ok: false, error: `The page has no form ${i.form}.`, dispatched: false };
        const fields = new Map(form.fields.map(f => [f.name, f]));
        const fills = Object.entries(values).flatMap(([name, value]) => { const f = fields.get(name); return f && f.type !== "password" && f.type !== "file" ? [{ field: name, type: f.type, value: String(value).slice(0, 500) }] : []; });
        return { ok: true, result: { url: page.url(), action: inScope(form.action, ctx.grants.origins) ? form.action : `(outside the grant: ${originOf(form.action)})`, method: form.method, fills,
          unknown: Object.keys(values).filter(n => !fields.has(n) || ["password", "file"].includes(fields.get(n)!.type)), submitted: false as const, note: "Prepared only. Nothing was typed into the page and nothing was submitted." } };
      });
    },
  };
  return [open, follow, extract, prepareForm] as unknown as Connector<never>[];
}

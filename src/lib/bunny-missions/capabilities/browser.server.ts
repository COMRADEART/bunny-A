import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ActionManifest, CapabilityResult } from "../types.ts";
import type { CapabilityAdapter, ExecutionContext } from "./bus.server.ts";
import { blockedHost, checkingProxy, safeUrl, type NetworkOptions } from "./browser-network.server.ts";
import { HostContainment, type SafeError } from "../../bunny-host/failure.server.ts";
export { blockedHost, safeUrl } from "./browser-network.server.ts";

type PwPage = {
  goto(url: string, options: { waitUntil: string; timeout: number }): Promise<{ status(): number; headerValue(name: string): Promise<string | null> } | null>;
  url(): string; title(): Promise<string>; close(): Promise<void>; isClosed(): boolean;
  evaluate<T>(fn: (arg: number) => T, arg: number): Promise<T>;
  locator(selector: string): PwLocator; getByRole(role: string, options?: { name?: string }): PwLocator; getByText(text: string): PwLocator; getByLabel(text: string): PwLocator; getByPlaceholder(text: string): PwLocator;
  screenshot(options: { path: string; fullPage: boolean }): Promise<unknown>;
  waitForLoadState(state: string, options: { timeout: number }): Promise<void>;
  waitForEvent(event: "download", options: { timeout: number }): Promise<{ suggestedFilename(): string; saveAs(path: string): Promise<void>; url(): string }>;
};
type PwLocator = { first(): PwLocator; click(options: { timeout: number }): Promise<void>; fill(text: string, options: { timeout: number }): Promise<void>; press(key: string, options: { timeout: number }): Promise<void>; waitFor(options: { timeout: number; state?: string }): Promise<void>; allInnerTexts(): Promise<string[]>; evaluateAll<T>(fn: (nodes: Element[], arg: string | null) => T, arg: string | null): Promise<T>; count(): Promise<number> };
type PwContext = { pages(): PwPage[]; newPage(): Promise<PwPage>; close(): Promise<void>; route(pattern: string, handler: (route: { request(): { url(): string }; abort(reason?: string): Promise<void>; continue(): Promise<void> }) => Promise<void>): Promise<void> };

const input = (name: string, type: ActionManifest["inputs"][number]["type"], required: boolean, description: string) => ({ name, type, required, description });

/**
 * Bunny-owned browser. It drives a separate browser profile under the Host data folder (never the
 * user's own Chrome/Edge profile, cookies or saved credentials). DOM/accessibility locators first.
 */
export class BrowserCapability implements CapabilityAdapter {
  dataDirectory: string; headless: boolean; allowLoopback: boolean;
  context: PwContext | null = null; starting: Promise<PwContext> | null = null; channel: string | null = null;
  tabs = new Map<string, PwPage>(); current: string | null = null; idle: ReturnType<typeof setTimeout> | null = null;
  containment:HostContainment;
  asyncFailure:SafeError|null=null;
  network: NetworkOptions; proxy: Awaited<ReturnType<typeof checkingProxy>> | null = null;
  constructor(dataDirectory: string, options: { headless?: boolean; allowLoopback?: boolean; network?: NetworkOptions; containment?:HostContainment } = {}) {
    this.containment=options.containment ?? new HostContainment();
    this.dataDirectory = dataDirectory; this.headless = options.headless ?? true; this.allowLoopback = options.allowLoopback ?? false;
    this.network = { ...options.network, allowLoopback: this.allowLoopback };
  }
  manifest = {
    id: "browser", version: "1.0.0", description: "Isolated Bunny-owned browser profile for research and web tasks (Playwright over installed Chromium/Chrome/Edge).", locality: "local" as const, platforms: "any" as const,
    events: ["capability.completed", "capability.failed"], cost: { kind: "network" as const, note: "Local browser process; network traffic to visited sites; no model tokens." }, adapter: "playwright persistent context (Bunny profile)",
    actions: [
      { id: "browser.navigate", description: "Open a public http(s) URL in a Bunny tab.", risk: "READ", inputs: [input("url", "string", true, "Public URL."), input("tabId", "string", false, "Existing tab.")], outputs: "{ tabId, url, title, status }", evidence: "Final URL, title and HTTP status.", timeoutMs: 45_000, implemented: true },
      { id: "browser.search", description: "Search the web (DuckDuckGo HTML) and return result links.", risk: "READ", inputs: [input("query", "string", true, "Search query."), input("limit", "number", false, "Max results (10).")], outputs: "{ query, results: { title, url }[] }", evidence: "Search URL, retrieval time and result list (research note artifact).", timeoutMs: 45_000, implemented: true },
      { id: "browser.read", description: "Read the current page's visible text (bounded) with URL/title evidence.", risk: "READ", inputs: [input("tabId", "string", false, "Tab."), input("maxChars", "number", false, "Text limit (20,000).")], outputs: "{ url, title, retrievedAt, text, headings }", evidence: "browser_evidence artifact: URL, title, retrieval time, text excerpt.", timeoutMs: 20_000, implemented: true },
      { id: "browser.extract", description: "Extract text or an attribute from elements matching a CSS selector.", risk: "READ", inputs: [input("selector", "string", true, "CSS selector."), input("attribute", "string", false, "Attribute instead of text."), input("limit", "number", false, "Max items (100).")], outputs: "{ items: string[] }", evidence: "Selector, URL and item count.", timeoutMs: 20_000, implemented: true },
      { id: "browser.metadata", description: "Page title, canonical URL, description and Open Graph metadata.", risk: "READ", inputs: [input("tabId", "string", false, "Tab.")], outputs: "{ url, title, meta }", evidence: "URL and metadata.", timeoutMs: 15_000, implemented: true },
      { id: "browser.click", description: "Click an element found by role+name, label, text or CSS selector.", risk: "WRITE", inputs: [input("role", "string", false, "ARIA role."), input("name", "string", false, "Accessible name."), input("text", "string", false, "Visible text."), input("selector", "string", false, "CSS selector.")], outputs: "{ url, title }", evidence: "Locator used and URL after the click.", timeoutMs: 20_000, implemented: true },
      { id: "browser.type", description: "Fill a form field found by label, placeholder or selector; optional Enter.", risk: "WRITE", inputs: [input("label", "string", false, "Field label."), input("placeholder", "string", false, "Placeholder."), input("selector", "string", false, "CSS selector."), input("text", "string", true, "Text to enter."), input("submit", "boolean", false, "Press Enter afterwards.")], outputs: "{ url }", evidence: "Locator used (typed text is not logged).", timeoutMs: 20_000, implemented: true },
      { id: "browser.wait", description: "Wait for a selector, text or load state.", risk: "READ", inputs: [input("selector", "string", false, "CSS selector."), input("text", "string", false, "Visible text."), input("state", "string", false, "load | domcontentloaded | networkidle.")], outputs: "{ url }", evidence: "Condition met before the timeout.", timeoutMs: 30_000, implemented: true },
      { id: "browser.screenshot", description: "Screenshot the current tab into the mission's artifacts.", risk: "READ", inputs: [input("fullPage", "boolean", false, "Whole page.")], outputs: "{ path, url }", evidence: "PNG artifact with SHA-256.", timeoutMs: 30_000, implemented: true },
      { id: "browser.download", description: "Download a public URL (or the file a click starts) into the Host artifacts folder.", risk: "WRITE", inputs: [input("url", "string", false, "File URL."), input("selector", "string", false, "Element whose click starts the download.")], outputs: "{ path, filename, url }", evidence: "Downloaded file artifact with SHA-256.", timeoutMs: 120_000, implemented: true },
      { id: "browser.tabs", description: "List, open or close Bunny tabs.", risk: "READ", inputs: [input("op", "string", true, "list | new | close."), input("tabId", "string", false, "Tab to close.")], outputs: "{ tabs: { id, url, title }[] }", evidence: "Tab list.", timeoutMs: 15_000, implemented: true },
    ] satisfies ActionManifest[],
  };
  async health() {
    try { await import("playwright"); } catch { return { availability: "unavailable" as const, detail: "Playwright is not installed in this Host's runtime." }; }
    return { availability: "available" as const, detail: `Isolated Bunny profile at ${join(this.dataDirectory, "browser-profile")}; launches bundled Chromium, else installed Chrome, else Edge${this.channel ? ` (last used: ${this.channel})` : ""}.` };
  }
  async ensure(): Promise<PwContext> {
    if (this.context) return this.context;
    this.starting ??= (async () => {
      const { chromium } = await import("playwright") as unknown as { chromium: { launchPersistentContext(dir: string, options: Record<string, unknown>): Promise<PwContext> } };
      const profile = join(this.dataDirectory, "browser-profile"); mkdirSync(profile, { recursive: true });
      const errors: string[] = [];
      this.proxy = await checkingProxy(this.network);
      for (const channel of [undefined, "chrome", "msedge"]) {
        try {
          const context = await chromium.launchPersistentContext(profile, { headless: this.headless, acceptDownloads: true, serviceWorkers: "block", proxy: { server: this.proxy.url, bypass: "<-loopback>" },
            args: ["--disable-quic", "--force-webrtc-ip-handling-policy=disable_non_proxied_udp", "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1"], ...(channel ? { channel } : {}) });
          this.channel = channel ?? "bundled chromium";
          // Every request — subresources and redirects included — is checked, not just the first URL.
          await context.route("**/*", async (route) => {
            try {
            let host = ""; try { const url = new URL(route.request().url()); host = url.hostname; if (url.protocol === "data:" || url.protocol === "blob:") return await route.continue(); } catch { return await route.abort("blockedbyclient"); }
            await (blockedHost(host, this.allowLoopback) ? route.abort("blockedbyclient") : route.continue());
            } catch(error) {await this.containment.contain(error,"boundary",{owner:{subsystem:"browser"},failureClass:"SUBSYSTEM_FAILURE",fail:failure=>{this.asyncFailure=failure;}});}
          });
          for (const page of context.pages()) await page.close().catch(() => {});
          this.context = context; return context;
        } catch (error) { errors.push(`${channel ?? "bundled"}: ${(error instanceof Error ? error.message : String(error)).split("\n")[0]}`); }
      }
      await this.proxy.close(); this.proxy = null;
      throw new Error(`No browser could be launched (${errors.join("; ")}).`);
    })().finally(() => { this.starting = null; });
    return this.starting;
  }
  keepAlive() { if (this.idle) clearTimeout(this.idle); this.idle = setTimeout(() => this.containment.background({subsystem:"browser"},()=>this.close(),undefined,"SUBSYSTEM_FAILURE"), 5 * 60_000); this.idle.unref?.(); }
  async page(tabId?: unknown): Promise<{ id: string; page: PwPage }> {
    const context = await this.ensure();
    const id = typeof tabId === "string" && tabId ? tabId : this.current;
    if (id && this.tabs.has(id) && !this.tabs.get(id)!.isClosed()) { this.current = id; return { id, page: this.tabs.get(id)! }; }
    if (typeof tabId === "string" && tabId) throw new Error(`Unknown or closed tab ${tabId}.`);
    const page = await context.newPage(); const created = crypto.randomUUID().slice(0, 8);
    this.tabs.set(created, page); this.current = created; return { id: created, page };
  }
  locate(page: PwPage, params: Record<string, unknown>): { locator: PwLocator; how: string } {
    const s = (key: string) => (typeof params[key] === "string" && params[key] ? params[key] as string : null);
    if (s("role")) return { locator: page.getByRole(s("role")!, s("name") ? { name: s("name")! } : undefined).first(), how: `role=${s("role")}${s("name") ? ` name="${s("name")}"` : ""}` };
    if (s("label")) return { locator: page.getByLabel(s("label")!).first(), how: `label="${s("label")}"` };
    if (s("placeholder")) return { locator: page.getByPlaceholder(s("placeholder")!).first(), how: `placeholder="${s("placeholder")}"` };
    if (s("text")) return { locator: page.getByText(s("text")!).first(), how: `text="${s("text")}"` };
    if (s("selector")) return { locator: page.locator(s("selector")!).first(), how: `css=${s("selector")}` };
    throw new Error("Provide role(+name), label, placeholder, text or selector.");
  }
  async execute(action: string, params: Record<string, unknown>, context: ExecutionContext): Promise<CapabilityResult> {
    this.containment.assertAccepting("browser");
    const result=await this.perform(action,params,context);
    if(this.asyncFailure) return {ok:false,status:"failed",summary:"Browser asynchronous handler failed; dependent execution is unavailable.",output:null,evidence:[],errorCategory:"capability_failed"};
    return result;
  }
  async perform(action: string, params: Record<string, unknown>, context: ExecutionContext): Promise<CapabilityResult> {
    this.keepAlive();
    const timeout = Math.min(context.timeoutMs, 60_000);
    const evidenceOf = async (page: PwPage) => ({ url: page.url(), title: await page.title().catch(() => ""), retrievedAt: new Date().toISOString() });
    if (action === "browser.tabs") {
      const op = params.op;
      if (op === "new") { const { id, page } = await this.page(); return { ok: true, status: "succeeded", summary: `Opened tab ${id}.`, output: { tabs: [{ id, url: page.url(), title: "" }] }, evidence: [`tab ${id}`] }; }
      if (op === "close") { const id = String(params.tabId ?? ""); const page = this.tabs.get(id); if (!page) throw new Error(`Unknown tab ${id}.`); await page.close(); this.tabs.delete(id); if (this.current === id) this.current = null; return { ok: true, status: "succeeded", summary: `Closed tab ${id}.`, output: { closed: id }, evidence: [`tab ${id} closed`] }; }
      if (op !== "list") throw new Error("op must be list, new or close.");
      const tabs = await Promise.all([...this.tabs].filter(([, page]) => !page.isClosed()).map(async ([id, page]) => ({ id, url: page.url(), title: await page.title().catch(() => "") })));
      return { ok: true, status: "succeeded", summary: `${tabs.length} tab(s).`, output: { tabs }, evidence: [] };
    }
    if (action === "browser.navigate" || action === "browser.search") {
      const target = action === "browser.search"
        ? safeUrl(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(String(params.query ?? "").slice(0, 300))}`)
        : safeUrl(String(params.url ?? ""), this.allowLoopback);
      if (action === "browser.search" && !String(params.query ?? "").trim()) throw new Error("query is required.");
      const { id, page } = await this.page(params.tabId);
      const response = await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout });
      if (await response?.headerValue("x-bunny-browser-blocked")) throw new Error("Bunny Browser blocked a private DNS destination or redirect before connection.");
      const finalUrl = safeUrl(page.url(), this.allowLoopback); // a redirect to a private host is refused too
      const facts = await evidenceOf(page);
      if (action === "browser.navigate") return { ok: true, status: "succeeded", summary: `Opened ${facts.title || finalUrl.toString()} (${response?.status() ?? "no status"}).`, output: { tabId: id, ...facts, status: response?.status() ?? null }, evidence: [`${facts.url} · "${facts.title}" · ${facts.retrievedAt}`] };
      const limit = Math.max(1, Math.min(25, Number(params.limit ?? 10) || 10));
      const results = (await page.locator("a.result__a").evaluateAll((nodes, max) => nodes.slice(0, Number(max)).map((node) => ({ title: (node as HTMLAnchorElement).innerText.trim(), url: (node as HTMLAnchorElement).href })), String(limit))) as { title: string; url: string }[];
      const decoded = results.map((row) => { try { const u = new URL(row.url); const real = u.searchParams.get("uddg"); return { title: row.title, url: real ?? row.url }; } catch { return row; } });
      const note = `# Search: ${String(params.query)}\nRetrieved ${facts.retrievedAt} from ${facts.url}\n\n${decoded.map((row, index) => `${index + 1}. ${row.title}\n   ${row.url}`).join("\n")}`;
      return { ok: decoded.length > 0, status: decoded.length ? "succeeded" : "failed", summary: decoded.length ? `${decoded.length} results for "${String(params.query)}".` : "The search page returned no parseable results.", output: { query: params.query, tabId: id, results: decoded, ...facts }, evidence: [`${facts.url} · ${facts.retrievedAt} · ${decoded.length} results`], artifacts: [{ type: "research_note", title: `Search: ${String(params.query).slice(0, 80)}`, inline: note, mediaType: "text/markdown" }], ...(decoded.length ? {} : { errorCategory: "capability_failed" as const }) };
    }
    const { id, page } = await this.page(params.tabId);
    if (action === "browser.read") {
      const max = Math.max(500, Math.min(100_000, Number(params.maxChars ?? 20_000) || 20_000));
      const data = await page.evaluate((limit: number) => ({ text: (document.body?.innerText ?? "").slice(0, limit), headings: [...document.querySelectorAll("h1,h2,h3")].slice(0, 40).map((node) => (node as HTMLElement).innerText.trim()).filter(Boolean) }), max);
      const facts = await evidenceOf(page);
      const body = JSON.stringify({ ...facts, headings: data.headings, excerpt: data.text.slice(0, 4000) }, null, 2);
      return { ok: true, status: "succeeded", summary: `Read ${data.text.length} characters from ${facts.title || facts.url}.`, output: { tabId: id, ...facts, text: data.text, headings: data.headings }, evidence: [`${facts.url} · "${facts.title}" · ${facts.retrievedAt}`], artifacts: [{ type: "browser_evidence", title: `Page: ${facts.title || facts.url}`.slice(0, 120), inline: body, mediaType: "application/json" }] };
    }
    if (action === "browser.extract") {
      const selector = String(params.selector ?? ""); if (!selector) throw new Error("selector is required.");
      const attribute = typeof params.attribute === "string" && params.attribute ? params.attribute : null;
      const limit = Math.max(1, Math.min(500, Number(params.limit ?? 100) || 100));
      const items = (await page.locator(selector).evaluateAll((nodes, attr) => nodes.map((node) => attr ? node.getAttribute(attr) ?? "" : (node as HTMLElement).innerText.trim()), attribute)).slice(0, limit) as string[];
      return { ok: true, status: "succeeded", summary: `${items.length} item(s) for ${selector}.`, output: { tabId: id, url: page.url(), items }, evidence: [`${selector} on ${page.url()} → ${items.length}`] };
    }
    if (action === "browser.metadata") {
      const meta = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("meta[name],meta[property]")].slice(0, 60).map((node) => [node.getAttribute("name") ?? node.getAttribute("property") ?? "", node.getAttribute("content") ?? ""])), 0);
      const canonical = await page.evaluate(() => document.querySelector("link[rel=canonical]")?.getAttribute("href") ?? null, 0);
      const facts = await evidenceOf(page);
      return { ok: true, status: "succeeded", summary: `Metadata for ${facts.title || facts.url}.`, output: { tabId: id, ...facts, canonical, meta }, evidence: [`${facts.url} · ${facts.retrievedAt}`] };
    }
    if (action === "browser.click") {
      const { locator, how } = this.locate(page, params);
      await locator.click({ timeout: Math.min(timeout, 15_000) });
      await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
      safeUrl(page.url(), this.allowLoopback);
      return { ok: true, status: "succeeded", summary: `Clicked ${how}.`, output: { tabId: id, url: page.url(), title: await page.title().catch(() => "") }, evidence: [`click ${how} → ${page.url()}`] };
    }
    if (action === "browser.type") {
      const text = typeof params.text === "string" ? params.text : null; if (text === null) throw new Error("text is required.");
      const { locator, how } = this.locate(page, { label: params.label, placeholder: params.placeholder, selector: params.selector, role: params.role, name: params.name });
      await locator.fill(text, { timeout: Math.min(timeout, 15_000) });
      if (params.submit === true) { await locator.press("Enter", { timeout: 5_000 }); await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {}); }
      return { ok: true, status: "succeeded", summary: `Filled ${how} (${text.length} characters)${params.submit === true ? " and pressed Enter" : ""}.`, output: { tabId: id, url: page.url() }, evidence: [`fill ${how}`] };
    }
    if (action === "browser.wait") {
      if (typeof params.selector === "string" && params.selector) await page.locator(params.selector).first().waitFor({ timeout, state: "visible" });
      else if (typeof params.text === "string" && params.text) await page.getByText(params.text).first().waitFor({ timeout, state: "visible" });
      else await page.waitForLoadState(["load", "domcontentloaded", "networkidle"].includes(String(params.state)) ? String(params.state) : "load", { timeout });
      return { ok: true, status: "succeeded", summary: "Condition met.", output: { tabId: id, url: page.url() }, evidence: [`wait satisfied on ${page.url()}`] };
    }
    if (action === "browser.screenshot") {
      const folder = join(this.dataDirectory, "artifacts", context.missionId ? context.missionId.slice(0, 36) : "direct"); mkdirSync(folder, { recursive: true });
      const path = join(folder, `screenshot-${Date.now()}.png`);
      await page.screenshot({ path, fullPage: params.fullPage === true });
      const facts = await evidenceOf(page);
      return { ok: true, status: "succeeded", summary: `Screenshot of ${facts.title || facts.url}.`, output: { tabId: id, path, ...facts }, evidence: [`${path} · ${facts.url}`], artifacts: [{ type: "screenshot", title: `Screenshot: ${facts.title || facts.url}`.slice(0, 120), path, mediaType: "image/png" }] };
    }
    if (action === "browser.download") {
      const folder = join(this.dataDirectory, "artifacts", context.missionId ? context.missionId.slice(0, 36) : "direct", "downloads"); mkdirSync(folder, { recursive: true });
      const waiting = page.waitForEvent("download", { timeout: Math.min(timeout, 60_000) });
      // A refused URL, a navigation error or a missing control abandons this wait. Unhandled, its later timeout
      // rejection ended the whole Host process (M-A-1); the success path still awaits it below.
      waiting.catch(() => {});
      if (typeof params.url === "string" && params.url) {
        const url = safeUrl(params.url, this.allowLoopback);
        // Navigating to a file URL raises "Download is starting"; the download event still fires.
        await page.goto(url.toString(), { waitUntil: "commit", timeout }).catch((error: Error) => { if (!/download/i.test(error.message)) throw error; });
      } else { const { locator } = this.locate(page, params); await locator.click({ timeout: 15_000 }); }
      const download = await waiting;
      const filename = download.suggestedFilename().replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120) || "download";
      const path = join(folder, `${Date.now()}-${filename}`);
      await download.saveAs(path);
      return { ok: true, status: "succeeded", summary: `Downloaded ${filename}.`, output: { path, filename, url: download.url() }, evidence: [`${download.url()} → ${path}`], artifacts: [{ type: "download", title: filename, path, mediaType: "application/octet-stream" }] };
    }
    return { ok: false, status: "unsupported", summary: `${action} is not supported.`, output: null, evidence: [] };
  }
  async close() {
    if (this.idle) clearTimeout(this.idle);
    const context = this.context; this.context = null; this.tabs.clear(); this.current = null;
    await context?.close().catch(() => {});
    await this.proxy?.close(); this.proxy = null;
  }
}

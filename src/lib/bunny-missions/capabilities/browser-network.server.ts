import { lookup } from "node:dns/promises";
import { Agent, createServer, request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { BlockList, connect, isIP, type Socket } from "node:net";
import type { Duplex } from "node:stream";

const privateV4 = new BlockList();
for (const [ip, bits] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) privateV4.addSubnet(ip, bits);
const globalV6 = new BlockList(); globalV6.addSubnet("2000::", 3, "ipv6");
const specialV6 = new BlockList();
for (const [ip, bits] of [["2001::", 32], ["2001:2::", 48], ["2001:10::", 28], ["2001:20::", 28], ["2001:db8::", 32], ["2002::", 16]] as const) specialV6.addSubnet(ip, bits, "ipv6");

export function blockedAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "");
  const family = isIP(ip);
  if (family === 4) return privateV4.check(ip);
  // Positive global-unicast check also rejects mapped IPv4, NAT64, local, multicast,
  // unspecified and zone-qualified IPv6. Transitional tunnels are refused too.
  if (family === 6) return ip.includes("%") || !globalV6.check(ip, "ipv6") || specialV6.check(ip, "ipv6");
  return true;
}
export function blockedHost(host: string, allowLoopback = false): boolean {
  const name = host.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (allowLoopback && ["127.0.0.1", "localhost", "::1"].includes(name)) return false;
  if (name === "localhost" || /\.(localhost|local|internal)$/.test(name)) return true;
  return isIP(name) ? blockedAddress(name) : false;
}
export function safeUrl(raw: string, allowLoopback = false): URL {
  let url: URL; try { url = new URL(raw); } catch { throw new Error(`Invalid URL: ${raw}`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`Only http(s) URLs are allowed (got ${url.protocol}).`);
  if (url.username || url.password) throw new Error("URLs with embedded credentials are refused.");
  if (blockedHost(url.hostname, allowLoopback)) throw new Error(`Private or loopback host refused: ${url.hostname}`);
  return url;
}

export type DnsLookup = (hostname: string) => Promise<{ address: string; family: number }[]>;
export type NetworkOptions = {
  /** Disposable fixture seam. Production uses the system resolver and pinned TCP connect. */
  lookup?: DnsLookup;
  connect?: (address: string, port: number) => Socket;
  allowLoopback?: boolean;
};
export async function resolvePublic(url: URL, options: NetworkOptions = {}): Promise<string> {
  safeUrl(url.toString(), options.allowLoopback);
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }] : await (options.lookup ?? ((name) => lookup(name, { all: true, verbatim: true })))(host);
  if (!addresses.length) throw new Error(`No DNS addresses for ${host}.`);
  const explicitLoopback = options.allowLoopback && ["localhost", "127.0.0.1", "::1"].includes(host);
  for (const { address } of addresses) {
    if (blockedAddress(address) && !(explicitLoopback && ["127.0.0.1", "::1"].includes(address))) throw new Error(`DNS destination refused for ${host}: ${address}`);
  }
  return addresses[0].address;
}

function headersFor(headers: IncomingHttpHeaders, host?: string): IncomingHttpHeaders {
  const clean: IncomingHttpHeaders = { ...headers, ...(host ? { host } : {}) };
  for (const name of ["proxy-authorization", "proxy-connection", "connection", "keep-alive", "te", "trailer", "transfer-encoding", "upgrade", ...String(headers.connection ?? "").toLowerCase().split(",").map((s) => s.trim())]) delete clean[name];
  return clean;
}

/** Chromium has no direct destination DNS/socket path: HTTP, redirects and TLS CONNECT all
 * traverse this proxy. Each new upstream connection resolves/checks ALL answers, then dials
 * the checked literal IP (no second DNS lookup). CONNECT preserves end-to-end TLS/SNI.
 */
export async function checkingProxy(options: NetworkOptions = {}): Promise<{ url: string; close(): Promise<void> }> {
  const sockets = new Set<Duplex>();
  const own = <T extends Duplex>(socket: T): T => { sockets.add(socket); socket.once("close", () => sockets.delete(socket)); socket.on("error",()=>socket.destroy()); return socket; };
  const dial = (address: string, port: number) => own((options.connect ?? ((ip, at) => connect({ host: ip, port: at })))(address, port));
  const pinnedAgent = (address: string, port: number) => { const agent = new Agent({ keepAlive: false }); agent.createConnection = () => dial(address, port); return agent; };
  const server = createServer(async (req, res) => {
    res.on("error",()=>res.destroy());req.on("error",()=>req.destroy());
    try {
      const url = safeUrl(req.url ?? "", options.allowLoopback);
      if (url.protocol !== "http:") throw new Error("HTTPS requires CONNECT.");
      const address = await resolvePublic(url, options);
      if (req.destroyed) return;
      const upstream = httpRequest({ hostname: address, port: Number(url.port || 80), method: req.method, path: `${url.pathname}${url.search}`, headers: headersFor(req.headers, url.host), agent: pinnedAgent(address, Number(url.port || 80)),
      }, (response) => {
        response.on("error",()=>{response.destroy();res.destroy();});
        try {if(res.destroyed) {response.destroy();return;}res.writeHead(response.statusCode ?? 502, headersFor(response.headers));response.pipe(res);}
        catch {response.destroy();res.destroy();}
      });
      upstream.setTimeout(60_000, () => upstream.destroy(new Error("Upstream timeout.")));
      upstream.on("error", () => { try {if(res.destroyed) return;if (!res.headersSent) res.writeHead(502); res.end("Bunny Browser upstream failed.");} catch {res.destroy();} });
      res.once("close", () => upstream.destroy());
      req.pipe(upstream);
    } catch (error) { try {if (!res.destroyed) { res.writeHead(403, { "content-type": "text/plain", "x-bunny-browser-blocked": "1" }); res.end(`Bunny Browser blocked destination: ${error instanceof Error ? error.message : String(error)}`); }} catch {res.destroy();} }
  });
  server.on("connection", (socket) => { own(socket); socket.setTimeout(120_000, () => socket.destroy()); });
  server.on("connect", async (req, client, head) => {
    try {
      const url = safeUrl(`https://${req.url ?? ""}`, options.allowLoopback);
      if (url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid CONNECT authority.");
      const address = await resolvePublic(url, options);
      if (client.destroyed) return;
      const upstream = dial(address, Number(url.port || 443));
      upstream.setTimeout(120_000, () => upstream.destroy());
      upstream.once("error", () => client.destroy());
      client.once("error", () => upstream.destroy());
      client.once("close", () => upstream.destroy());
      upstream.once("close", () => client.destroy());
      upstream.once("connect", () => {
        try {client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head.length) upstream.write(head);
          client.pipe(upstream); upstream.pipe(client);
        } catch {client.destroy();upstream.destroy();}
      });
    } catch { try {client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");} catch {client.destroy();} }
  });
  // ws:// upgrades use an ordinary HTTP request to the same checked destination.
  server.on("upgrade", async (req, client, head) => {
    try {
      const url = safeUrl((req.url ?? "").replace(/^ws:/, "http:"), options.allowLoopback);
      if (url.protocol !== "http:") throw new Error("Invalid upgrade.");
      const address = await resolvePublic(url, options);
      const upstream = httpRequest({ hostname: address, port: Number(url.port || 80), path: `${url.pathname}${url.search}`, headers: { ...headersFor(req.headers, url.host), connection: "Upgrade", upgrade: "websocket" }, agent: pinnedAgent(address, Number(url.port || 80)) });
      upstream.on("upgrade", (response, socket, initial) => {
        own(socket);
        try {
        client.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([key, value]) => `${key}: ${String(value)}`).join("\r\n")}\r\n\r\n`);
        if (head.length) socket.write(head); if (initial.length) client.write(initial);
        client.pipe(socket); socket.pipe(client);
        client.once("close", () => socket.destroy()); socket.once("close", () => client.destroy());
        socket.on("error", () => client.destroy()); client.on("error", () => socket.destroy());
        } catch {client.destroy();socket.destroy();}
      });
      upstream.on("response", () => { upstream.destroy(); client.destroy(); });
      upstream.on("error", () => client.destroy()); upstream.end();
    } catch { try {client.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");} catch {client.destroy();} }
  });
  await new Promise<void>((done, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); done(); }); });
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, close: async () => { for (const socket of sockets) socket.destroy(); await new Promise<void>((done) => server.close(() => done())); } };
}

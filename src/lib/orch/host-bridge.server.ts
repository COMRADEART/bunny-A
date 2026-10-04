import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { getRequest, getRequestIP } from "@tanstack/react-start/server";
import type { HostSnapshot } from "../bunny-host/contracts.ts";
import type { OrchTask } from "./types.ts";
import { developmentStateDirectory } from "../bunny-host/state-paths.server.ts";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
// A tunnel or reverse proxy on this machine connects over loopback too, so its headers disqualify workstation access.
const PROXY_HEADERS = ["cf-connecting-ip", "cf-ray", "x-forwarded-for", "x-real-ip", "forwarded"];

/** The TCP peer address of the current request; undefined (and therefore never "local") when it cannot be determined. */
function peerAddress(): string | undefined {
  try { return getRequestIP() ?? undefined; } catch { return undefined; }
}

/**
 * Decides whether a request is the workstation owner (local) or a paired remote device.
 * Workstation access requires the TCP peer to be loopback: the Host header is client-controlled
 * and the dev server listens on all interfaces, so a loopback hostname alone proves nothing.
 */
export function authorizeBridge(request: Request, remoteAddress: string | undefined = peerAddress()): { local: boolean; token: string | null } {
  const url = new URL(request.url);
  const loopbackHost = LOOPBACK_HOSTNAMES.has(url.hostname);
  const loopbackPeer = !!remoteAddress && LOOPBACK_ADDRESSES.has(remoteAddress);
  if (loopbackHost && !loopbackPeer) throw new Error("Workstation authentication is only available from this machine.");
  const local = loopbackHost && loopbackPeer;
  const remote = process.env.BUNNY_REMOTE_ORIGIN;
  const effectiveOrigin = !local && request.headers.get("x-forwarded-proto") === "https" ? `https://${url.host}` : url.origin;
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site") throw new Error("Cross-site requests are refused.");
  if (origin && origin !== effectiveOrigin) throw new Error("Origin mismatch.");
  if (local) {
    const forwarded = request.headers.get("x-forwarded-host");
    if (forwarded && forwarded !== url.host) throw new Error("Untrusted forwarded host.");
    if (PROXY_HEADERS.some(name => request.headers.has(name)) || request.headers.get("x-forwarded-proto") === "https") throw new Error("Remote requests cannot use workstation authentication.");
    return { local: true, token: null };
  }
  if (!remote || effectiveOrigin !== new URL(remote).origin || !effectiveOrigin.startsWith("https://")) throw new Error("Remote gateway is not configured for this HTTPS origin.");
  const token = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith("bunny_device="))?.slice("bunny_device=".length) ?? null;
  return { local: false, token };
}

/** Stable identifier for rate limiting remote callers; prefers the gateway-supplied client IP. */
export function clientKey(request: Request, remoteAddress: string | undefined = peerAddress()): string {
  const forwarded = request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `remote:${(forwarded || remoteAddress || "unknown").slice(0, 64)}`;
}

export async function hostRequest(path: string, data?: unknown): Promise<HostSnapshot | { snapshot: HostSnapshot; task?: OrchTask; pairCode?: string }> {
  const access = authorizeBridge(getRequest());
  const directory = resolve(process.env.BUNNY_HOST_DATA_DIRECTORY ?? developmentStateDirectory());
  let credentials: { token: string; port: number };
  const credentialPath = process.env.BUNNY_HOST_CREDENTIALS_FILE ?? join(directory, process.env.BUNNY_STATE_LAYOUT === "2" ? "credentials/credentials.json" : "credentials.json");
  try { credentials = JSON.parse(readFileSync(credentialPath, "utf8")); } catch { throw new Error("Bunny-A Host is offline or not installed."); }
  const token = access.local ? credentials.token : access.token;
  if (!token) throw new Error("Pair this device with Bunny-A Host first.");
  const response = await fetch(`http://127.0.0.1:${credentials.port}${path}`, { method: data ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  // A device token the Host no longer accepts (revoked) means this phone must pair again, not that the Host is down.
  if (response.status === 401 && !access.local) throw new Error("Pair this device with Bunny-A Host first. This device's access was revoked.");
  if (!response.ok) throw new Error(result.error ?? "Bunny-A Host request failed.");
  return result;
}

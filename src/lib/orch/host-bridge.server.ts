import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { getRequest, getRequestIP } from "@tanstack/react-start/server";
import { developmentStateDirectory } from "../bunny-host/state-paths.server.ts";

const LOOPBACK_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);
const LOOPBACK_ADDRESSES = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
// A tunnel or reverse proxy on this machine connects over loopback too, so its headers disqualify workstation access.
/** Header families relays and tunnels add (Cloudflare, Tailscale, Envoy, Fastly, Vercel, AWS, Azure, ngrok, IIS ARR, rewrites). */
const RELAY_PREFIX =
  /^(x-forwarded-|x-original-|x-rewrite-|cf-|tailscale-|x-envoy-|fastly-|x-vercel-|x-amzn-|x-azure-|x-arr-|x-ms-|ngrok-|x-ngrok-|x-cluster-client-)/;
/**
 * M-A-3 T9R-F02 (D4): x-* headers this application's own local clients send. Any OTHER x-* header (an unknown relay or
 * proxy family) disqualifies workstation authentication: the denylist above cannot enumerate every relay, so an unknown
 * marker fails closed to remote handling.
 */
const LOCAL_X_HEADER = /^x-(tss-[a-z-]+|tsr-[a-z-]+|requested-with|bunny-pair-client)$/;
const PROXY_HEADERS = [
  "cf-connecting-ip",
  "cf-ray",
  "x-forwarded-for",
  "x-real-ip",
  "forwarded",
  "via",
  "cdn-loop",
  "true-client-ip",
  "x-client-ip",
];

/** The TCP peer address of the current request; undefined (and therefore never "local") when it cannot be determined. */
function peerAddress(): string | undefined {
  try {
    return getRequestIP() ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Decides whether a request is the workstation owner (local) or a paired remote device.
 * Workstation access requires the TCP peer to be loopback: the Host header is client-controlled
 * and the dev server listens on all interfaces, so a loopback hostname alone proves nothing.
 * Remote access must also arrive from a loopback peer: the configured HTTPS tunnel connector runs on
 * this machine, so a LAN peer claiming `x-forwarded-proto: https` is a transport downgrade (M-A-3 T9).
 */
export function authorizeBridge(
  request: Request,
  remoteAddress: string | undefined = peerAddress(),
): { local: boolean; token: string | null } {
  const url = new URL(request.url);
  const loopbackHost = LOOPBACK_HOSTNAMES.has(url.hostname);
  const loopbackPeer = !!remoteAddress && LOOPBACK_ADDRESSES.has(remoteAddress);
  if (loopbackHost && !loopbackPeer)
    throw new Error("Workstation authentication is only available from this machine.");
  const local = loopbackHost && loopbackPeer;
  const remote = process.env.BUNNY_REMOTE_ORIGIN;
  const effectiveOrigin =
    !local && request.headers.get("x-forwarded-proto") === "https"
      ? `https://${url.host}`
      : url.origin;
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new Error("Cross-site requests are refused.");
  if (origin && origin !== effectiveOrigin) throw new Error("Origin mismatch.");
  if (local) {
    const forwarded = request.headers.get("x-forwarded-host");
    if (forwarded && forwarded !== url.host) throw new Error("Untrusted forwarded host.");
    // M-A-3 T9R-F01: any forwarding marker (x-forwarded-*, x-original-*, cf-*, ...) means a proxy relayed the request.
    const relayed = [...request.headers.keys()].some(
      (name) =>
        PROXY_HEADERS.includes(name) ||
        RELAY_PREFIX.test(name) ||
        ["front-end-https", "x-url-scheme"].includes(name) ||
        (name.startsWith("x-") && !LOCAL_X_HEADER.test(name)),
    );
    if (relayed) throw new Error("Remote requests cannot use workstation authentication.");
    // A paired-device credential is only ever set on the remote origin, so a "local" request carrying one (in any
    // spacing) arrived through a proxy that rewrote Host. It is remote and never receives the workstation token.
    if (/(^|;)\s*bunny_device\s*=/i.test(request.headers.get("cookie") ?? ""))
      throw new Error("Remote requests cannot use workstation authentication.");
    return { local: true, token: null };
  }
  if (
    !remote ||
    effectiveOrigin !== new URL(remote).origin ||
    !effectiveOrigin.startsWith("https://")
  )
    throw new Error("Remote gateway is not configured for this HTTPS origin.");
  if (!loopbackPeer)
    throw new Error(
      "Remote access must arrive through the configured secure tunnel on this machine.",
    );
  const token =
    request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("bunny_device="))
      ?.slice("bunny_device=".length) ?? null;
  return { local: false, token };
}

/** Stable identifier for rate limiting remote callers; prefers the gateway-supplied client IP. */
export function clientKey(
  request: Request,
  remoteAddress: string | undefined = peerAddress(),
): string {
  const forwarded =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `remote:${(forwarded || remoteAddress || "unknown").slice(0, 64)}`;
}
/** Capability-reducing recovery only: clears a stale device cookie on a verified workstation origin. */
export function mayClearLocalPairing(
  request: Request,
  remoteAddress: string | undefined = peerAddress(),
): boolean {
  if (!/(^|;)\s*bunny_device\s*=/i.test(request.headers.get("cookie") ?? "")) return false;
  const headers = new Headers(request.headers);
  headers.delete("cookie");
  try {
    return authorizeBridge(new Request(request, { headers }), remoteAddress).local;
  } catch {
    return false;
  }
}

/** The loopback Host credentials file of this gateway's configured state. */
export function hostCredentials(): { token: string; port: number } {
  const directory = resolve(process.env.BUNNY_HOST_DATA_DIRECTORY ?? developmentStateDirectory());
  const credentialPath =
    process.env.BUNNY_HOST_CREDENTIALS_FILE ??
    join(
      directory,
      process.env.BUNNY_STATE_LAYOUT === "2" ? "credentials/credentials.json" : "credentials.json",
    );
  try {
    return JSON.parse(readFileSync(credentialPath, "utf8"));
  } catch {
    throw new HostTransportError(
      "Bunny-A connection is unavailable; installed Host credentials could not be read.",
      false,
    );
  }
}

/** The gateway could not get an answer from the Host. `sent` = the request may have reached it (outcome unknown). */
export class HostTransportError extends Error {
  sent: boolean;
  constructor(message: string, sent: boolean) {
    super(message);
    this.name = "HostTransportError";
    this.sent = sent;
  }
}
/** The gateway itself refused the browser request (origin, transport, configuration); nothing reached the Host. */
export class GatewayRefusal extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "GatewayRefusal";
    this.code = code;
  }
}

export type HostReply = { status: number; body: Record<string, unknown>; local: boolean };
/**
 * One authenticated loopback call to the Host. Every Host answer, including refusals, comes back as data;
 * only a missing answer throws (HostTransportError), and a refused browser request throws GatewayRefusal.
 */
export async function hostCall(
  path: string,
  data?: unknown,
  timeoutMs = 15_000,
): Promise<HostReply> {
  let access: { local: boolean; token: string | null };
  try {
    access = authorizeBridge(getRequest());
  } catch (error) {
    throw new GatewayRefusal(
      "GATEWAY_REFUSED",
      error instanceof Error ? error.message : "Request refused.",
    );
  }
  const credentials = hostCredentials();
  const token = access.local ? credentials.token : access.token;
  if (!token)
    return {
      status: 401,
      local: false,
      body: { code: "PAIRING_REQUIRED", error: "Pair this device with Bunny-A Host first." },
    };
  let response: Response;
  try {
    response = await fetch(`http://127.0.0.1:${credentials.port}${path}`, {
      method: data ? "POST" : "GET",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: data ? JSON.stringify(data) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    // A refused connection never delivered the request; anything else (timeout, reset) may have.
    const cause = (error as { cause?: { code?: string } })?.cause?.code;
    throw new HostTransportError("Bunny-A Host did not answer.", cause !== "ECONNREFUSED");
  }
  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new HostTransportError("Bunny-A Host answer was incomplete.", true);
  }
  return { status: response.status, body, local: access.local };
}

export type HostFailure = {
  ok: false;
  code: string;
  message: string;
  status: number;
  requestId?: string;
  retryAfterMs?: number;
  pairing: boolean;
};
const PAIRING_CODES = new Set([
  "AUTH_REQUIRED",
  "DEVICE_REVOKED",
  "DEVICE_EXPIRED",
  "PAIRING_REQUIRED",
]);
const PAIRING_MESSAGES: Record<string, string> = {
  DEVICE_REVOKED: "This device's access was revoked. Pair it again from your workstation.",
  DEVICE_EXPIRED: "This device's session expired. Pair it again from your workstation.",
  AUTH_REQUIRED: "Pair this device with Bunny-A Host first.",
  PAIRING_REQUIRED: "Pair this device with Bunny-A Host first.",
};
/** A non-200 Host answer as a typed failure; codes, never message text, decide what the client shows. */
export function hostFailure(reply: HostReply): HostFailure {
  const raw =
    typeof reply.body.code === "string"
      ? reply.body.code
      : reply.status === 401
        ? "AUTH_REQUIRED"
        : reply.status === 503
          ? "HOST_UNAVAILABLE"
          : reply.status === 429
            ? "RATE_LIMITED"
            : "REFUSED";
  // The workstation's own credential is never "pairing": a 401 there means the Host credentials changed.
  const pairing = !reply.local && reply.status === 401 && PAIRING_CODES.has(raw);
  return {
    ok: false,
    code: raw,
    message: pairing
      ? (PAIRING_MESSAGES[raw] ?? PAIRING_MESSAGES.AUTH_REQUIRED)
      : typeof reply.body.error === "string"
        ? reply.body.error
        : "Bunny-A Host refused the request.",
    status: reply.status,
    ...(typeof reply.body.requestId === "string" ? { requestId: reply.body.requestId } : {}),
    ...(typeof reply.body.retryAfterMs === "number"
      ? { retryAfterMs: reply.body.retryAfterMs }
      : {}),
    pairing,
  };
}
/** A missing answer as a typed failure. A command that may have been delivered has an unknown outcome. */
export function transportFailure(
  error: unknown,
  command: boolean,
): HostFailure & { outcome?: "unknown" | "refused" } {
  if (error instanceof GatewayRefusal)
    return {
      ok: false,
      code: error.code,
      message: error.message,
      status: 403,
      pairing: false,
      outcome: "refused",
    };
  const sent = error instanceof HostTransportError ? error.sent : true;
  if (command && sent)
    return {
      ok: false,
      code: "OUTCOME_UNKNOWN",
      message:
        "The Host did not confirm this command. Checking its current state before anything else is sent.",
      status: 504,
      pairing: false,
      outcome: "unknown",
    };
  return {
    ok: false,
    code: "HOST_UNREACHABLE",
    message: "Bunny-A Host is unreachable.",
    status: 503,
    pairing: false,
    outcome: "refused",
  };
}

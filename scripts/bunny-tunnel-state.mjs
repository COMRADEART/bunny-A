// Parse cloudflared's successful address announcement, never API/error URLs.
// Publishing waits for a registered edge connection as well as the announcement.
export function announcedQuickTunnel(output) {
  const announcement = output.lastIndexOf("Your quick Tunnel has been created!");
  if (announcement < 0) return null;
  const section = output.slice(announcement, announcement + 2000);
  const address = section.match(/\|\s*(https:\/\/([a-z0-9-]+)\.trycloudflare\.com)\s*\|/);
  if (!address || address[2] === "api") return null;
  return address[1];
}

export function readyTunnelAddress(output, namedUrl = null) {
  if (!/\bRegistered tunnel connection\b/.test(output)) return null;
  return namedUrl ?? announcedQuickTunnel(output);
}

// cloudflared logs one register/unregister event per live edge connection
// (connIndex). The supervisor watchdog reads this ledger from the child stream.
export function parseRegistrationEvents(line) {
  const events = [];
  const register = /\bRegistered tunnel connection\b/.test(line);
  const unregister = /\bUnregistered tunnel connection\b/.test(line);
  if (!register && !unregister) return events;
  const connIndex = /connIndex=(\d+)/.exec(line);
  events.push({
    kind: register ? "register" : "unregister",
    connIndex: connIndex ? Number(connIndex[1]) : null,
  });
  return events;
}

// Which worker owns the published remote address? remote.json carries the
// recording worker's pid; a residue after a hard kill is stale state.
export function startupTunnelDecision({ remote, recorded, pid, pidAlive }) {
  if (!remote) {
    if (recorded && recorded.pid !== pid && pidAlive(recorded.pid)) {
      return { action: "refuse", recordedPid: recorded.pid };
    }
    return { action: "none" };
  }
  const recordedPid = remote.tunnelPid ?? recorded?.pid ?? null;
  if (recordedPid == null) return { action: "reconcile", reason: "remote-publication-has-no-worker-record" };
  if (recordedPid === pid) return { action: "reconcile", reason: "publication-predates-current-worker" };
  if (pidAlive(recordedPid)) return { action: "refuse", recordedPid };
  return { action: "reconcile", reason: `recorded-worker-${recordedPid}-not-running` };
}

// The tunnel remains outbound-only. A candidate may use a separate loopback
// listener without repointing or replacing the installed dashboard gateway.
export function loopbackTunnelOrigin(value = "http://127.0.0.1:8084") {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.username || url.password ||
    url.pathname !== "/" || url.search || url.hash
  ) throw new Error("Tunnel target must be an HTTP loopback origin with an explicit port.");
  return url.origin;
}

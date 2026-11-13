/**
 * M-A-3 T9 phone connection model. Pure: the store feeds it observations (reads, stream signals, pairing and Host
 * identity facts) and it decides what the client may claim and do. The Host stays the only authority; this model
 * only decides when the client's view is fresh enough to act on, and how hard it may retry.
 */
export type ConnectionState =
  | "connecting"
  | "live"
  | "polling"
  | "reconnecting"
  | "offline"
  | "pairing"
  | "host-changed";

export type Connection = {
  state: ConnectionState;
  /** Last successful canonical snapshot (ms epoch), or null before the first one. */
  snapshotAt: number | null;
  /** Last stream sign of life: `ready`, `hb` or an event message. */
  streamAt: number | null;
  /** When the current stream attempt opened (for the ready deadline), or null when no stream is open. */
  streamOpenedAt: number | null;
  streamErrors: number;
  readFailures: number;
  /** Why pairing is required (DEVICE_REVOKED, DEVICE_EXPIRED, AUTH_REQUIRED, PAIRING_REQUIRED). */
  pairingCode: string | null;
};

export const SNAPSHOT_FRESH_MS = 20_000;
export const STREAM_READY_MS = 8_000;
export const STREAM_STALE_MS = 35_000;
export const STREAM_ERROR_LIMIT = 3;
export const OFFLINE_AFTER_FAILURES = 2;
export const POLL_VISIBLE_MS = 3_000;
export const POLL_HIDDEN_MS = 30_000;
/**
 * A live stream still re-reads the canonical snapshot on this cadence. It must stay below SNAPSHOT_FRESH_MS: a 30 s
 * re-read let the snapshot age past 20 s between reads, so a healthy connection flickered to OFFLINE on the characters.
 */
export const LIVE_REFRESH_MS = 15_000;
const BACKOFF = [3_000, 6_000, 12_000, 30_000, 60_000];
/** A visible screen never waits longer than this between retries: someone is watching for the PC to come back. */
export const VISIBLE_RETRY_CAP_MS = 15_000;

export const initialConnection = (): Connection => ({
  state: "connecting",
  snapshotAt: null,
  streamAt: null,
  streamOpenedAt: null,
  streamErrors: 0,
  readFailures: 0,
  pairingCode: null,
});

export type ConnectionEvent =
  | { type: "read-ok"; at: number; hostChanged: boolean }
  | { type: "read-fail"; at: number }
  | { type: "pairing"; code: string }
  | { type: "paired"; at: number }
  | { type: "trust-host"; at: number }
  | { type: "stream-open"; at: number }
  | { type: "stream-signal"; at: number }
  | { type: "stream-error"; at: number }
  | { type: "stream-closed" }
  | { type: "tick"; at: number };

/** Live needs a fresh snapshot and a stream that proved it delivers (ready/hb/message) recently. */
function settle(connection: Connection, at: number): ConnectionState {
  if (connection.state === "pairing" || connection.state === "host-changed") return connection.state;
  if (connection.readFailures >= OFFLINE_AFTER_FAILURES) return "offline";
  if (connection.readFailures > 0) return connection.snapshotAt === null ? "connecting" : "reconnecting";
  if (connection.snapshotAt === null) return "connecting";
  const streamLive =
    connection.streamAt !== null &&
    at - connection.streamAt <= STREAM_STALE_MS &&
    connection.streamErrors < STREAM_ERROR_LIMIT;
  return streamLive && at - connection.snapshotAt <= SNAPSHOT_FRESH_MS ? "live" : "polling";
}

export function connectionReducer(connection: Connection, event: ConnectionEvent): Connection {
  switch (event.type) {
    case "pairing":
      // Pairing is terminal until the user pairs again: no retries, no streams.
      return { ...initialConnection(), state: "pairing", pairingCode: event.code };
    case "paired":
      return { ...initialConnection(), state: "connecting" };
    case "trust-host":
      if (connection.state !== "host-changed") return connection;
      return { ...connection, state: settle({ ...connection, state: "connecting" }, event.at) };
    case "read-ok": {
      if (connection.state === "pairing") return connection;
      const next = { ...connection, snapshotAt: event.at, readFailures: 0 };
      if (event.hostChanged) return { ...next, state: "host-changed" };
      return { ...next, state: settle(next, event.at) };
    }
    case "read-fail": {
      if (connection.state === "pairing") return connection;
      const next = { ...connection, readFailures: connection.readFailures + 1 };
      return { ...next, state: settle(next, event.at) };
    }
    case "stream-open":
      return { ...connection, streamOpenedAt: event.at };
    case "stream-signal": {
      const next = { ...connection, streamAt: event.at, streamErrors: 0 };
      return { ...next, state: settle(next, event.at) };
    }
    case "stream-error": {
      const next = { ...connection, streamErrors: connection.streamErrors + 1, streamOpenedAt: null };
      return { ...next, state: settle(next, event.at) };
    }
    case "stream-closed":
      return { ...connection, streamOpenedAt: null, streamAt: null };
    case "tick": {
      // A stream that never said ready within its deadline is treated as stalled (buffering tunnel).
      const stalled =
        connection.streamOpenedAt !== null &&
        connection.streamAt === null &&
        event.at - connection.streamOpenedAt > STREAM_READY_MS;
      const next = stalled ? { ...connection, streamErrors: STREAM_ERROR_LIMIT } : connection;
      const state = settle(next, event.at);
      return state === next.state && next === connection ? connection : { ...next, state };
    }
  }
}

/** Mutating controls need a fresh canonical view from this Host over a working connection. */
export function canAct(connection: Pick<Connection, "state" | "snapshotAt">, at: number) {
  return (
    (connection.state === "live" || connection.state === "polling") &&
    connection.snapshotAt !== null &&
    at - connection.snapshotAt <= SNAPSHOT_FRESH_MS
  );
}
/** Whether the client should keep retrying on its own (never while pairing or awaiting Host trust). */
export const shouldRetry = (state: ConnectionState) => state !== "pairing" && state !== "host-changed";
/** Whether an event stream may be opened now. */
export const mayStream = (state: ConnectionState) => state === "live" || state === "polling";
export function backoffMs(failures: number) {
  return BACKOFF[Math.min(Math.max(failures - 1, 0), BACKOFF.length - 1)];
}
export const pollIntervalMs = (visible: boolean) => (visible ? POLL_VISIBLE_MS : POLL_HIDDEN_MS);
/** Next refresh delay: polling cadence while connected without a live stream, backoff while failing (capped while visible). */
export function nextRefreshMs(connection: Pick<Connection, "state" | "readFailures">, visible: boolean): number | null {
  if (!shouldRetry(connection.state)) return null;
  if (connection.readFailures > 0) {
    const wait = backoffMs(connection.readFailures);
    return visible ? Math.min(wait, VISIBLE_RETRY_CAP_MS) : wait;
  }
  if (connection.state === "live") return LIVE_REFRESH_MS;
  return pollIntervalMs(visible);
}

export const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connecting: "Connecting to your PC",
  live: "Live",
  // Live and polling differ only in how updates arrive; the user needs to know it works, not how.
  polling: "Connected",
  reconnecting: "Reconnecting…",
  offline: "Offline",
  pairing: "Pairing needed",
  "host-changed": "Not the PC you paired with",
};
const PAIRING_REASON: Record<string, string> = {
  DEVICE_REVOKED: "This device's access was turned off on your PC.",
  DEVICE_EXPIRED: "This device's pairing has ended.",
  AUTH_REQUIRED: "This device is not paired with your PC.",
  PAIRING_REQUIRED: "This device is not paired with your PC.",
};
export const pairingReason = (code: string | null) =>
  PAIRING_REASON[code ?? ""] ?? "This device needs to pair with your PC.";
/** What to do about it. The code can only be created on the PC, so the phone can only say where. */
export const PAIRING_NEXT_STEP = "On your PC, open Bunny and create a pairing code under Devices, then enter it here.";
/** What a changed Host identity means and when trusting it is right. */
export const HOST_CHANGED_DETAIL =
  "This address is now answered by a different Bunny install. Trust it only if you reinstalled Bunny or moved to a new PC.";

/** "Last updated 14:05" — the time a retained view was last confirmed by the Host. */
export function freshnessLabel(snapshotAt: number | null, at: number, format: (ms: number) => string) {
  if (snapshotAt === null) return "Not yet updated from your PC";
  const age = at - snapshotAt;
  if (age < 10_000) return "Updated just now";
  return `Last updated ${format(snapshotAt)}`;
}

/** Captions for a refused or uncertain command, chosen by code — never by parsing message text. */
export function commandCaption(result: { code: string; message: string; outcome?: "refused" | "unknown"; pairing?: boolean }) {
  if (result.outcome === "unknown") return "Outcome unknown — checking with your PC…";
  if (result.pairing) return pairingReason(result.code);
  switch (result.code) {
    case "HOST_EPOCH_CHANGED":
    case "HOST_IDENTITY_CHANGED":
      return "Bunny on your PC restarted or changed since this view loaded. Nothing was changed; showing the current state.";
    case "RATE_LIMITED":
      return "Too many requests from this device. Wait a moment, then try again.";
    case "HOST_UNREACHABLE":
    case "GATEWAY_REFUSED":
      return "Can't reach your PC. Nothing was sent.";
    default:
      return result.message;
  }
}

/** Read actions never carry an operation id or an epoch expectation. */
export const READ_ACTIONS = new Set([
  "agent.list",
  "agent.get",
  "mission.get",
  "project.list",
  "project.get",
  "project.artifact",
  "operation.status",
  // M-A-3 T9R-F02: workstation-only staged-change reads (inspection only records that the owner looked).
  "mission.staging.list",
  "mission.staging.inspect",
  // M-A-3 T13.3: Lotus export and authorized recall change nothing.
  "lotus.export",
  "lotus.recall",
  // MA4-S2-T1: reading persistent tasks and a step's output changes nothing.
  "ptask.list",
  "ptask.get",
  "ptask.output",
  // MA4-S2-T2: inspecting a waiting action, its receipts and the registered folders changes nothing.
  "action.inspect",
  "action.receipts",
  "connector.roots.list",
  // MA4-S2-T3: reading goals, schedules and monitors changes nothing.
  "proactive.list",
  // MA4-S2-T3R: previews validate and describe; they change nothing.
  "goal.preview",
  "schedule.preview",
  "monitor.preview",
  "feedback.status",
  "feedback.preview",
  "feedback.list",
  "feedback.export",
  "onboarding.get",
  "notification.decide",
  "diagnostics.health",
]);
export const isMutating = (action: string) => !READ_ACTIONS.has(action);

export type Uncertain = { operationId: string; action: string; targetId: string | null; since: number; epoch: string | null };
/** How a reconciled uncertain operation reads to the user once the Host answers operation.status. */
export function reconcileCaption(state: string, sameEpoch: boolean, refusal?: string | null) {
  if (!sameEpoch) return "Bunny on your PC restarted. Check the current state below before acting again.";
  if (state === "applied") return "Confirmed by your PC.";
  if (state === "refused") return refusal ?? "Your PC refused this action; nothing was changed.";
  if (state === "failed") return "Your PC reported a failure. Check the current state below before acting again.";
  if (state === "in_progress") return "Your PC is still applying this action.";
  return "Your PC has no record of this action. Check the current state below before acting again.";
}

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? "" : "s"}`;

/** "5 minutes ago". A missing time reads as `never`; a time ahead of this clock reads as now, not as the future. */
export function agoText(at: number | null | undefined, now: number, never = "never"): string {
  if (!at) return never;
  const age = Math.max(0, now - at);
  if (age < MINUTE) return "just now";
  if (age < HOUR) return `${plural(Math.floor(age / MINUTE), "minute")} ago`;
  if (age < DAY) return `${plural(Math.floor(age / HOUR), "hour")} ago`;
  if (age < 60 * DAY) return `${plural(Math.floor(age / DAY), "day")} ago`;
  if (age < 365 * DAY) return `${plural(Math.floor(age / (30 * DAY)), "month")} ago`;
  return `${plural(Math.floor(age / (365 * DAY)), "year")} ago`;
}

/** How far ahead a pairing's end is called out. */
export const PAIRING_WARN_MS = 7 * DAY;
/** Mirrors the Host's absolute pairing lifetime (device-authority DEVICE_SESSION_MS); a test pins the two together. */
export const PAIRING_LIFETIME_MS = 365 * DAY;

/**
 * A warning while a pairing is inside its last week, else null. `renew` says what keeps the device paired: using it
 * (the Host's idle limit restarts on every use) or, once the absolute lifetime is what ends it, pairing again.
 */
export function pairingEnding(
  device: { createdAt: number; expiresAt?: number | null },
  now: number,
): { text: string; renew: "use" | "pair-again" } | null {
  if (typeof device.expiresAt !== "number") return null;
  const left = device.expiresAt - now;
  if (left <= 0 || left > PAIRING_WARN_MS) return null;
  const days = Math.floor(left / DAY);
  return {
    text: days < 1 ? "Pairing ends today" : `Pairing ends in ${plural(days, "day")}`,
    renew: device.expiresAt >= device.createdAt + PAIRING_LIFETIME_MS ? "pair-again" : "use",
  };
}

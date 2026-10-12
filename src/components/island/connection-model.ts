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
/** Next refresh delay: polling cadence while connected without a live stream, backoff while failing. */
export function nextRefreshMs(connection: Pick<Connection, "state" | "readFailures">, visible: boolean): number | null {
  if (!shouldRetry(connection.state)) return null;
  if (connection.readFailures > 0) return backoffMs(connection.readFailures);
  if (connection.state === "live") return LIVE_REFRESH_MS;
  return pollIntervalMs(visible);
}

export const CONNECTION_LABEL: Record<ConnectionState, string> = {
  connecting: "Connecting to Host",
  live: "Live",
  polling: "Updating every few seconds",
  reconnecting: "Reconnecting…",
  offline: "Offline",
  pairing: "Pairing required",
  "host-changed": "Different Bunny-A Host",
};
const PAIRING_REASON: Record<string, string> = {
  DEVICE_REVOKED: "This device's access was revoked on the workstation.",
  DEVICE_EXPIRED: "This device's session expired.",
  AUTH_REQUIRED: "This device is not paired with this Host.",
  PAIRING_REQUIRED: "This device is not paired with this Host.",
};
export const pairingReason = (code: string | null) =>
  PAIRING_REASON[code ?? ""] ?? "This device needs to pair with your workstation.";

/** "Last updated 14:05" — the time a retained view was last confirmed by the Host. */
export function freshnessLabel(snapshotAt: number | null, at: number, format: (ms: number) => string) {
  if (snapshotAt === null) return "Not yet updated from the Host";
  const age = at - snapshotAt;
  if (age < 10_000) return "Updated just now";
  return `Last updated ${format(snapshotAt)}`;
}

/** Captions for a refused or uncertain command, chosen by code — never by parsing message text. */
export function commandCaption(result: { code: string; message: string; outcome?: "refused" | "unknown"; pairing?: boolean }) {
  if (result.outcome === "unknown") return "Outcome unknown — checking the Host…";
  if (result.pairing) return pairingReason(result.code);
  switch (result.code) {
    case "HOST_EPOCH_CHANGED":
    case "HOST_IDENTITY_CHANGED":
      return "The Host changed since this view loaded. Nothing was changed; showing the current state.";
    case "RATE_LIMITED":
      return "Too many requests from this device. Wait a moment, then try again.";
    case "HOST_UNREACHABLE":
    case "GATEWAY_REFUSED":
      return "Bunny-A Host is unreachable. Nothing was sent.";
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
]);
export const isMutating = (action: string) => !READ_ACTIONS.has(action);

export type Uncertain = { operationId: string; action: string; targetId: string | null; since: number; epoch: string | null };
/** How a reconciled uncertain operation reads to the user once the Host answers operation.status. */
export function reconcileCaption(state: string, sameEpoch: boolean, refusal?: string | null) {
  if (!sameEpoch) return "The Host restarted. Check the current state below before acting again.";
  if (state === "applied") return "Confirmed by the Host.";
  if (state === "refused") return refusal ?? "The Host refused this action; nothing was changed.";
  if (state === "failed") return "The Host reported a failure. Check the current state below before acting again.";
  if (state === "in_progress") return "The Host is still applying this action.";
  return "The Host has no record of this action. Check the current state below before acting again.";
}

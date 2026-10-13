import { useEffect } from "react";
import { useIsland } from "@/store/use-island";
import {
  backoffMs,
  mayStream,
  nextRefreshMs,
  STREAM_READY_MS,
  STREAM_STALE_MS,
  type ConnectionState,
} from "./connection-model";

/**
 * One subscription per mounted shell. SSE is an invalidation signal, never a state authority (M-A-3 T9):
 * a stream counts as live only after the bridge's `ready` event and while `hb` heartbeats keep arriving.
 * Without that the client polls canonical snapshots (3 s visible, 30 s hidden); failures back off to 60 s;
 * pairing and an untrusted Host stop every automatic retry.
 */
export function useHostStream() {
  const refresh = useIsland((state) => state.refreshOllama);
  useEffect(() => {
    let disposed = false;
    let stream: EventSource | null = null;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    let reconcile: ReturnType<typeof setTimeout> | undefined;
    let dirty = false;
    let streamFailures = 0;
    let streamRetryAt = 0;
    let running: Promise<void> | null = null;
    let lastState: ConnectionState = useIsland.getState().connection.state;
    const signal = (event: Parameters<ReturnType<typeof useIsland.getState>["connectionEvent"]>[0]) =>
      useIsland.getState().connectionEvent(event);
    const visible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
    const closeStream = () => {
      if (!stream) return;
      stream.close();
      stream = null;
      signal({ type: "stream-closed" });
    };
    const schedule = () => {
      clearTimeout(refreshTimer);
      if (disposed) return;
      const delay = nextRefreshMs(useIsland.getState().connection, visible());
      if (delay !== null) refreshTimer = setTimeout(() => void loop(), delay);
    };
    const update = async () => {
      await refresh();
      if (disposed) return;
      if (dirty) {
        dirty = false;
        reconcile = setTimeout(update, 120);
      } else reconcile = undefined;
    };
    // Event messages only invalidate: one coalesced canonical refresh per burst.
    const invalidate = () => {
      dirty = true;
      if (!reconcile) {
        dirty = false;
        reconcile = setTimeout(update, 120);
      }
    };
    const ensureStream = () => {
      if (disposed) return;
      const state = useIsland.getState().connection.state;
      if (!mayStream(state)) return closeStream();
      if (stream || Date.now() < streamRetryAt || typeof EventSource === "undefined") return;
      // Refresh detects changed Host epochs and gaps before we reuse any cursor.
      const source = new EventSource(`/api/bunny-events?after=${useIsland.getState().cursor}`);
      stream = source;
      signal({ type: "stream-open", at: Date.now() });
      const alive = () => {
        if (stream !== source) return;
        streamFailures = 0;
        signal({ type: "stream-signal", at: Date.now() });
      };
      source.addEventListener("ready", () => {
        alive();
        invalidate();
      });
      source.addEventListener("hb", alive);
      source.onmessage = () => {
        alive();
        invalidate();
      };
      source.onerror = () => {
        if (stream !== source) return;
        source.close();
        stream = null;
        streamFailures++;
        streamRetryAt = Date.now() + backoffMs(streamFailures);
        signal({ type: "stream-error", at: Date.now() });
        // A refused stream may mean revocation: one canonical read decides (it can move us to pairing).
        void loop();
      };
    };
    const loop = (): Promise<void> => {
      if (running) return running;
      running = (async () => {
        clearTimeout(refreshTimer);
        if (disposed) return;
        await refresh();
        if (disposed) return;
        signal({ type: "tick", at: Date.now() });
        ensureStream();
        schedule();
      })().finally(() => {
        running = null;
      });
      return running;
    };
    // Detect a stream that never became ready or went silent behind a buffering tunnel; drop to polling.
    const watchdog = setInterval(() => {
      if (disposed) return;
      const now = Date.now();
      const connection = useIsland.getState().connection;
      const stalled =
        !!stream &&
        ((connection.streamAt === null &&
          connection.streamOpenedAt !== null &&
          now - connection.streamOpenedAt > STREAM_READY_MS) ||
          (connection.streamAt !== null && now - connection.streamAt > STREAM_STALE_MS));
      signal({ type: "tick", at: now });
      if (stalled) {
        closeStream();
        streamFailures++;
        streamRetryAt = now + backoffMs(streamFailures);
      }
      ensureStream();
    }, 4_000);
    // Re-plan the cadence whenever the connection state changes (live ↔ polling, pairing, trust).
    const unsubscribe = useIsland.subscribe((state) => {
      const next = state.connection.state;
      if (next === lastState) return;
      const previous = lastState;
      lastState = next;
      if (next === "pairing" || next === "host-changed") {
        closeStream();
        clearTimeout(refreshTimer);
        return;
      }
      if (previous === "pairing" || previous === "host-changed") void loop();
      else schedule();
    });
    const wake = () => {
      if (visible()) void loop();
      else schedule();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    void loop();
    return () => {
      disposed = true;
      unsubscribe();
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
      closeStream();
      clearTimeout(refreshTimer);
      clearTimeout(reconcile);
      clearInterval(watchdog);
    };
  }, [refresh]);
}

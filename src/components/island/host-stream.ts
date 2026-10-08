import { useEffect } from "react";
import { useIsland } from "@/store/use-island";

/** One subscription per mounted shell. SSE is an invalidation signal, never a state authority. */
export function useHostStream() {
  const refresh = useIsland((state) => state.refreshOllama);
  useEffect(() => {
    let disposed = false;
    let stream: EventSource | null = null;
    let reconnect: ReturnType<typeof setTimeout> | undefined;
    let reconcile: ReturnType<typeof setTimeout> | undefined;
    let dirty = false;
    const update = async () => {
      await refresh();
      if (disposed) return;
      if (dirty) {
        dirty = false;
        reconcile = setTimeout(update, 120);
      } else reconcile = undefined;
    };
    const invalidate = () => {
      dirty = true;
      if (!reconcile) {
        dirty = false;
        reconcile = setTimeout(update, 120);
      }
    };
    const connect = async () => {
      await refresh();
      if (disposed) return;
      if (useIsland.getState().host !== "online") {
        useIsland.setState({ streamStatus: "reconnecting" });
        reconnect = setTimeout(connect, 3000);
        return;
      }
      // Refresh detects changed Host epochs and gaps before we reuse any cursor.
      const cursor = useIsland.getState().cursor;
      stream = new EventSource(`/api/bunny-events?after=${cursor}`);
      stream.onopen = () => {
        useIsland.setState({ streamStatus: "live" });
        invalidate();
      };
      stream.onmessage = invalidate;
      stream.onerror = () => {
        stream?.close();
        stream = null;
        useIsland.setState({ streamStatus: "reconnecting" });
        void refresh();
        if (!disposed) reconnect = setTimeout(connect, 3000);
      };
    };
    void connect();
    // Heartbeats have no state payload. One bounded reconciliation catches silent epoch changes.
    const timer = setInterval(invalidate, 30_000);
    return () => {
      disposed = true;
      stream?.close();
      clearTimeout(reconnect);
      clearTimeout(reconcile);
      clearInterval(timer);
    };
  }, [refresh]);
}

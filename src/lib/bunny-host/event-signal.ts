/** Only the canonical cursor crosses the SSE bridge. Prompt/tool detail stays on the Host. */
export function eventSignal(line: string): string {
  if (line.startsWith(":")) return ": heartbeat\n\n";
  if (!line.startsWith("data: ")) return "";
  const row = JSON.parse(line.slice(6)) as { sequence?: number };
  return Number.isSafeInteger(row.sequence) && row.sequence! >= 0
    ? `id: ${row.sequence}\ndata: {"sequence":${row.sequence}}\n\n`
    : "";
}

/**
 * M-A-3 T9 liveness: a remote client cannot see SSE comments, so a buffering tunnel or a stalled stream would
 * look healthy forever. With liveness on, the bridge opens with a data-bearing ready event and turns each Host
 * heartbeat into a named hb event. Neither carries Host content.
 */
export const READY_SIGNAL = "event: ready\ndata: {}\n\n";
export const HEARTBEAT_SIGNAL = "event: hb\ndata: {}\n\n";

export function signalStream(
  body: ReadableStream<Uint8Array>,
  cleanup: () => void,
  handshake = false,
  liveness = false,
) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  const reader = body
    .pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, output) {
          pending += decoder.decode(chunk, { stream: true });
          if (pending.length > 262_144) throw new Error("Host event exceeded bridge bound.");
          let newline: number;
          while ((newline = pending.indexOf("\n")) >= 0) {
            const line = pending.slice(0, newline).trimEnd();
            pending = pending.slice(newline + 1);
            const signal = liveness && line.startsWith(":") ? HEARTBEAT_SIGNAL : eventSignal(line);
            if (signal) output.enqueue(encoder.encode(signal));
          }
        },
      }),
    )
    .getReader();
  let closed = false;
  const end = () => {
    if (!closed) {
      closed = true;
      cleanup();
    }
  };
  return new ReadableStream<Uint8Array>({
    start(output) {
      // Flush the HTTP bridge even when the subscriber is already at the journal head.
      if (handshake) output.enqueue(encoder.encode(liveness ? READY_SIGNAL : ": connected\n\n"));
    },
    async pull(output) {
      try {
        const row = await reader.read();
        if (row.done) {
          end();
          output.close();
        } else output.enqueue(row.value);
      } catch (error) {
        end();
        output.error(error);
      }
    },
    async cancel(reason) {
      end();
      await reader.cancel(reason);
    },
  });
}

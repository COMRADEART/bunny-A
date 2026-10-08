/** Only the canonical cursor crosses the SSE bridge. Prompt/tool detail stays on the Host. */
export function eventSignal(line: string): string {
  if (line.startsWith(":")) return ": heartbeat\n\n";
  if (!line.startsWith("data: ")) return "";
  const row = JSON.parse(line.slice(6)) as { sequence?: number };
  return Number.isSafeInteger(row.sequence) && row.sequence! >= 0
    ? `id: ${row.sequence}\ndata: {"sequence":${row.sequence}}\n\n`
    : "";
}

export function signalStream(
  body: ReadableStream<Uint8Array>,
  cleanup: () => void,
  handshake = false,
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
            const signal = eventSignal(line);
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
      if (handshake) output.enqueue(encoder.encode(": connected\n\n"));
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

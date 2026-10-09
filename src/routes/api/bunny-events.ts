import { createFileRoute } from "@tanstack/react-router";
import { authorizeBridge, hostCredentials } from "../../lib/orch/host-bridge.server.ts";
import { signalStream } from "../../lib/bunny-host/event-signal.ts";

export const Route = createFileRoute("/api/bunny-events")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let cleanup: (() => void) | undefined;
        try {
          let access: { local: boolean; token: string | null };
          try {
            access = authorizeBridge(request);
          } catch {
            return Response.json({ error: "Activity stream refused.", code: "GATEWAY_REFUSED" }, { status: 403 });
          }
          const url = new URL(request.url);
          const after = Number(
            request.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0,
          );
          if (!Number.isSafeInteger(after) || after < 0)
            return Response.json({ error: "Invalid event cursor." }, { status: 400 });
          const credentials = hostCredentials();
          const token = access.local ? credentials.token : access.token;
          if (!token)
            return Response.json({ error: "Pair this device first.", code: "PAIRING_REQUIRED" }, { status: 401 });
          const controller = new AbortController();
          const abort = () => controller.abort();
          cleanup = () => {
            request.signal.removeEventListener("abort", abort);
            controller.abort();
          };
          request.signal.addEventListener("abort", abort, { once: true });
          const connectTimer = setTimeout(abort, 5000);
          let response: Response;
          try {
            response = await fetch(`http://127.0.0.1:${credentials.port}/events?after=${after}`, {
              headers: { authorization: `Bearer ${token}` },
              signal: controller.signal,
            });
          } finally {
            clearTimeout(connectTimer);
          }
          if (!response.ok || !response.body) {
            cleanup();
            // M-A-3 T9: typed refusals so a revoked, expired or rate-limited device stops reconnecting.
            let refusal: { code?: string; retryAfterMs?: number } = {};
            try {
              refusal = (await response.json()) as typeof refusal;
            } catch {
              /* No typed body. */
            }
            if (response.status === 401 || response.status === 429)
              return Response.json(
                {
                  error: response.status === 401 ? "This device must pair again." : "Too many activity streams.",
                  code: refusal.code ?? (response.status === 401 ? "AUTH_REQUIRED" : "RATE_LIMITED"),
                  ...(typeof refusal.retryAfterMs === "number" ? { retryAfterMs: refusal.retryAfterMs } : {}),
                },
                { status: response.status },
              );
            return Response.json({ error: "Host activity unavailable.", code: "HOST_UNAVAILABLE" }, { status: 503 });
          }
          // Liveness on: a data-bearing ready event and named heartbeats let a remote client tell a live
          // stream from one a tunnel buffers; still no Host content crosses the bridge.
          const safe = signalStream(response.body, cleanup, true, true);
          return new Response(safe, {
            headers: {
              "content-type": "text/event-stream; charset=utf-8",
              "cache-control": "no-store",
              "x-accel-buffering": "no",
            },
          });
        } catch {
          cleanup?.();
          return Response.json(
            { error: "Authenticated Host activity is unavailable.", code: "HOST_UNREACHABLE" },
            { status: 503 },
          );
        }
      },
    },
  },
});

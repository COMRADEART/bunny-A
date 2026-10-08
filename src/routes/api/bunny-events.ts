import { createFileRoute } from "@tanstack/react-router";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { authorizeBridge } from "../../lib/orch/host-bridge.server.ts";
import { developmentStateDirectory } from "../../lib/bunny-host/state-paths.server.ts";
import { signalStream } from "../../lib/bunny-host/event-signal.ts";

export const Route = createFileRoute("/api/bunny-events")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        let cleanup: (() => void) | undefined;
        try {
          const access = authorizeBridge(request);
          const url = new URL(request.url);
          const after = Number(
            request.headers.get("last-event-id") ?? url.searchParams.get("after") ?? 0,
          );
          if (!Number.isSafeInteger(after) || after < 0)
            return Response.json({ error: "Invalid event cursor." }, { status: 400 });
          const credentials = JSON.parse(
            readFileSync(
              process.env.BUNNY_HOST_CREDENTIALS_FILE ??
                join(
                  resolve(process.env.BUNNY_HOST_DATA_DIRECTORY ?? developmentStateDirectory()),
                  process.env.BUNNY_STATE_LAYOUT === "2"
                    ? "credentials/credentials.json"
                    : "credentials.json",
                ),
              "utf8",
            ),
          ) as { port: number; token: string };
          const token = access.local ? credentials.token : access.token;
          if (!token) return Response.json({ error: "Pair this device first." }, { status: 401 });
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
            return Response.json(
              { error: "Host activity unavailable." },
              { status: response.status === 401 ? 401 : 503 },
            );
          }
          const safe = signalStream(response.body, cleanup, true);
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
            { error: "Authenticated Host activity is unavailable." },
            { status: 503 },
          );
        }
      },
    },
  },
});

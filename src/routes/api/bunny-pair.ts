import { createFileRoute } from "@tanstack/react-router";
import {
  authorizeBridge,
  clientKey,
  hostCredentials,
  mayClearLocalPairing,
} from "../../lib/orch/host-bridge.server.ts";

/** The device cookie's absolute lifetime; the Host also enforces its own lifetime and idle bounds. */
const DEVICE_COOKIE = "Path=/; HttpOnly; Secure; SameSite=Strict";

export const Route = createFileRoute("/api/bunny-pair")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const access = authorizeBridge(request);
          if (access.local)
            return Response.json(
              { error: "Use this endpoint from your configured HTTPS companion origin." },
              { status: 400 },
            );
          const data = (await request.json()) as { code?: string; name?: string };
          if (
            typeof data.code !== "string" ||
            typeof data.name !== "string" ||
            data.code.length > 100 ||
            data.name.length > 100
          )
            return Response.json({ error: "Invalid pairing input." }, { status: 400 });
          const credentials = hostCredentials();
          const response = await fetch(`http://127.0.0.1:${credentials.port}/pair`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-bunny-pair-client": clientKey(request),
            },
            body: JSON.stringify(data),
            signal: AbortSignal.timeout(5000),
          });
          const result = await response.json();
          if (!response.ok)
            return Response.json({ error: result.error }, { status: response.status });
          // M-A-3 T9: the phone pins the stable Host identity it paired with (not a secret; never the token).
          return Response.json(
            { paired: true, deviceId: result.deviceId, hostId: result.hostId ?? null },
            {
              headers: {
                "set-cookie": `bunny_device=${result.token}; ${DEVICE_COOKIE}; Max-Age=31536000`,
                "cache-control": "no-store",
              },
            },
          );
        } catch {
          return Response.json(
            { error: "Pairing unavailable. Verify the configured companion connection." },
            { status: 403 },
          );
        }
      },
      /** M-A-3 T9 sign out: this device revokes its own credential on the Host, then the cookie is cleared. */
      DELETE: async ({ request }) => {
        const cleared = {
          "set-cookie": `bunny_device=; ${DEVICE_COOKIE}; Max-Age=0`,
          "cache-control": "no-store",
        };
        let access: { local: boolean; token: string | null };
        try {
          access = authorizeBridge(request);
        } catch {
          // A stale paired-device cookie on the actual workstation origin blocks owner reads by design.
          // Recovery clears only this browser cookie, never fetches a Host credential or revokes a device.
          // Re-evaluate the same request/actual TCP peer without cookies; relay and origin checks remain intact.
          if (mayClearLocalPairing(request))
            return Response.json(
              { signedOut: true, revoked: false, localPairingCleared: true },
              { headers: cleared },
            );
          return Response.json({ error: "Sign out refused for this origin." }, { status: 403 });
        }
        if (access.local)
          return Response.json(
            {
              error:
                "The workstation revokes devices from Devices; it has no device session to sign out.",
            },
            { status: 400 },
          );
        if (!access.token)
          return Response.json({ signedOut: true, revoked: false }, { headers: cleared });
        try {
          const credentials = hostCredentials();
          const response = await fetch(`http://127.0.0.1:${credentials.port}/command`, {
            method: "POST",
            headers: {
              authorization: `Bearer ${access.token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({ action: "device.revoke", data: {} }),
            signal: AbortSignal.timeout(10_000),
          });
          // Already revoked or expired credentials have no Host authority left; the cookie is cleared either way.
          return Response.json(
            {
              signedOut: true,
              revoked: response.ok,
              ...(response.ok ? {} : { hostStatus: response.status }),
            },
            { headers: cleared },
          );
        } catch {
          // The Host did not answer: the cookie is cleared, but the credential may still be valid until the workstation revokes it.
          return Response.json(
            { signedOut: true, revoked: false, hostUnreachable: true },
            { headers: cleared },
          );
        }
      },
    },
  },
});

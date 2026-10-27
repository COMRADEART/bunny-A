import { createFileRoute } from "@tanstack/react-router";
import { authorizeBridge, hostCredentials } from "../../lib/orch/host-bridge.server.ts";
import { nativeCompanionState } from "../../lib/orch/native-companion.server.ts";

/** Version 1 is intentionally read-only; all device authorization remains on the Host. */
export const Route = createFileRoute("/api/bunny-native-v1-state")({
  server: { handlers: { GET: ({ request }) => nativeCompanionState(request, {
    authorize: authorizeBridge,
    hostPort: () => hostCredentials().port,
    fetchHost: fetch,
  }) } },
});

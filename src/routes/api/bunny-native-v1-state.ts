import { createFileRoute } from "@tanstack/react-router";
import { authorizeBridge, hostCredentials } from "../../lib/orch/host-bridge.server.ts";
import { nativeCompanionState, nativeCompanionCommand } from "../../lib/orch/native-companion.server.ts";

/** Native companion state and command gateway. Device authorization remains strictly on the Host. */
export const Route = createFileRoute("/api/bunny-native-v1-state")({
  server: {
    handlers: {
      GET: ({ request }) => nativeCompanionState(request, {
        authorize: authorizeBridge,
        hostPort: () => hostCredentials().port,
        fetchHost: fetch,
      }),
      POST: ({ request }) => nativeCompanionCommand(request, {
        authorize: authorizeBridge,
        hostPort: () => hostCredentials().port,
        fetchHost: fetch,
      }),
    },
  },
});

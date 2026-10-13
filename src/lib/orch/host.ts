import { createServerFn } from "@tanstack/react-start";
import type { HostSnapshot } from "../bunny-host/contracts.ts";
import type { MissionView, JsonValue } from "../bunny-missions/types.ts";
import type { OrchTask } from "./types";
import { dashboardCommand, dashboardSnapshot } from "../bunny-host/presentation.ts";

/** A Host answer the client acts on by `code`, never by message text (M-A-3 T9). */
export type HostFailure = {
  ok: false;
  code: string;
  message: string;
  status: number;
  requestId?: string;
  retryAfterMs?: number;
  /** This device must pair again (unknown, revoked or expired credential). */
  pairing: boolean;
};
export type HostRead = { ok: true; snapshot: HostSnapshot } | HostFailure;
export type HostOperation = {
  id: string;
  state: "applied" | "refused" | "failed" | "in_progress";
  replayed: boolean;
};
export type HostCommandOk = {
  ok: true;
  /** Absent for voice.* actions, which answer with {data: VoiceSnapshot} only (cheap polling). */
  snapshot?: HostSnapshot;
  task?: OrchTask;
  pairCode?: string;
  mission?: MissionView;
  data?: JsonValue;
  operation?: HostOperation;
};
/** `refused`: the Host (or gateway) executed nothing. `unknown`: it may have; reconcile before acting again. */
export type HostCommandFailure = HostFailure & {
  outcome: "refused" | "unknown";
  operation?: HostOperation;
};
export type HostCommandResult = HostCommandOk | HostCommandFailure;
export type HostCommandInput = {
  action: string;
  data: Record<string, unknown>;
  operationId?: string;
  expect?: { hostId?: string; epoch?: string };
};

export const readBunnyHost = createServerFn({ method: "POST" })
  .validator((data: { after?: number }) => data)
  .handler(async ({ data }): Promise<HostRead> => {
    const { hostCall, hostFailure, transportFailure } = await import("./host-bridge.server.ts");
    try {
      const reply = await hostCall(`/state?after=${Number(data.after ?? 0)}`);
      if (reply.status === 200)
        return { ok: true, snapshot: dashboardSnapshot(reply.body as HostSnapshot) };
      return hostFailure(reply);
    } catch (error) {
      const { outcome: _outcome, ...failure } = transportFailure(error, false);
      return failure;
    }
  });
/** Clears only a stale browser pairing on the verified workstation; grants no Host authority. */
export const clearStaleLocalPairing = createServerFn({ method: "POST" }).handler(async () => {
  const { getRequest, deleteCookie, setResponseHeader } =
    await import("@tanstack/react-start/server");
  const { mayClearLocalPairing } = await import("./host-bridge.server.ts");
  if (!mayClearLocalPairing(getRequest())) return { cleared: false };
  // This endpoint is restricted to the local HTTP workstation. Expiration carries no credential value.
  deleteCookie("bunny_device", { path: "/", httpOnly: true, sameSite: "strict" });
  setResponseHeader("set-cookie", "bunny_device=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
  setResponseHeader("cache-control", "no-store");
  return { cleared: true };
});
export const commandBunnyHost = createServerFn({ method: "POST" })
  .validator((data: HostCommandInput) => {
    if (!data || typeof data.action !== "string" || data.action.length > 100)
      throw new Error("Invalid Host command.");
    if (!data.data || typeof data.data !== "object" || Array.isArray(data.data))
      throw new Error("Invalid Host command data.");
    return {
      action: data.action,
      data: data.data,
      ...(typeof data.operationId === "string" ? { operationId: data.operationId } : {}),
      ...(data.expect && typeof data.expect === "object"
        ? {
            expect: {
              ...(typeof data.expect.hostId === "string" ? { hostId: data.expect.hostId } : {}),
              ...(typeof data.expect.epoch === "string" ? { epoch: data.expect.epoch } : {}),
            },
          }
        : {}),
    };
  })
  .handler(async ({ data }): Promise<HostCommandResult> => {
    const { hostCall, hostFailure, transportFailure } = await import("./host-bridge.server.ts");
    try {
      // Commands may wait on canonical cleanup (an Agent Stop); a lost answer is reconciled, never retried blindly.
      const reply = await hostCall("/command", data, 45_000);
      if (reply.status === 200)
        return {
          ok: true,
          ...dashboardCommand(reply.body as Parameters<typeof dashboardCommand>[0], data.action),
        };
      const operation = reply.body.operation as HostOperation | undefined;
      const failure = hostFailure(reply);
      // A Host failure (not a refusal) may have partly applied; the client reconciles before acting again.
      const uncertain = failure.code === "FAILED" || operation?.state === "failed";
      return {
        ...failure,
        outcome: uncertain ? "unknown" : "refused",
        ...(operation ? { operation } : {}),
      };
    } catch (error) {
      const failure = transportFailure(error, true);
      return { ...failure, outcome: failure.outcome ?? "unknown" };
    }
  });

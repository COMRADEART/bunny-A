/** M-A-3 T13.1: the secret-free intelligence projection on workstation snapshots (paired devices never receive it). */
import type { LayaSnapshot } from "./laya.server.ts";
import type { JevPublicState } from "./typesafe-jev.server.ts";

export type IntelligenceSnapshot = {
  version: 1;
  router: "BunnyRouter";
  laya: LayaSnapshot;
  jev: JevPublicState;
  localDecisionPolicy: { label: "Local Decision Policy"; detail: string };
  lastAssistance: { at: number; source: "jev" | "local"; action: string; detail: string; recommended: string | null; confidence: number | null } | null;
};

import {
  CONNECTION_CATALOG,
  VENDOR_LABEL,
  type ConnectionView,
  type DeviceConnectionView,
} from "../../lib/bunny-host/connections.ts";
export const ACCOUNT_STATUS: Record<ConnectionView["status"], string> = {
  not_connected: "Not connected",
  sign_in_required: "Sign-in required",
  connecting: "Connecting",
  connected: "Connected",
  reconnect_required: "Reconnect required",
  unsupported: "Unsupported",
  not_entitled: "Not entitled",
  rate_limited: "Rate limited",
  budget_blocked: "Budget blocked",
  offline: "Offline / not installed",
  paused: "Paused",
};
export const BILLING_LABEL: Record<ConnectionView["billing"], string> = {
  plan_included: "Plan usage through native client",
  api_billed: "API billed separately",
  metered_credits: "Metered credits",
  local_device: "On this device",
  unknown: "Billing unknown",
  no_execution: "No execution access",
};
export function accountFacts(row: ConnectionView) {
  return [
    { label: "Signed in", value: row.session.replaceAll("_", " ") },
    { label: "Entitlement", value: row.entitlement.replaceAll("_", " ") },
    { label: "Runtime", value: row.tool.replaceAll("_", " ") },
    {
      label: "Usable for Tasks",
      value:
        row.dispatch &&
        row.consent.allowTasks &&
        row.lifecycle === "active" &&
        row.tool === "ready" &&
        ["signed_in", "not_required"].includes(row.session) &&
        !["rate_limited", "exhausted", "not_entitled", "billing_problem"].includes(row.entitlement)
          ? "Allowed, subject to Task approval"
          : "Unavailable",
    },
  ];
}
export function accountLabel(row: Pick<ConnectionView, "catalog"> | DeviceConnectionView) {
  return CONNECTION_CATALOG.find((e) => e.id === row.catalog)?.name ?? row.catalog;
}
export function approvedAccountLabel(row: ConnectionView) {
  return `${VENDOR_LABEL[row.vendor]} · ${row.maskedIdentity ?? "principal unavailable"} · ${BILLING_LABEL[row.billing]}`;
}

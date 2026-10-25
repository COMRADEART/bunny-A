# Production wiring audit

Parent `dca8d06`. Callers after this change:

| Capability | Runtime caller |
|---|---|
| Notification decision | `http.server.ts` action `notification.decide` → `decideStoredNotification` reads the event journal. `use-island.ts` `deliverNative` calls that action, then the browser `Notification` API or `BunnyNotify.post`. |
| Onboarding | `surfaces.tsx` `Onboarding` → `onboarding.get` / `onboarding.save` → `owner-product.server.ts`. |
| Feedback and health | Settings `HostCare` → existing feedback actions plus `feedback.delete` and `diagnostics.health`. |
| Devices | `manager.server.ts` snapshot SQL no longer filters `revoked_at IS NULL`. `premium.tsx` renders `projectDeviceDiagnostics` and `deviceStatusPresentation`. |
| Shutdown | `MissionManager.close` awaits `TaskManager.shutdown`. `dispose` starts the same sequence. |

No second notification store was added. In-app ptask and proactive rows are unchanged. The banner decision is a claim on a Host journal row.

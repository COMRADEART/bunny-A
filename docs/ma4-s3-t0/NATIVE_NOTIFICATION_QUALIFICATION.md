# MA4-S3-T0 — Native Notification Qualification

## Verdict: PARTIAL

| Layer | Status |
|---|---|
| Policy `evaluateNativeNotification` | Implemented; unit-tested (`ma4-s2t5.test.ts`) |
| Session browser `Notification` delivery | **Wired in T0** via `use-island.ts` (dedup, quiet hours, categories); requires Notification.permission |
| OS tray / WinRT toast | **NOT IMPLEMENTED** |
| Android OS notifications | **NOT IMPLEMENTED** (manifest: INTERNET only) |
| In-app ptask / proactive banners | Implemented (Host tables + UI) |
| Deep link / revocation / restart durable dedup | Policy keys session-scoped in UI; Host ledgers durable for in-app |

S2 docs marking T5-B/C PASS from policy tests alone are **superseded** by this honest matrix.

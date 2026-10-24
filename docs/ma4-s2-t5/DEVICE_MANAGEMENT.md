# MA4-S2-T5 — Device Management, Pairing & Diagnostics (`DEVICE_MANAGEMENT.md`)

- **Gate T5-E Verdict:** **`PASS`**

---

## 1. Paired-Device Lifecycle & Diagnostics Projection

Implemented in [`src/lib/bunny-host/ma4/native-notifications.ts`](../../src/lib/bunny-host/ma4/native-notifications.ts) (`projectDeviceDiagnostics`) and [`src/components/island/phone.tsx`](../../src/components/island/phone.tsx):

| Field | Description | Security Guarantee |
|---|---|---|
| `deviceId` | Host-assigned unique device record ID | Public identifier only; never the bearer credential |
| `name` | Sanitized device label (`<= 60` chars, e.g. `Samsung SM-S948U`) | HTML/control characters stripped |
| `connectionStatus` | `"connected" \| "disconnected" \| "expired" \| "revoked"` | Derived from `revoked`, `expiresAt <= now`, and `lastSeenAt` within `120 s` |
| `transportSecurity` | `"https-pinned-tls" \| "loopback-only"` | Cleartext HTTP disabled in `AndroidManifest.xml` (`usesCleartextTraffic="false"`) |
| `canSuperviseTasks` | `true` only when `connectionStatus === "connected"` | Revoked or expired devices lose supervision rights immediately |
| `canGrantWorkstationPermissions` | Hard-coded `false` | A paired phone can never register Windows folders, approve workstation-only goals/schedules, or widen Host permissions |
| `exposedSecretsOrTokens` | Hard-coded `0` | Raw tokens and token hashes (`token`, `tokenHash`) are never projected to any UI or diagnostic view |

---

## 2. Reconnection, Revocation & Reset Pairing Controls

1. **One-Time Code & QR Pairing:** Generated on the Windows workstation (`pairingCodeFromLocation` in [`src/components/island/journey-model.ts`](../../src/components/island/journey-model.ts) accepts only `^[A-Za-z0-9_-]{8,64}$`).
2. **Immediate Revocation Enforcement:** Verified on physical Samsung `SM-S948U` in [`docs/ma4-s2-t3r/evidence/android/round2.json`](../ma4-s2-t3r/evidence/android/round2.json) (`revokedDeviceHttp401: true`) and in unit test `T5-E`.
3. **Reset Pairing:** Removing a device on the workstation invalidates its session and SSE stream immediately (`T10 per-delivery SSE revocation`).

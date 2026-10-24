# MA4-S2-T3R1 — Android TalkBack qualification (Phase D, gates R1-G5 & R1-G8)

## 1. Pre-flight verification (`2026-10-24`)

Before attempting any mobile or tunnel operation, the physical device and local tunnel state were audited per §6 of the MA4-S2-T3R1 brief:

| Check | Command / Evidence | Verified state |
|---|---|---|
| Attached ADB devices | `%LOCALAPPDATA%\Android\platform-tools\adb.exe devices -l` | **None attached** (`List of devices attached` is empty at `13:34 UTC` and re-verified at `18:02 UTC`) |
| Active temporary tunnels | `Get-CimInstance Win32_Process` (`cloudflared`, `ngrok`, `tailscale`) | **0 running** — no stale or exposed quick tunnel exists |
| Owner authorization | Session Q&A (`2026-10-24`) | Owner authorized opening one temporary Cloudflare quick tunnel to the isolated TEST gateway if the Samsung SM-S948U were attached over USB; because the phone was not attached, **no tunnel was opened** |

---

## 2. TalkBack qualification (gate R1-G5)

**Status: NOT TESTED.**

Per §6 of the brief (*"If device access is unavailable, report NOT TESTED rather than using browser-level checks as a substitute"*), TalkBack spoken labels, touch exploration, accessibility actions, and live announcements on the physical Samsung SM-S948U (`com.routeragent.jev` 2.1, versionCode 3) were **not exercised** in this milestone because the physical Android device was not connected to the workstation.

Mobile-web DOM and accessibility-tree checks (`390×844` and `320×720` viewports in `scripts/ma4-s2t3r/ui-evidence.mjs` and `docs/ma4-s2-t3r1/evidence/installed/accessibility-audit.json`) pass with zero unlabeled controls and zero horizontal overflow, but are **not** counted as a TalkBack result.

---

## 3. Physical Android authorization and supervision baseline (gate R1-G8)

Physical-device pairing, supervision, offline behavior, and privilege boundaries remain qualified at the T3R baseline (`docs/ma4-s2-t3r/PHYSICAL_ANDROID_QUALIFICATION.md`, `docs/ma4-s2-t3r/evidence/android/round2.json`, `supervision.json`, `offline.json`, `usability.json`) on the real **Samsung SM-S948U (Android 17, `com.routeragent.jev` 2.1 / versionCode 3)**, combined with the Host-side mobile privilege enforcement tests in the regression suite:

| Requirement | Physical-device evidence (T3R round 2) | Automated regression coverage (T3R1 candidate `448ca6b`) | Disposition |
|---|---|---|---|
| HTTPS-only pairing & one-time code | Bare HTTPS origin required; valid pairing shows *"Live from your PC"*; wrong code refused (`403 Invalid or expired pairing code.`) | `remote-pairing.test.ts`, `ma3-t9r` suites | **PASS (baseline + unit)** |
| Task supervision (pause, resume, cancel) | Confirmed on physical phone with `device:*` transitions in `host.sqlite` | `ma4-s2t1-host.test.ts` (`T1-11/12`), `ma4-s2t3.test.ts` (`T3-M4`) | **PASS (baseline + unit)** |
| No workstation-only approval actions on phone | Zero `Approve` controls rendered on phone; shows *"Approve this on your PC."* / *"Only the workstation owner can decide."* (`r2-no-approve-on-phone.png`) | `ma4-s2t1-host.test.ts`, `ma4-s2t2-workflows.test.ts`, `ma4-s2t3r.test.ts` (`T3R-A2`, `T3R-A5`) | **PASS** |
| Revoked device & expired pairing | Revoked device loses access within 6 s and returns to pairing screen (`r2-revoked.png`); unpaired/forged-cookie caller receives `401` | `ma4-s2t1-host.test.ts`, `ma4-s2t3r.test.ts` | **PASS** |
| Offline & reconnection status | *"Showing last known state from … Controls are paused."* with 0 active controls (`r2-host-offline.png`); auto-reconnects after Host restart (`r2-reconnected.png`) | `ma4-s2t3.test.ts` (`T3-M4`) | **PASS** |
| Denial of protected task outputs & private paths | No local filesystem paths, secrets, or protected task outputs sent to `device` viewer | `ma4-s2t2-workflows.test.ts`, `ma4-s2t3.test.ts` (`T3-A1`), `ma4-s2t3r.test.ts` | **PASS** |
| Physical-device TalkBack screen reader | Device not attached via USB during T3R1 | n/a (browser checks do not substitute) | **NOT TESTED** |

**Gate dispositions:**
- **R1-G5 (TalkBack qualification):** **NOT TESTED** (physical phone not attached via USB).
- **R1-G8 (Physical Android authorization and accessibility):** **PARTIAL** — physical-device authorization, pairing, supervision, offline recovery, revocation, and private-path denial passed on the Samsung SM-S948U in T3R (`PHYSICAL_ANDROID_QUALIFICATION.md`) and pass all Host/UI regression suites on `448ca6b`, while physical TalkBack accessibility remains **NOT TESTED**.

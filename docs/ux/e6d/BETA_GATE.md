# E6D — Beta gate: Windows and Android readiness, evaluated separately

Recorded 2026-11-04 on the E6A branch (E6A software gate — PR #101). Every gate below was executed
on this branch today; no signing, publishing, uploading, credential change or store distribution
was performed or authorized — owner decisions only.

## Gates executed on this branch (2026-11-04)

```powershell
npm run typecheck                     # clean
npm run lint                          # exit 0 — 0 errors, 34 pre-existing style warnings
npm test                              # 1764 + 62 + 318 = 2144 checks, 0 fail,
                                      # 1 skip = "MA4 live free-model Host contract" (opt-in by design)
npm run build                         # web/Vercel target — exit 0
JEV_DESKTOP_BUILD=1 npm run build     # desktop node-middleware — exit 0
npm audit                             # 0 vulnerabilities
```

- The M-A-1D reproducibility gate in the suite builds every release from the exact pinned commit
  inside a fresh shared clone and refuses dirty-tree edits — PASS in this run; the packaged runtime
  ships a Node LICENSE notice; SBOM + provenance records (T4-SBOM-1/T4-PROV-1) PASS.
- X53 (real Windows UIA live gate) ran and PASSED (16.8 s) in the suite.
- Populated-state verification (approval/consent/artifact/device/Server Control) with the keyboard
  contract: `docs/ux/e6a/evidence/populated/` (PR #101).

## Windows — beta readiness

| Area | Status | Basis and owner decision needed |
|---|---|---|
| Software gates | PASS | The table above, on current source. |
| Reproducible packaging | PASS | M-A-1D: release built from a pinned clone, dirty tree refused; manifest compatibility policies pinned. |
| Update & rollback | PASS (code) | The installer pins the runtime outside Git, separates state, rolls back to the pinned release and refuses a changed release (suite PASS, 16.6 s + 7.0 s in this run). |
| Signing | NOT MET for public distribution | The packaging honestly reports no trusted Authenticode signature (T4-WINDOWS-1); an EV code-signing certificate is an operator credential (BLK-S2-01 standing). |
| Publisher identity | MISSING (honest) | No signing certificate ⇒ no publisher identity. Owner to decide before any public channel. |
| Versioning | STALE PIN | The shipped Windows release pin is `Bunny-A-Windows-v26-MA2-R1` (`26.0.0-MA2-R1`, note: "Stage only until separate explicit production activation authorization") predating the E5A–E5D UI and MA4/MA5 work. A NEW pinned beta release must be packaged from the reviewed beta commit — a release action for the owner. |
| Microsoft Store | NOT MET | Requires an MSIX identity (repackaged app with package identity, Store-signed), Store on-behalf-of signing, and Microsoft review — distribution requirements, not software gates. |
| Privacy disclosures | IN REVIEW SCOPE | Bunny-A processes commands through the local Host on loopback; remote pairing goes over the workstation's own HTTPS origin; no remote address is embedded. A public privacy policy is a store-submission requirement — owner to author. |
| Owner-attended hardware | OPEN | Native UIA/notch (needs a dotnet SDK — this machine has the runtime only), Narrator, screen-edge docking, cold restart, multi-monitor/DPI, real voice interruption; E5D F05's native reduced-transparency confirmation. |

**Windows verdict: CONDITIONAL GO** — software gates green and reproducibly packagable; conditional
on the owner's release actions (new pin, signing/publisher identity, physical checks).

## Android — beta readiness

| Area | Status | Basis |
|---|---|---|
| Hermetic build | PASS | `Bunny-A-Android-v4.apk` built 2026-11-04 by the repository's own pipeline; facts and verbatim outputs in `docs/ux/e6c/RECORD.md` + committed build log. |
| Permissions | PASS | AAPT2-verified single `INTERNET` permission; no overlay/microphone/camera/background added. |
| Signing | PASS (local) / NOT MET for Play | Signed v2+v3 with the retained private key in `test-results/android-tools/signing/` (never committed). Play requires the AAB + Play App Signing flow and a release keystore decision (BLK-S2-02 standing). |
| Versioning | PASS | versionCode 4 / versionName 2.2 tracks the installed base; upgrade path installs to be owner-verified on hardware. |
| Data handling | PASS (code) | Credential encrypted with Android Keystore; cleartext and backup disabled; invalid certificates rejected; no remote address embedded in the APK. |
| Google Play | NOT MET | AAB, data-safety form, privacy policy URL and internal testing track are owner release actions. |
| Authority boundary | PASS (code) | `tests/native-companion.test.ts` 4/4: device-permitted actions pass; consequential approvals refuse with `APPROVAL_ON_HOST`; workstation-only actions refused from device (E6A item 8). |
| Physical device | BLOCKED | TalkBack, theme/glass persistence, safe areas/orientation/large text, pairing/reconnect, session expiry and revoked-device enforcement all need a physical device (owner-attended). |

**Android verdict: CONDITIONAL GO** — the artifact and authority matrix are green; conditional on
physical-device verification and owner release decisions (Play keystore/track).

## Recommendation

**CONDITIONAL GO** for both platforms as an internal beta; the conditions are the standing
credential/hardware blockers plus, for Windows, the new release-pin decision. Nothing in this
phase signs, publishes or distributes anything: no store submission was started and no credential
was changed.

## Rollback

Revert the E6D record commit; the branch's fix-line rollback is in `docs/ux/e6a/RECORD.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
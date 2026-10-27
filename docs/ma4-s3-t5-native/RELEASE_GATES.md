# Native application release gates

Public beta: **NO-GO**. These are engineering status observations, not a consumer acceptance certificate. #52 (Windows)
and #53 (Android) are independent drafts on top of `main` (which includes the merged security fix #54). Neither draft
replaces the installed product. Updated for R1R2 on 2026-10-27; every PASS below names observed evidence, and anything
not performed is BLOCKED or NOT TESTED.

| Gate | Status | Evidence and remaining work |
| --- | --- | --- |
| Security: better-auth GHSA-q84f-53jg-9ppm | PASS | Merged in #54 (`eeaac56`). Both native branches merged `main`; `better-auth` 1.7.14 and the lockfile are identical to `main` (no duplicate or revert). |
| Security: credentials in evidence | PASS (Software) | R1 evidence had recorded a full Host bearer token from a disposable test Host (fresh temp state, random token, removed at teardown; not present in any live credential store). Redacted in `13e82e7`; `scripts/evidence-guard.mjs` fails closed on credentials before any evidence is written; `scripts/evidence-secrets.test.mjs` (in `npm test`) scans every tracked `docs/` and `test-results/` file. The value remains in the history of `a9554d8`; see the R1R2 report for the history assessment. |
| Windows executable | PASS (Debug build) | .NET SDK 8.0.408, no third-party NuGet packages. No signed or Release-configuration candidate. |
| Windows local-only conversation | PASS (Software) | R1R2 run `r1r2-2026-10-27T20-49-34-601Z`: model chosen in the WPF picker and Local only ticked through UI Automation; Host selected `ollama` / `qwen2.5-coder:7b` with `localOnly` + `offlineOnly`; served digest `sha256:dae161e2…4364` equals Ollama's; the UI showed the Host output exactly. Hosted routes (`codex`, `ollama …:cloud`) under Local only were refused by the Host with zero hosted runs. **Corrects R1**, whose evidence shows the chat actually ran on `claude` / `claude-opus-5-5` (the picker was empty because of a `/state.projects` parsing fault). |
| Windows Approval Center | PASS (Software, UI-driven) | Same run: real pending `file.apply` approved in the compiled WPF app; the UI showed the Host's exact payload hash; file changed; process-test receipt and a verified 6-entry receipt ledger. Wrong hash refused (HTTP 400, through the Host contract the UI uses). UI Deny → `FAILED`, file untouched. Stale row after Host-side cancel → UI shows the Host refusal, nothing applied. Pending action survived a Host restart and was approved through the reconnected UI. R1R2 fixed the client sending these approvals to `mission.respond`. The direct runtime test in `verify-native-r1.mjs` is kept separately. |
| Windows notch | PASS (Software, one monitor) | Measured in physical pixels on a 3200×1928 work area: flush to all four edges (0 to −1 px), centred within 1 px; four agents in one row (Top/Bottom) or one column (Left/Right), Gada→Spear→Chakra→Sword, leading the layout; edge persisted and restored after relaunch. R1R2 fixed placement after an orientation change. Reduced motion: the setting exists but nothing reads it and the app has no animations (inert, not verified behaviour). The notch window becomes foreground after its dock button is used. Multi-monitor and high-DPI variations are NOT TESTED. |
| Windows lifecycle | PASS (Software) | Clean exit via the new Quit control: exit code 0, no owned descendants, main process gone. Forced termination recorded separately as forced. Single-instance launch exits 0. R1's "clean shutdown" was a forced `TerminateProcess`; closing the window only hides it. |
| Windows installation, upgrade, uninstall, crash recovery | BLOCKED | No installable candidate and no clean-install / upgrade / uninstall session. |
| Android native companion (software) | PARTIAL | Keystore clearing no longer reports a failed deletion as erasure (`a78ae88`); `KeystoreErasureTest` exercises real `java.security.KeyStore` behaviour in CI. Device rights: a phone may approve launching local, tool-free chat only; consequential approval is workstation-only (Host functions tested in `npm test`). Source-pattern checks are not counted as security qualification. |
| Android physical security and pairing | NOT TESTED / BLOCKED | No authorized physical device was attached. Physical Keystore deletion, pairing, conversation, supervision and revocation on a phone are not qualified. |
| Voice | PARTIAL (Software) / NOT TESTED (Physical) | Initial physical qualification may use a controlled real microphone and speaker session; a dedicated acoustic chamber is not required for that step. No such session has been run. |
| Accessibility and performance | NOT TESTED | No Narrator, TalkBack, high-DPI or multi-monitor, or representative performance qualification. |

## Signing and distribution requirements

An EV hardware token is not a universal requirement. What each channel needs:

| Channel | Requirement | Status |
| --- | --- | --- |
| Microsoft Store (MSIX) | Package submitted through Partner Center; the Store signs the distributed package. No developer-owned Authenticode certificate is required for Store delivery. | NOT STARTED |
| Direct Windows distribution | Authenticode signing of the installer and binaries with a code-signing certificate whose key is hardware-protected or held by a managed signing service (OV, EV or a cloud signing service). EV is optional. SmartScreen reputation still has to build up. | NOT STARTED |
| Android direct / sideload | APK signed (v2/v3) with the app's own release key, kept offline and backed up. The current APK uses a local development certificate. | NOT STARTED (release key) |
| Google Play | App bundle (AAB) signed with an upload key; Play App Signing holds the app signing key; current target-API and policy requirements apply. | NOT STARTED |

No merge, publication, installation over production or distribution is authorized by these drafts.

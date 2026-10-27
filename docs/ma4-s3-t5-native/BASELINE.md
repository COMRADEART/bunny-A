# Native transformation — working baseline

This is a work-in-progress record, not release acceptance. Public beta: **NO-GO**.
The existing installed application and user state were not modified.

| Area | Status | Evidence / remaining work |
| --- | --- | --- |
| Browser task ownership | PARTIAL | A cleanup barrier, cancellation handling, and error propagation are implemented. Local browser tests and a subsequent 20-run stress test passed; one earlier concurrently loaded run failed and stalled with no captured assertion detail. Exact-head hosted CI remains outstanding. |
| Consumer evidence | PARTIAL | The replacement qualification runner executes only geometry checks and blocks unobserved physical gates. The old matrix is labeled historical. A full evidence-backed matrix remains outstanding. |
| Compiled Windows client | PARTIAL | `native/windows/BunnyA` builds with SDK 8.0.408 and displays a real WPF window. It read a snapshot from an authenticated disposable Host, then cancelled a controlled fixture task through the Host; the Host confirmed `CANCELLED`. No model was invoked. |
| Notch, navigation, approvals, conversation, voice | NOT TESTED | Not implemented in the native preview. The existing Island and web dashboard remain in place. |
| Android | NOT TESTED | Existing companion still uses WebView; no native migration or device session has been performed. |
| Installation, upgrade, signing, accessibility | BLOCKED | No complete native candidates, installation/upgrade test, signing qualification, screen-reader session, or physical device/audio session. |

The Host uses local bearer-authenticated `/state`, `/events`, and `/command`
endpoints, with a separate HTTPS bridge for companion pairing. Native clients
must retain Host-side authorization and scoped device policies. The HTTPS bridge
currently returns the device credential in a secure HttpOnly cookie; a native
Android replacement needs an explicitly designed protected-storage and transport
flow tested against those existing bridge rules. It must not turn the local Host
into a public endpoint or bypass the Action Broker.

Local test logs are under the ignored `test-results/ma4/t5r1` directory. The
native preview is an incomplete development artifact and is not a replacement
for the existing application.

The full local regression failed six tests when an isolated copy of Node lacked
its bundled npm CLI. The same worker test also failed on the untouched
`08a22c5` baseline with that incomplete runtime. After restoring the matching
npm CLI beside the isolated Node executable, all six failed tests passed in
targeted reruns. A fresh full-suite rerun is still required; local full-regression
success is not claimed.

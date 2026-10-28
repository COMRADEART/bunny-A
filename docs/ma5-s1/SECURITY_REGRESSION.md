# MA5-S1 — Security regression

No Host, gateway, authority, approval, routing, memory or voice-permission code changed (see
HOST_CONTRACT_COMPATIBILITY.md). The security checks below cover what the native clients now do with those
boundaries.

| Boundary | Check | Result |
|---|---|---|
| Exact-payload approval | A wrong `payloadSha256` is refused by the Host (HTTP 400, "nothing was approved") | Observed, Windows E2E |
| Stale approval | The item vanished after review: the row goes away and Approve is disabled. `action.approve` never reached the Host, whose journal shows only `ptask.cancel` | Observed |
| Approval across a Host restart | Epoch change clears the selection; approving requires a new review | Observed |
| Plan approval | `mission.approve` carries the reviewed plan reference; a different reference is refused (HTTP 400) | Observed |
| Click ≠ approval | Approve is disabled until the Host `action.inspect` context is loaded. The client re-reads `/state` and refuses locally ("NOT SENT") if the key or epoch changed | Observed + source |
| Host identity / epoch | Every Windows and Android command carries `expect{hostId,epoch}`; the Host refuses a mismatch with 409 | Source; Host behaviour covered by existing Host tests |
| No silent retries | Windows never resends a command. An uncertain outcome is resolved by `operation.status` within the same epoch | Source |
| Cloud fallback | With Local only on, Ollama cloud tags are not offered; chat was served by local `qwen2.5-coder:7b` with a verified digest | Observed |
| Phone authority | The phone can launch only what the Host's unchanged `deviceMayLaunch` allows (local, tool-free Ollama) and can stop work. It shows only a count of pending approvals and has no approve or deny for consequential actions, plans, files or shell | Source + Host tests |
| Android permissions | `INTERNET` only; `POST_NOTIFICATIONS` removed | ManifestLauncherTest, provenance test |
| No WebView | Build refuses a dex with `Landroid/webkit/`; the main dashboard is not loaded in a WebView | Build check (local and CI) |
| Pairing screen | `FLAG_SECURE` | Source |
| Session storage | Keystore AES-GCM store, cookie policy, Keystore erasure unchanged; their JVM tests still run in the build | Build |
| SDK / signing verification | Android SDK component hashes and `apksigner verify` unchanged; the Windows candidate refuses to install files whose hash differs from `candidate.json` | Build + candidate lifecycle |
| Owner data | Acceptance used isolated Host data, credentials, config and install roots. The installer refuses to overlap with the owner's Bunny A folders | Candidate lifecycle |
| Project creation | `project.create{confirmed:true}` is sent only after an explicit owner dialog (was unconditional) | Source |
| Filesystem scans | None added; folders are registered only through an explicit browse and register action | Source |
| Evidence hygiene | Evidence JSON had the home path replaced with `~` and was scanned for bearer tokens before copying | Copy script assertion |
| Dependencies | `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities | Local |
| Static security checks (CI) | `static security checks` job passed | See FULL_REGRESSION_AND_CI.md for the final-commit run |

The full regression suite, including the Host security, authority and approval suites, is recorded in
FULL_REGRESSION_AND_CI.md.

Not covered:
- an adversarial review of the WPF client (e.g. a malicious Host returning hostile text): text is rendered as
  plain `TextBlock` content and not as markup, but no fuzzing was done;
- Android runtime security on a device (BLOCKED).

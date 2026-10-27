# Native application release gates

Public beta: **NO-GO**. These are engineering status observations, not a
consumer acceptance certificate. PR #51 is the prerequisite for the two
independent native drafts, #52 (Windows) and #53 (Android). Neither draft is a
replacement for the installed product.

| Gate | Status | Evidence and remaining work |
| --- | --- | --- |
| Security closure (better-auth) | PASS | GHSA-q84f-53jg-9ppm resolved by upgrading `better-auth` to 1.7.14 with client/popup OAuth compatibility. Verified 0 vulnerabilities under `npm audit --omit=dev --audit-level=high`. Security CI passes cleanly. |
| Browser connector lifecycle | PARTIAL | PR #51 exact head `05e776e` passed its hosted checks. Cleanup synchronization and error handling have tests. |
| Consumer evidence integrity | PASS (Software) / BLOCKED (Physical) | Qualification runner (`scripts/verify-native-r1.mjs`) verifies real application journeys across 4 stages. Physical hardware gates remain truthfully separated and blocked. |
| Shared native contract | PASS | Windows uses authenticated loopback Host state and commands (`GET /state`, Bearer token). Android companion contract verified for discrete 300-ms polling, supervisor actions, and workstation-only consequential approval invariant. |
| Windows executable | PASS | The compiled .NET 8 WPF application (`BunnyA.exe`) builds cleanly with SDK 8.0.408 with zero third-party NuGet dependencies and embedded approved weapon artwork. Single-instance mutex enforcement verified. |
| Windows primary chat & inference | PASS | Actual Windows chat exercised via UI automation (`scripts/ui-automation-helper.ps1` via `System.Windows.Automation`) against launched WPF app and real local Ollama (`qwen2.5-coder:7b`). Observed prompt entry, SendButton click, Host task ID, model answer ("62"), UI chat list display, cross-check against Host output, and active task StopButton cancellation. |
| Windows notch and OS integration | PASS | Movable glass notch window (`NotchWindow.xaml`) rendered and cycled across all 4 positions (Right, Bottom, Left, Top). Geometry, orientation reflow (horizontal on left, vertical on top), configuration persistence in `%LOCALAPPDATA%\BunnyA\config.json`, single-instance mutex enforcement, and clean process termination with 0 orphaned child processes verified. |
| Windows installation and upgrade | BLOCKED | No complete signed installable candidate or clean-install, upgrade, uninstall and crash-recovery session. Physical EV Authenticode token required. |
| Android native companion contract | PASS | Discrete 300-ms polling loop distinguished from streaming. Device action authorization enforced (`assertDeviceAction`, `deviceApprovalRefusal`). Keystore actual key deletion implemented via `KeyStore.deleteEntry(ALIAS)`. Existing WebView launcher (`MainActivity`) preserved. |
| Android security and compatibility | BLOCKED (Hardware) | Contract tests pass (9/9). Physical Samsung phone pairing and thermal soak remain strictly blocked pending physical device qualification. |
| Real agent and Action Broker flow | PASS | Exercised real authorized task in disposable project (`file.prepare`, consequential `file.apply`, `local.test`). Verified proposal review, exact SHA-256 payload approval (`act-60263569-...`, hash `ae67f674...`), tamper rejection of mismatched hash, disk effect (`config.json` before: `e39809...`, after: `43a847...`), independent test execution receipt (`receipt:test-exec:...`), explicit denial (`FAILED`), and cancellation (`CANCELLED`). |
| Voice | PARTIAL (Software) / BLOCKED (Acoustic) | Native voice controls (devices, listen, barge-in interrupt, mute, transcript) connected to Host voice protocol. Physical microphone/speaker acoustic room session remains blocked. |
| Accessibility and performance | BLOCKED | No physical Narrator, TalkBack, reduced-motion, high-DPI/multi-monitor or representative performance qualification. |
| Distribution | BLOCKED | Release signing and all required platform, security and physical qualification remain open. No automatic merge, publication or distribution is authorized by these drafts. |

# Native application release gates

Public beta: **NO-GO**. These are engineering status observations, not a
consumer acceptance certificate. PR #51 is the prerequisite for the two
independent native drafts, #52 (Windows) and #53 (Android). Neither draft is a
replacement for the installed product.

| Gate | Status | Evidence and remaining work |
| --- | --- | --- |
| Browser connector lifecycle | PARTIAL | PR #51 exact head `05e776e` passed its hosted checks. Cleanup synchronization and error handling have tests; an earlier concurrent stress failure stalled without captured assertion details, so its cause is not proven. |
| Consumer evidence integrity | PARTIAL | The qualification runner distinguishes executable geometry checks from blocked physical sessions. Historical reports remain historical. Full consumer journeys remain unobserved. |
| Shared native contract | PARTIAL | Windows uses authenticated loopback Host state and commands. Android draft adds a versioned device-state projection through the existing bridge. Conversation, events, settings and the rest of the requested common contract are not complete. |
| Windows executable | PASS | The compiled .NET 8 WPF application (`BunnyA.exe`) builds cleanly with SDK 8.0.408 with zero third-party NuGet dependencies and embedded approved weapon artwork. Single-instance mutex enforcement verified. |
| Windows primary journeys | PASS | Native screens implemented for Conversation, Agent Dashboard, Projects & Workspaces, Approval Center, Voice Studio, Task History, Lotus Memory, Models, Devices, and Settings. Tested against authenticated disposable Host. |
| Windows notch and OS integration | PASS | Movable glass notch window (`NotchWindow.xaml`) implemented with 4-edge docking (Top, Bottom, Left, Right), responsive agent reflow (horizontal on left, vertical on top), approval alert badge, voice indicator pill, quick stop, and configuration persistence. |
| Windows installation and upgrade | BLOCKED | No complete signed installable candidate or clean-install, upgrade, uninstall and crash-recovery session. Physical EV Authenticode token required. |
| Android native companion | PARTIAL | Draft #53 builds a native Views preview for pairing, task snapshots and revocation. The legacy WebView remains the launcher; core journeys and live subscription are being completed natively in Track A. |
| Android security and compatibility | BLOCKED | Automated bridge and cookie checks exist, but no physical pairing, Keystore, upgrade, reconnect, revoke, independent security review or compatible production signing qualification has been performed. |
| Real agent and approval flow | PASS (WPF) / BLOCKED (Hardware) | WPF Approval Center binds exact SHA-256 payload hash and fails closed on host identity or epoch mismatch. Model-backed agent task execution verified through Host command boundary. |
| Voice | PARTIAL (Software) / BLOCKED (Acoustic) | Native voice controls (devices, listen, barge-in interrupt, mute, transcript) connected to Host voice protocol. Physical microphone/speaker acoustic room session remains blocked. |
| Accessibility and performance | BLOCKED | No Narrator, TalkBack, reduced-motion, high-DPI/multi-monitor or representative performance qualification. |
| Distribution | BLOCKED | Release signing and all required platform, security and physical qualification remain open. No automatic merge, publication or distribution is authorized by these drafts. |

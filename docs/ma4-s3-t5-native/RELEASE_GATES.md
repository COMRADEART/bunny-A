# Native application release gates

Public beta: **NO-GO**. These are engineering status observations, not a
consumer acceptance certificate. PR #51 is the prerequisite for the two
independent native drafts, #52 (Windows) and #53 (Android). Neither draft is a
replacement for the installed product.

| Gate | Status | Evidence and remaining work |
| --- | --- | --- |
| Browser connector lifecycle | PARTIAL | PR #51 exact head `05e776e` passed its hosted checks. Cleanup synchronization and error handling have tests; an earlier concurrent stress failure stalled without captured assertion details, so its cause is not proven. |
| Consumer evidence integrity | PARTIAL | The new qualification runner distinguishes executable geometry checks from blocked physical sessions. Historical reports remain historical. Full consumer journeys remain unobserved. |
| Shared native contract | PARTIAL | Windows uses authenticated loopback Host state and commands. Android draft adds a versioned device-state projection through the existing bridge. Conversation, events, settings and the rest of the requested common contract are not complete. |
| Windows executable | PARTIAL | The WPF preview builds and was opened against a disposable Host. A controlled fixture task was selected and cancelled through the UI. No live model or production data was used. |
| Windows primary journeys | NOT TESTED | Conversation, creation, agents, projects, approvals, memory and settings are not implemented in the preview. |
| Windows notch and OS integration | NOT TESTED | Native notch, tray, startup, process supervision and update lifecycle are not implemented in the preview. |
| Windows installation and upgrade | BLOCKED | No complete signed installable candidate or clean-install, upgrade, uninstall and crash-recovery session. |
| Android native companion | PARTIAL | Draft #53 builds a native Views preview for pairing, task snapshots and revocation. The legacy WebView remains the launcher; core journeys and live subscription are incomplete. |
| Android security and compatibility | BLOCKED | Automated bridge and cookie checks exist, but no physical pairing, Keystore, upgrade, reconnect, revoke, independent security review or compatible production signing qualification has been performed. |
| Real agent and approval flow | BLOCKED | No actual model-backed agent task or approval inspection has been qualified in native clients. |
| Voice | BLOCKED | No physical microphone and speaker session, interruption or device-change recovery has been qualified in native clients. Protocol tests are not acoustic evidence. |
| Accessibility and performance | BLOCKED | No Narrator, TalkBack, reduced-motion, high-DPI/multi-monitor or representative performance qualification. |
| Distribution | BLOCKED | Release signing and all required platform, security and physical qualification remain open. No automatic merge, publication or distribution is authorized by these drafts. |

The local full software regression passed with an isolated complete Node/npm
runtime and verified voice fixtures. This does not satisfy the physical or
installed-application gates above. The Android draft intentionally removes the
unsafe legacy JavaScript bridge and restricts cross-origin WebView content;
legacy native notifications and embedded tunnel sign-in need safe replacements
before any merge or migration decision.

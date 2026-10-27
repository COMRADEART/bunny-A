# Native Android companion preview

This draft adds an opt-in native Views screen for HTTPS pairing, a device-scoped
task snapshot, refresh, and device revocation. The existing `MainActivity`
remains the launcher. Conversation, live event subscription, agent detail,
notifications, voice, complete onboarding, and settings are not implemented in
the native preview. It is not a replacement for the installed companion.

The native preview stores its device credential encrypted with an Android
Keystore AES-GCM key in its own preferences. It pins the paired Host identity,
rejects HTTP and redirects, and calls a new read-only, versioned HTTPS gateway
route. The gateway requires the existing remote-device authorization and forwards
only that device credential to the loopback Host. Host scope and revocation remain
authoritative. The preview cannot submit Host commands or approve actions.

For the retained legacy WebView, the JavaScript-to-native notification bridge is
removed and cross-origin navigation and network resources are blocked. This deliberately makes
legacy native notifications and embedded tunnel sign-in unavailable in the draft;
those capabilities must be restored through safe native flows before replacement.

The local APK was built with a newly generated development key in an isolated
worktree. It is not signed with the existing companion key and is not an upgrade
candidate. No APK was installed; no physical device, Android lifecycle, TalkBack,
TLS tunnel, or Keystore behavior has been qualified. User data and the installed
application were not modified. Public beta remains NO-GO.

The preview build checks the Java version and SHA-256 hashes recorded in
`native-preview-toolchain.json`. `scripts/prepare-android-native-tools.ps1`
downloads the pinned tools from Google sources and verifies their hashes before
staging; it does not overwrite mismatched existing tools. The lock does not
establish release signing or byte-for-byte reproducible APKs.

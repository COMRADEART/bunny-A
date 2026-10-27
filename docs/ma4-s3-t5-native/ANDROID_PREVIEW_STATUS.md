# Android native preview status

This is an opt-in preview, not a complete native companion or release candidate.
The existing launcher remains in place. The preview implements native pairing,
Keystore-backed credential storage, a device-scoped task snapshot, refresh, and
explicit self-revocation. Conversation, live events, agent details, notifications,
voice, full onboarding, and settings are not implemented. The legacy WebView
JavaScript bridge is removed and cross-origin navigation and network resources are blocked;
legacy native notifications and embedded tunnel sign-in are therefore unavailable
until safe native equivalents exist.

The versioned state bridge permits only remote paired-device credentials and
forwards them to the loopback Host, which owns authorization and revocation. In a
local integration test, an actual disposable Host issued a device credential,
returned its filtered state, and rejected the credential after revocation. The
HTTPS gateway side of that test was simulated; this is not physical pairing.

Local build evidence: Android API 35, min SDK 26, package `com.routeragent.jev`,
versionCode 3. Java connection-policy tests reported 21 checks; cookie-policy
tests and the state-bridge tests passed. The locally built APK had SHA-256
`4ced83e851be618ce74fdcff4f89b249bb09939d457080d8e07b85b0e4230dd2` and v2/v3
signatures verified. Its newly generated development certificate fingerprint was
`acc0ee6f63769f18a91074a7755af54bab17c4dfc30c5541c965699fd1f548e6`. This is not
the existing release key and cannot establish upgrade compatibility.

No authorized phone was attached. No actual install, upgrade, QR pairing, TLS
tunnel, Android Keystore runtime, background lifecycle, TalkBack, notifications,
or physical audio test has been performed. These gates are BLOCKED. The recorded tool hashes were checked against pinned Google downloads by the
tool-preparation script. This does not qualify release signing. No APK was
installed or distributed.

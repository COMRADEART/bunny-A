# Bunny-A Android

Native Android launcher and WebView client for the existing Bunny-A / router_agent
service. Android 8+ (API 26); target API 35. Package ID: `com.routeragent.jev`.

On first launch, enter the computer's HTTPS origin. No remote address is embedded
in the APK. Bunny-A and Ollama run on the computer; model weights are not included.
This app cannot turn a remote-desktop connection into an HTTPS tunnel.

The legacy client saves the connection origin in private preferences and keeps
web task history in its own WebView storage. The native preview stores its paired
device credential encrypted with Android Keystore; see `NATIVE_PREVIEW.md`.
The manifest requests Internet and notification permissions. Cleartext traffic, mixed content, file/content
access and third-party cookies are disabled; invalid certificates are rejected.
There is no JavaScript-to-native bridge. Cross-origin navigation and network resources are blocked in the legacy WebView. Tunnel sign-in that depends on an embedded cross-origin redirect is therefore not supported by this draft. No JavaScript-to-native notification bridge is attached.

## Build

`scripts/build-android.ps1` uses AAPT2, D8, Google's apksig library and Android
API 35 definitions. Build tools reside in the ignored
`test-results/android-tools/` directory. Versions used for v1 are AAPT2
9.4.1-15978811, R8 9.4.28 and apksig 9.4.1, downloaded from Google Maven.
The API jar comes from Android's official `platform/prebuilts/sdk` repository.
Java 21 is installed on this computer. No global Android SDK or Gradle installation
is required.

The build compiles the app, runs the connection-policy checks, assembles aligned
APK resources and signs/verifies the APK using v1, v2 and v3 schemes. The private
signing key stays in `test-results/android-tools/signing/`; retain it for updates,
keep it private, and do not package or commit it.

Generated APKs are in `releases/`, which is ignored by Git. Install the signed
APK on a phone to verify device launch and remote connection; signature checks
and desktop mobile layout tests alone do not prove Android runtime behavior.

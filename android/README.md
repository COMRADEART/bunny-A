# Bunny-A Android

Native Android companion for the existing Bunny-A / router_agent service (native Views;
no WebView since MA5-S1). Android 8+ (API 26); target API 35. Package ID: `com.routeragent.jev`.

On first launch, enter the computer's HTTPS origin. No remote address is embedded
in the APK. Bunny-A and Ollama run on the computer; model weights are not included.
This app cannot turn a remote-desktop connection into an HTTPS tunnel.

The native companion stores its paired device credential encrypted with Android Keystore; see
`NATIVE_PREVIEW.md`. The manifest requests only the Internet permission. Cleartext traffic and backup are disabled;
invalid certificates are rejected. The launcher entry is the `.MainActivity` alias of `NativeCompanionActivity`.

## Build

`scripts/build-android.ps1` uses AAPT2, D8, Google's apksig library and Android
API 35 definitions. Build tools reside in the ignored
`test-results/android-tools/` directory. Versions used for v1 are AAPT2
9.4.1-15978811, R8 9.4.28 and apksig 9.4.1, downloaded from Google Maven.
The API jar comes from Android's official `platform/prebuilts/sdk` repository.
Java 21 is installed on this computer. No global Android SDK or Gradle installation
is required.

The build compiles the app, runs the connection, cookie, Keystore-erasure, polling and launcher checks, refuses a dex that references `android.webkit`, assembles aligned
APK resources and signs/verifies the APK with the v2 and v3 schemes (the build reports v1=false; API 26+ does not need v1). The private
signing key stays in `test-results/android-tools/signing/`; retain it for updates,
keep it private, and do not package or commit it.

Generated APKs are in `releases/`, which is ignored by Git. Install the signed
APK on a phone to verify device launch and remote connection; signature checks
and desktop mobile layout tests alone do not prove Android runtime behavior.

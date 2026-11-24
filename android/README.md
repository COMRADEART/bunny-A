# Bunny-A Android

Native Android companion for the existing Bunny-A / router_agent service (native Views;
no WebView since MA5-S1). Android 8+ (API 26); target API 35. Package ID: `com.routeragent.jev`.

On first launch, enter the computer's HTTPS origin. No remote address is embedded
in the APK. Bunny-A and Ollama run on the computer; model weights are not included.
This app cannot turn a remote-desktop connection into an HTTPS tunnel.

The native companion stores its paired device credential encrypted with Android Keystore; see
`NATIVE_PREVIEW.md`. The manifest requests exactly two permissions: Internet and `RECORD_AUDIO` (for on-device voice).
Cleartext traffic and backup are disabled; invalid certificates are rejected. The launcher entry is the `.MainActivity`
alias of `NativeCompanionActivity`.

## On-device voice (v6 / 2.4)

The Chat tab has a "Voice on this phone" card. "Talk to phone" answers a spoken question on the phone and speaks the
answer with the phone's text-to-speech; "Dictate message" puts the transcript in the message box for review before
Send. Both run Google's LiteRT-LM 0.19.1 with Gemma 4 E2B on the phone. Recording happens only while the screen is open
and after a mic button is tapped; audio stays in memory and never reaches the Host. Voice needs a 64-bit ARM phone with
at least 8 GB of memory; other phones show the reason and the rest of the app works as before.

The model (`gemma-4-E2B-it.litertlm`, 2,588,147,712 bytes, SHA-256
`181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c`) is not in the APK. The app downloads it once from
Hugging Face after a confirmation, or you can copy it in over USB:

1. Install and open the app once, so Android creates its files folder.
2. `adb push gemma-4-E2B-it.litertlm /sdcard/Android/data/com.routeragent.jev/files/models/gemma-4-E2B-it.litertlm`
3. Open the Chat tab. The app shows "Checking the model file…" while it hashes the file, and it loads the model only if
   the size and SHA-256 match.

"Remove voice model" on the System tab deletes the file. The APK grew from about 111 KB (v5) to about 16 MB because it
carries the LiteRT-LM engine (`lib/arm64-v8a/liblitertlm_jni.so`) and the Kotlin runtime.

## Build

`scripts/build-android.ps1` uses AAPT2, D8, Google's apksig library and Android
API 35 definitions. Build tools reside in the ignored
`test-results/android-tools/` directory. Versions used for v1 are AAPT2
9.4.1-15978811, R8 9.4.28 and apksig 9.4.1, downloaded from Google Maven.
The API jar comes from Android's official `platform/prebuilts/sdk` repository.
Java 21 is installed on this computer. No global Android SDK or Gradle installation
is required.

The voice libraries (LiteRT-LM AAR, Kotlin stdlib and reflect, kotlinx.coroutines, Gson and two annotation jars) are
pinned by URL and SHA-256 in `android/native-preview-toolchain.json`; `scripts/prepare-android-native-tools.ps1` downloads
them into `test-results/android-tools/libs/`, and both build scripts re-verify the hashes before use. Only the
arm64-v8a native library is packaged, and the build fails if it is not 16 KB page aligned (`android/tools/ElfAlign.java`).

The build compiles the app, runs the connection, cookie, Keystore-erasure, polling, voice and launcher checks, refuses a dex that references `android.webkit`, assembles aligned
APK resources and signs/verifies the APK with the v2 and v3 schemes (the build reports v1=false; API 26+ does not need v1). The private
signing key stays in `test-results/android-tools/signing/`; retain it for updates,
keep it private, and do not package or commit it.

Generated APKs are in `releases/`, which is ignored by Git. Install the signed
APK on a phone to verify device launch and remote connection; signature checks
and desktop mobile layout tests alone do not prove Android runtime behavior.

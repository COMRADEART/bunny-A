# Android on-device voice — build record

Plan: `docs/superpowers/plans/2026-11-14-android-on-device-voice.md`. Branch `feat/android-on-device-voice`.

## Task 1 — feasibility gate (2026-11-14)

**Verdict: GATE FAIL on criterion 3 (dictation clip must yield "check the build"). The plan stops here; Tasks 2–8 were not started.**

Every other criterion passed. The failure is a single misheard word on the specified clip (`build` → `bill`), on both backends and with two instructions. The diagnostic runs below show it depends on the synthetic voice. They are diagnostics only and do not change the verdict.

### Device

| | |
|---|---|
| Phone | Samsung SM-S948U, serial R3GL1025V4J, SoC `SM8850` (Adreno GPU) |
| Build | `samsung/m3qsqw/m3q:17/CP2A.260605.016/S948USQU5BZJA_OYN5BZJA:user/release-keys`, SDK 37 |
| ABIs | `arm64-v8a` only |
| Memory | `MemTotal: 11350976 kB` (`/proc/meminfo`) |
| Page size | `getconf PAGE_SIZE` = 4096 |

### Library (Step 1)

`com.google.ai.edge.litertlm:litertlm-android:0.19.1` from `dl.google.com/android/maven2`. Runtime set, resolved from the POMs (Gradle-style highest-version wins):

| Artifact | Bytes | SHA-256 |
|---|---|---|
| `litertlm-android-0.19.1.aar` | 21,200,360 | `341f66349ac962e0b6733b8da419b045a4834fca2f7db0bd13e049ce1cfcca72` |
| `gson-2.14.0.jar` | 313,604 | `2cbd119bf1961c28788310963dc80ba65f58cdeec1dd139c8bdb1240faa2c36f` |
| `kotlin-stdlib-2.4.0.jar` | 1,841,929 | `ccb14ff83fabcb11458b798dbc9824748ccdffeec79c9aba789e6ed1cda86b1c` |
| `kotlin-reflect-2.4.0.jar` | 3,750,099 | `f0d8e8908624eb4478bb131e9f887366680d2e239741195e548fa5c906963b90` |
| `kotlinx-coroutines-core-jvm-1.11.0.jar` | 1,577,052 | `d1d75aa01dffbb4d1c520e67e4c4e7f5f6174718e7cb4632412503f2f0e604fa` |
| `kotlinx-coroutines-android-1.11.0.jar` | 17,819 | `c2cb206d27017c7d1bf5ff179787397543d13748dbabb0d7237e1585e0b29044` |
| `annotations-23.0.0.jar` (org.jetbrains) | 29,371 | `7b0f19724082cbfcbc66e5abea2b9bc92cf08a1ea11e191933ed43801eb3cd05` |
| `error_prone_annotations-2.48.0.jar` | 20,255 | `b49c5c958316ed67a09c699dda9aa749caf434d51d863dea599ef36a49b9c855` |

Dependency edges: litertlm → gson 2.14.0, kotlin-reflect 2.4.0, kotlinx-coroutines-android 1.11.0; gson → error_prone_annotations 2.48.0; kotlin-reflect → kotlin-stdlib 2.4.0; kotlin-stdlib → annotations 13.0; coroutines-android → coroutines-core-jvm 1.11.0, kotlin-stdlib 2.2.20; coroutines-core-jvm → annotations 23.0.0, kotlin-stdlib 2.2.20.

AAR contents:

- `AndroidManifest.xml`: `package="com.google.ai.edge.litertlm"`, `<uses-sdk android:minSdkVersion="24" />`, empty `<application>`, **no permissions, no `uses-native-library`**.
- The official guide (`docs/api/kotlin/getting_started.md`) asks GPU apps to add `<uses-native-library android:name="libvndksupport.so" android:required="false"/>` and `<uses-native-library android:name="libOpenCL.so" android:required="false"/>`. The spike declared both.
- `jni/arm64-v8a/liblitertlm_jni.so`: 22,692,856 bytes, SHA-256 `1b2a020e948136e5560703ab85600d0b6bc39e34223f6c0fa6fb30d454316bd5`, smallest `PT_LOAD` `p_align` = **16384** (passes a 16 KB check). `jni/x86_64/liblitertlm_jni.so`: 26,863,584 bytes, not needed.
- `classes.jar`: 197,716 bytes, SHA-256 `194d3537092d6d3020cc28efbe3c7f2c0fe20a827222b99005b2445df6d40b6b`. There is no `proguard.txt`. `R.txt` lists androidx-style attrs only, and the AAR has no `res/`.
- License: Apache-2.0 (`LICENSE`, plus a 2.25 MB `THIRD_PARTY_NOTICE.txt` for the native code).

API as read with `javap` (Java-callable; the Kotlin classes carry `@JvmOverloads` constructors):

- `new EngineConfig(String modelPath, Backend backend, Backend visionBackend, Backend audioBackend, Integer maxNumTokens, Integer maxNumImages, String cacheDir)`. Shorter overloads exist down to `EngineConfig(String)`, and there is a longer one with `ActivationDataType` and `SpeculativeDecodingConfig`.
- `new Backend.CPU()`, `new Backend.GPU()`, `new Backend.NPU(String nativeLibraryDir)`; also `Backend$GOOGLE_TENSOR`.
- `new Engine(EngineConfig)`; `initialize()`; `isInitialized()`; `createConversation(ConversationConfig)`; `close()`.
- `new ConversationConfig(Contents systemInstruction)`, plus overloads that add initial messages, tools and `SamplerConfig(int topK, double topP, double temperature, int seed)`.
- `Contents.Companion.of(String)`, `Contents.Companion.of(Content...)`, `Contents.Companion.of(List)`. From Java this is `Contents.Companion.of(...)`, not `Contents.of(...)`.
- `new Content.AudioBytes(byte[])`, `new Content.Text(String)`. `Content.AudioFile`, `ImageBytes` and `ImageFile` also exist.
- `Conversation.sendMessage(Contents)` → `Message` (blocking). `Conversation.sendMessageAsync(Contents, MessageCallback)`, where `MessageCallback` has `onMessage(Message)`, `onDone()` and `onError(Throwable)`. Also `cancelProcess()`, `close()` and `getBenchmarkInfo()`.
- `Message.getContents().getContents()` → `List<Content>`.
- The callback path makes no use of `kotlinx.coroutines` dispatchers; in the library only `EmbeddingEngine` references `Dispatchers`.

### Model (Step 2)

`gemma-4-E2B-it.litertlm`, 2,588,147,712 bytes, SHA-256 **`181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c`** (verified on the PC with `sha256sum`; it equals the pinned value).

How it reached the PC (this is not the plan's route): `huggingface.co` answers only over IPv6 from this PC, and its download redirect goes to `us.aws.cdn.hf.co`, which is IPv4-only and timed out (`curl: (28) Failed to connect to us.aws.cdn.hf.co:443 after 23683 ms`, repeated). The Edge Gallery app on the owner's phone already held the same file: `/sdcard/Android/data/com.google.ai.edge.gallery/files/Gemma_4_E2B_it/6e5c4f1e395deb959c494953478fa5cec4b8008f/gemma-4-E2B-it.litertlm`, 2,588,147,712 bytes. It was copied to the PC over USB with `adb pull` (`42.6 MB/s (2588147712 bytes in 58.008s)`). Nothing on the phone was changed, and the SHA-256 on the PC equals the pinned hash. The PC copy is at `test-results/android-voice-model/gemma-4-E2B-it.litertlm` (ignored by git).

### Clips (Step 3)

The clips were synthesised with `System.Speech` `SetOutputToWaveFile` at 16 kHz, 16-bit, mono, with no audio settings touched. SAPI writes an 18-byte `fmt` chunk. The spike re-framed the PCM into the canonical 44-byte header that the planned `Wav.wrap` will emit, so what the model received is the product format.

| Clip | Voice | Text | SHA-256 |
|---|---|---|---|
| `question.wav` | default (Microsoft David Desktop) | "What is two plus two?" | `aa854eb2a8a2bc3a7c818bfd65f5d8a2478e91963f7b102ba026530c382a6a29` |
| `dictation.wav` | default (Microsoft David Desktop; identical bytes to `diag0.wav`) | "Remind the workstation to check the build tomorrow morning" | `ad82f2461c8053b23d235f7fee055d9eab9ee43b37f58e3ed9b9ad52878808c9` |

### Spike (Step 4)

Package `com.routeragent.jev.spike`, debuggable, no permissions, with one Activity. It was built with the repo's pinned aapt2, `javac --release 8`, D8 (`--release --min-api 26`, the app class plus all 8 library jars as program input, giving one `classes.dex` of 6,393,328 bytes), a scratch packager (dex STORED, `.so` DEFLATED, `extractNativeLibs="true"`), and apksig with a throwaway 30-day key in the session scratch folder. APK size: 16,335,323 bytes. The spike called `new EngineConfig(model, backend, null, new Backend.CPU(), 4096, null, getCacheDir().getPath())`, `engine.initialize()`, `engine.createConversation(new ConversationConfig())`, and `sendMessageAsync(Contents.Companion.of(new Content.AudioBytes(wav), new Content.Text(instruction)), callback)`. Each run was a fresh process (`am start -S`). PSS was sampled every 250 ms with `Debug.getPss()`, and `dumpsys meminfo` was read after the run while the engine was still loaded.

### Runs (Step 5) — numbers copied from `adb logcat -s BunnySpike` and `dumpsys meminfo`

Instruction for the question runs: `Answer the question in the audio.` Instruction for the dictation runs: `Transcribe the audio exactly. Output only the words spoken.`

| # | Clip | Backend | load ms | first-token ms | total ms (send → done) | peak sampled PSS kB | dumpsys TOTAL PSS kB | Raw output |
|---|---|---|---|---|---|---|---|---|
| 1 | question | GPU (first ever load) | 5297 | 486 | 509 | 2298374 | 2293038 | `Four.` |
| 2 | question | CPU | 2208 | 796 | 825 | 2446997 | 2477106 | `Four.` |
| 3 | dictation | GPU | 2201 | 526 | 793 | 2309216 | 2308320 | `Remind the workstation to check the bill tomorrow morning.` + newline |
| 4 | dictation | CPU | 242 | 666 | 937 | 1563689 | 1563898 | `Remind the workstation to check the bill tomorrow morning.` |
| 5 | question | GPU (repeat) | 1951 | 455 | 476 | 2302154 | 2303554 | `Four.` |

GPU use was confirmed in the native log of run 1: `Created OpenCL device from provided device id and platform id.` and `Replacing 2068 out of 2068 node(s) with delegate (LITERT_CL) node … (decode)`. The `nativeloader` line shows `uses_libraries=libOpenCL.so`. There were no exceptions and no `AndroidRuntime` errors in any run. After the first load, later loads are faster because of `cacheDir` and the page cache.

### Gate (Step 6)

| Criterion | Result |
|---|---|
| Engine loads the model on at least one backend | PASS (GPU and CPU) |
| Question clip answer contains "4" or "four" | PASS (`Four.` on GPU and CPU) |
| Dictation clip text contains "check the build" | **FAIL**: `…check the bill tomorrow morning.` on GPU and CPU |
| Question send-to-complete ≤ 15 s on the best backend | PASS (GPU 509 ms and 476 ms) |
| Peak total PSS ≤ 5 GB | PASS (max observed 2,477,106 kB in dumpsys; 2,446,997 kB sampled) |

Audio input is accepted by this library version and model file, so approach D (platform `SpeechRecognizer`) is not forced by an audio-input failure. The miss is a transcription error on the specified clip.

### Diagnostics (not part of the verdict)

Same sentence, GPU, instruction `Transcribe the audio exactly. Output only the words spoken.` unless noted:

| Clip | Voice, SAPI rate | first-token ms | total ms | Raw output |
|---|---|---|---|---|
| `diag0.wav` | David, 0 (same bytes as the gate clip) | 436 | 709 | `Remind the workstation to check the bill tomorrow morning.` + newline |
| `diag1.wav` | David, −3 (slower) | 516 | 721 | `Remind the workstation to check the bill tomorrow morning.` |
| `diag2.wav` | Zira, 0 | 484 | 718 | `Remind the workstation to check the build tomorrow morning.` + newline |
| `diag3.wav` | Zira, −3 | 494 | 730 | `Remind the workstation to check the build tomorrow morning.` |
| `dictation.wav` with the product instruction `Transcribe the audio exactly. Output only the words spoken, with no quotes and no commentary.` | David, 0 | 427 | 645 | `Remind the workstation to check the bill tomorrow morning.` |

Reading: with the Zira voice the model transcribes the sentence exactly; with the David voice it hears "bill" every time. The gate measured synthetic speech only. No human voice was tested (NOT RUN: it needs a person speaking).

### Cleanup (Step 7)

`adb uninstall com.routeragent.jev.spike` → `Success`. Afterwards `/sdcard/Android/data/com.routeragent.jev.spike` → `No such file or directory`, so the pushed model copy and clips are gone. `com.routeragent.jev` v5 is still installed and untouched. The Edge Gallery model file is still present, unchanged (2,588,147,712 bytes, same timestamp `2026-09-29 00:21`). No phone settings were changed.

### Owner decision needed

Choose one of: (a) accept the result, since every speed, memory and loading criterion passed with a wide margin and the miss is voice-dependent, and resume at Task 2; (b) re-run the gate with a human-spoken dictation clip in an attended session; (c) pick approach D (platform `SpeechRecognizer`) for dictation only. The agent did not choose among these.

### Owner decision (2026-11-14)

The gate verdict stands as written: **criterion 3 FAILED** (the specified dictation clip transcribed as "check the bill", not "check the build"). The owner was shown the measurements and the miss, which happened with the default synthetic voice only; the other synthetic voice was transcribed exactly, and no human voice was tested. The owner chose option (a): accept the result and continue the build from Task 2 through Task 8. Reason given: every speed and memory limit passed with a wide margin, and a dictated message always lands in the message box for review before Send. A human-voice dictation check stays **NOT RUN** for the attended session.

## Task 2 — build pipeline carries the library (2026-11-14)

- `android/native-preview-toolchain.json` gains `libraries` (the 8 artifacts above, with URL and SHA-256). `scripts/prepare-android-native-tools.ps1` downloads each one into `test-results/android-tools/libs/` and verifies it. Ran it once: exit 0, all 8 files present at the pinned sizes.
- Both build scripts re-verify every library hash, unpack the AAR into the build directory (`classes.jar`, and only `jni/arm64-v8a/*.so`; the x86_64 library is not packaged), compile the app against the library jars, and give the jars to D8 as program input (no shrinking). They then check every `classes*.dex` for `android.webkit` and run `ElfAlign` on every packaged `.so`. D8 emitted a single `classes.dex` (6,460,728 bytes), so there is no `classes2.dex`.
- Manifest: `RECORD_AUDIO`; `<uses-feature android:name="android.hardware.microphone" android:required="false">`; `<queries>` for `android.intent.action.TTS_SERVICE`; `extractNativeLibs="true"`; `uses-native-library` `libOpenCL.so` and `libvndksupport.so`, both `required="false"`; `versionCode 6` / `versionName 2.4`; `minSdkVersion` stays 26.
- Build output (APK): `ElfAlignTest passed: 5 checks`, `ManifestLauncherTest passed`, `ELF …liblitertlm_jni.so min PT_LOAD alignment 16384`, `aapt2 dump badging`: `versionCode='6' versionName='2.4'`, `uses-permission: name='android.permission.INTERNET'`, `uses-permission: name='android.permission.RECORD_AUDIO'`, `uses-native-library-not-required:'libOpenCL.so'`, `uses-native-library-not-required:'libvndksupport.so'`, `uses-feature-not-required: name='android.hardware.microphone'`, `native-code: 'arm64-v8a'`. APK entries: `classes.dex` STORED, `lib/arm64-v8a/liblitertlm_jni.so` DEFLATED (22,692,856 → 9,931,141 bytes).
- AAB: `base/dex/classes.dex`, `base/lib/arm64-v8a/liblitertlm_jni.so`; `bundletool validate: PASSED`; split APK badging verified as v6.

### Phone (Step 8)

`adb install -r releases/Bunny-A-Android-v6.apk` over v5 → `Success`; `dumpsys package` changed from `versionCode=5`/`versionName=2.3` to `versionCode=6`/`versionName=2.4`. After launch, `uiautomator dump` showed `Pair with Windows`, `Workstation HTTPS Gateway Address`, `One-Time 10-Minute Pairing Code` and `Pair Securely`. `adb logcat` held no `FATAL`, no `UnsatisfiedLinkError` and no app exception; the only `AndroidRuntime` lines came from the `uiautomator` shell process. **PASS.**

## Task 6 — engine and recorder wrappers (2026-11-14)

`VoiceEngine` calls the API as read with `javap`: `new EngineConfig(path, new Backend.GPU(), null, new Backend.CPU(), 4096, null, cacheDir)`, with the same config using `Backend.CPU()` when GPU `initialize()` throws; `new ConversationConfig(Contents.Companion.of(system))`; `sendMessageAsync(Contents.Companion.of(new Content.AudioBytes(wav)), MessageCallback)`; cancel through `Conversation.cancelProcess()` plus a generation ticket, so a cancelled request never reaches its listener. `LIBRARY_MIN_SDK = 24`. Both build scripts fail if `VoiceRecorder.java` or `VoiceEngine.java` contains `java.net.`, `NativeCompanionClient` or `HostExchange`.

### On-device check of the real `VoiceEngine` class (throwaway harness, removed afterwards)

A throwaway APK (`com.routeragent.jev.spike`, throwaway key) compiled the app's own `VoiceEngine.java`, `Wav.java`, `VoicePrompt.java` and `VoiceSession.java` with the same D8 inputs as the app build: the 8 verified libraries, and **no `META-INF/services` or `.kotlin_builtins` resources**. The model was pushed into its own folder. TALK used `VoicePrompt.system(TALK, ["Nightly build — running", "Update the docs — waiting for approval"], true)`. Lines copied from `adb logcat -s BunnyHarness`; "ms" is ask → done in a fresh process and includes the engine load:

| Clip | Mode | ms | Raw output |
|---|---|---|---|
| question (David) | TALK | 15467 (first load for this package) | `Two plus two equals four. This is a basic arithmetic problem. The answer is four.` |
| "What is running on the workstation right now?" (David) | TALK | 5281 | `The nightly build is currently running on the workstation. There is also a task to update the documentation that is waiting for approval.` |
| dictation (David) | DICTATE | 5292 | `Remind the workstation to check the bill tomorrow morning.` |
| diag2 (Zira) | DICTATE | 5155 | `Remind the workstation to check the bill tomorrow morning.` |

Cancel: `cancel()` 200 ms and 2,600 ms after `ask`. Neither cancelled request called its listener, and in both cases a second `ask` 3 s later completed (`after-cancel done ms=693` and `ms=833`, both `Two plus two equals four. …`), so the worker thread did not hang. `dumpsys meminfo` afterwards: `TOTAL PSS: 2329631` kB. The log does not show whether the 2,600 ms cancel landed during generation or just after it finished.

Findings:
- **Library Java resources are not needed** for this call path: the engine loads, conversations open with a system instruction, audio is accepted and answers stream with none of the jars' resources packaged. The APK therefore carries none.
- **Dictation accuracy is not established.** With any system instruction set, the Zira clip also comes back as "check the bill" (also confirmed with the Task 1 spike APK: system = the DICTATE text, plus user text `Transcribe the audio exactly.` or the full DICTATE text). Task 1's "build" result for Zira happened only with no system instruction. The word is ambiguous in synthetic speech; a human-voice check remains NOT RUN.

`adb uninstall com.routeragent.jev.spike` → `Success`; its folder (with the pushed model and clips) is gone.

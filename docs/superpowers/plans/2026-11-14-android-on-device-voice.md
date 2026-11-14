# Android On-Device Voice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner talk to the Bunny A Android companion: a speech-capable model (Gemma 4 E2B, the engine Google AI Edge Gallery uses) runs on the phone, hears a push-to-talk recording, and either answers aloud on the phone or transcribes the words into the Chat message box.

**Architecture:** LiteRT-LM (`com.google.ai.edge.litertlm:litertlm-android:0.19.1`) is added to the hand-built Android app. Audio is recorded with `AudioRecord`, wrapped as WAV and passed to the model as `Content.AudioBytes`; answers are shown and spoken with the platform `TextToSpeech`. All decisions (state machine, prompts, model file checks, download resume, device gate) live in plain-Java classes tested on the JVM; the Android-bound classes are thin.

**Tech Stack:** Java 8 bytecode (JDK 21 `javac --release 8`), aapt2, D8 (from `r8.jar`), apksig, bundletool; LiteRT-LM 0.19.1 AAR + Kotlin stdlib/reflect + kotlinx-coroutines + gson as pinned binaries; Gemma 4 E2B `.litertlm` from Hugging Face. No Gradle. No Kotlin compiler.

**Spec:** this document, section "Design" (the owner asked for the plan directly; there is no separate design doc).

---

## Design

### Why

The owner wants to talk to Bunny on the phone with the model running on the phone, "like Edge Gallery". Edge Gallery is a demo app, not a component; its engine is LiteRT-LM, which this plan embeds.

### What the phone may and may not do (existing rules that shape this)

- The Host **does not send model output to paired devices** (`ChatTurn.NO_OUTPUT`). So the phone cannot speak the workstation's answers. This plan does not change that rule.
- The phone "can watch and stop work"; approvals, files and tools stay on Windows. Voice gets no new authority.
- The Chat tab exists only while the phone is paired (it stays visible when the Host is unreachable).

### Behaviour

A card on the Chat tab, **"🎤 Voice on this phone"**, with two push-to-talk actions (tap to start, tap to stop, automatic stop at 30 s):

1. **Talk to phone** — the model answers the spoken question itself. The answer appears in a "Phone" bubble labelled "Answered on this phone · not sent to the workstation" and is spoken aloud. The model is given a short text list of the missions/tasks the phone already shows, so "what is running?" works. Works when the workstation is unreachable. Single-turn: each recording is a fresh conversation.
2. **Dictate message** — the model transcribes the recording; the words are placed in the existing message box. The owner reviews and taps **Send**. Nothing is ever sent by voice alone.

### Goals

- Audio never leaves the phone. It is never written to storage and never passed to any network code.
- No recording unless the screen is open and the owner tapped a mic button. No wake word, no background service.
- The 2.59 GB model is not in the APK. It is downloaded once after an explicit confirmation, or copied in over USB, and is hash-verified before first use.
- The app still installs and works unchanged on phones that cannot run the model; voice shows a plain reason instead.

### Non-goals

- Speaking the workstation's answers (blocked by the Host rule above).
- Voice-triggered Stop, approvals, or any command.
- Multi-turn memory, streaming speech (answer is spoken when complete), wake word, background listening.
- Changing the Host, the Windows client, or `install/release-pin*.json`.

### Anti-goals (a failure even if it works)

- Any path where recorded audio, a transcript, or a phone-model answer reaches the Host without the owner tapping Send.
- A new permission beyond `RECORD_AUDIO`.
- A recorded-evidence claim that a person heard or spoke something when nobody did.

### Approaches considered

| | Approach | Trade-off | Outcome |
|---|---|---|---|
| A | Phone-only assistant: Gemma hears and answers on the phone | Works offline; knows nothing about the workstation | Becomes "Talk to phone", improved with the task list the phone already has |
| B | Phone hears, workstation thinks when reachable | Best answers, but the Host withholds answers from devices, so the phone could not speak them | Reduced to "Dictate message": voice fills the message box, existing Send rules apply |
| C | Phone streams audio to the Host's whisper pipeline | No on-device model; voice leaves the phone | Rejected |
| D | Platform `SpeechRecognizer` (on-device) instead of an embedded model | Zero dependencies, but is not the Edge Gallery model the owner asked for and cannot answer offline | Not built. If Task 1 shows the model cannot take audio, STOP and report this as the alternative; do not switch silently |

### Decisions made for the owner (state them in the final report)

- Model: `litert-community/gemma-4-E2B-it-litert-lm`, file `gemma-4-E2B-it.litertlm` (Apache-2.0, not gated). Gemma 3n's LiteRT-LM files are gated behind a login, so they cannot be downloaded by the app.
- `RECORD_AUDIO` is added (the app had `INTERNET` only). `AGENTS.md` rule 4 says "single permission": **do not edit `AGENTS.md`**; report the wording change the owner needs to approve.
- A second network destination: `huggingface.co` (and the CDN it redirects to) for the model file only, on explicit confirmation.
- The model is stored in the app's external files directory so it can also be copied in over USB; it is not secret and is hash-verified.
- Version becomes `versionCode 6` / `versionName 2.4`.

---

## Global Constraints

- Work only in `C:\Users\allam\Documents\new\worktrees\bun-router\bun-router-android-voice` on branch `feat/android-on-device-voice`. Never modify `C:\Users\allam\Documents\new\bun-router` (read-only reference; it has uncommitted work).
- Commit locally after each task. **Never push** (github.com is unreachable from this machine anyway) and never open a PR.
- Never open a tunnel, never start or touch the owner's installed Host, never change the PC's audio settings, never touch `install/release-pin*.json`, never use or create signing material other than what `scripts/build-android.ps1` already uses.
- Never delete `test-results/android-tools` in either checkout. Never create directory junctions or symlinks.
- Reachable hosts: `dl.google.com`, `repo1.maven.org`, `huggingface.co`, `raw.githubusercontent.com`. `github.com` and `api.github.com` time out; do not depend on them.
- No Gradle, no Kotlin compiler, no new build tool. Every downloaded binary is pinned by SHA-256 in `android/native-preview-toolchain.json` and verified before use.
- App code stays `javac --release 8`, package `com.routeragent.jev`, style of the surrounding files. Call the Kotlin library from Java; read real signatures with `javap -cp <jar> <class>` before writing a call. Never guess an API.
- Android manifest permissions must be exactly `android.permission.INTERNET` and `android.permission.RECORD_AUDIO`. `usesCleartextTraffic="false"` and `allowBackup="false"` stay.
- New pure-logic classes import nothing from `android.*`, `org.json.*` or the LiteRT-LM library, so they compile and run on the JVM like the existing tests (`android/tests/*.java`: a `check(boolean, String)` helper and `main`, no test framework).
- Every new interactive control is at least 48 dp tall and has text or a `contentDescription`.
- UI copy in this plan is exact. Use it verbatim.
- Evidence rule (`AGENTS.md` rule 1): record only what was observed. A step that needs a person speaking or listening, or a paired Host, is recorded **NOT RUN**.
- The phone (`SM-S948U`, serial `R3GL1025V4J`) is on USB and on **mobile data**. Never start the in-app model download on it. Move the model with `adb push` only.
- adb: `test-results/android-tools/platform-tools/adb.exe`. In Git Bash export `MSYS_NO_PATHCONV=1` before any adb command with a `/sdcard` or `/data` path.
- Do not use `adb shell uiautomator events`; it holds the automation connection and breaks `uiautomator dump`.

## Review Focus

1. **Leaving mid-recording** (phone call, Home, rotation, tab change): recording stops, the audio is discarded, the mic is released, no crash. → Task 5 test `cancelFromEveryState`, Task 7 step 5.
2. **Interrupted or corrupt model file** (network drop, app closed, disk full, truncated copy over USB): the download resumes; a file whose size or SHA-256 is wrong is never loaded. → Task 4 tests `resumesWithRange`, `wrongHashIsDeleted`, `truncatedIsNotReady`.
3. **Near-silent or instant recording** (tap, tap): no model call; the card says "I didn't catch anything. Try again." → Task 3 test `tooShort`, Task 5 test `shortRecordingSkipsModel`.
4. **Model output that is empty, very long, or full of markdown**: speech text is cleaned and capped; a dictated message is never sent automatically, and an empty transcript leaves the message box untouched. → Task 5 tests `cleanStripsMarkdown`, `cleanCaps`, `emptyDictationKeepsDraft`.
5. **The download must carry no Host credentials**: the request to Hugging Face has no `Cookie` and no `Authorization` header. → Task 4 test `sendsNoCredentials`.

---

## File Structure

| File | Responsibility |
|---|---|
| `android/native-preview-toolchain.json` | Adds `libraries`: name, url, sha256, kind for each pinned binary |
| `scripts/prepare-android-native-tools.ps1` | Downloads and verifies `libraries` into `test-results/android-tools/libs/` |
| `scripts/build-android.ps1`, `scripts/build-android-aab.ps1` | Library classpath, D8 multi-dex, native libs, new JVM tests, ELF check |
| `android/tools/PackageApk.java`, `PackageModule.java` | Accept several dex files and a native-library directory |
| `android/tools/ElfAlign.java` | Fails the build when a `.so` has a `PT_LOAD` alignment below 16384 |
| `android/app/src/main/AndroidManifest.xml` | Permission, TTS `<queries>`, native-library flags, version 6 / 2.4 |
| `.../jev/Wav.java` | PCM → WAV bytes; recording limits |
| `.../jev/VoiceGate.java` | Can this phone run voice, and if not, why |
| `.../jev/ModelSource.java` | The pinned model URL, size, SHA-256 |
| `.../jev/ModelFile.java` | Where the model lives; MISSING / PARTIAL / UNVERIFIED / READY; hash check |
| `.../jev/ModelDownload.java` | Resumable HTTPS download with progress and cancel |
| `.../jev/VoiceSession.java` | Voice state machine |
| `.../jev/VoicePrompt.java` | System instructions, task-list context, output cleaning |
| `.../jev/VoiceEngine.java` | Thin LiteRT-LM wrapper (Android-bound) |
| `.../jev/VoiceRecorder.java` | Thin `AudioRecord` wrapper (Android-bound) |
| `.../jev/NativeCompanionActivity.java` | Voice card on Chat, model row on System, permission, TTS, lifecycle |
| `android/tests/*Test.java` | One JVM test per pure class, plus `ElfAlignTest`, extended `ManifestLauncherTest` |
| `docs/ux/android-voice/VOICE_BUILD_RECORD.md` | Measurements and PASS / NOT RUN record |
| `PRIVACY.md`, `THIRD_PARTY_NOTICES.md`, `CHANGELOG.md`, `android/README.md` | Disclosure of the microphone, the download, the libraries |

`.../jev/` = `android/app/src/main/java/com/routeragent/jev/`.

---

### Task 1: Feasibility gate on the real phone (throwaway spike)

Nothing in this task is committed except the record. If a criterion fails, **stop the whole plan** and report.

**Files:**
- Create (scratch, outside the repo): a folder under the session temp directory holding the spike sources and downloads
- Create: `docs/ux/android-voice/VOICE_BUILD_RECORD.md`

**Interfaces:**
- Produces: the measured facts later tasks depend on — the working `EngineConfig` (backend GPU or CPU, audio backend), the audio byte format `Content.AudioBytes` accepts, the AAR's `minSdkVersion`, ABIs, native-library names and manifest entries, and the full transitive library list with SHA-256.

- [ ] **Step 1: Fetch and inspect the library.** Download `https://dl.google.com/android/maven2/com/google/ai/edge/litertlm/litertlm-android/0.19.1/litertlm-android-0.19.1.aar` (21,200,360 bytes) and its `.pom`. The POM lists `com.google.code.gson:gson:2.14.0`, `org.jetbrains.kotlin:kotlin-reflect:2.4.0`, `org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0`; resolve their POMs on `repo1.maven.org` to the full runtime set (expect at least `kotlin-stdlib`, `kotlinx-coroutines-core-jvm`, `annotations`). Unzip the AAR; record its `AndroidManifest.xml` (minSdk, `uses-native-library`, permissions), `jni/` ABIs and `.so` names, and `proguard.txt`. Read the API with `javap` for `Engine`, `EngineConfig`, `Backend`, `Conversation`, `ConversationConfig`, `Contents`, `Content`, `Message`, `MessageCallback`. API guide: `https://raw.githubusercontent.com/google-ai-edge/LiteRT-LM/main/docs/api/kotlin/getting_started.md`.

- [ ] **Step 2: Fetch the model to the PC.** `https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/2d74ac41a33d7da82f39f7d5720a04c68514a103/gemma-4-E2B-it.litertlm`, 2,588,147,712 bytes, SHA-256 `181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c`. Verify the hash. Keep the file; Task 8 reuses it.

- [ ] **Step 3: Make a spoken test clip on the PC without touching audio settings.** PowerShell `System.Speech.Synthesis.SpeechSynthesizer` with `SetOutputToWaveFile` at 16 kHz, 16-bit, mono: "What is two plus two?" (question clip) and "Remind the workstation to check the build tomorrow morning" (dictation clip).

- [ ] **Step 4: Build a spike APK** with the repo's own tools (aapt2, `javac --release 8`, D8, `PackageApk`-style zip, apksig): package `com.routeragent.jev.spike`, `android:debuggable="true"`, no permissions, one Activity. From intent extras it takes a model path, a WAV path, an instruction and a backend name; it loads the engine, sends `Contents.of(Content.AudioBytes(wav), Content.Text(instruction))`, and logs to logcat with tag `BunnySpike`: load ms, first-token ms, total ms, output text, any exception. Sign with a throwaway key generated in the scratch folder.

- [ ] **Step 5: Run on the phone.** `adb install`, `adb push` the model and clips, get them where the spike can read them (`run-as com.routeragent.jev.spike` copy, or its `/sdcard/Android/data/.../files`), then `am start` for: question clip on GPU, question clip on CPU, dictation clip with the instruction "Transcribe the audio exactly. Output only the words spoken.". Capture `adb logcat -s BunnySpike` and `adb shell dumpsys meminfo com.routeragent.jev.spike` (total PSS) after a run.

- [ ] **Step 6: Judge against the gate.** All must hold on `SM-S948U`:
  - the engine loads the model on at least one backend;
  - the question clip yields an answer containing "4" or "four";
  - the dictation clip yields text containing "check the build";
  - send-to-complete time for the question clip is 15 s or less on the best backend;
  - peak total PSS is 5 GB or less.

  If audio input is not accepted by this library version or this model file, that is a gate failure: stop and report, naming approach D from the Design section.

- [ ] **Step 7: Clean up and record.** `adb uninstall com.routeragent.jev.spike`; remove the pushed files from the phone. Write `docs/ux/android-voice/VOICE_BUILD_RECORD.md`: library version and hashes, AAR facts from Step 1, each run's backend and measured numbers, the raw model outputs, the gate verdict. Numbers come from the log, not from estimates.

- [ ] **Step 8: Commit**

```bash
git add docs/ux/android-voice/VOICE_BUILD_RECORD.md
git commit -m "docs(android-voice): on-device feasibility record for LiteRT-LM + Gemma 4 E2B"
```

---

### Task 2: Build pipeline carries the library

**Files:**
- Modify: `android/native-preview-toolchain.json`, `scripts/prepare-android-native-tools.ps1`, `scripts/build-android.ps1`, `scripts/build-android-aab.ps1`, `android/tools/PackageApk.java`, `android/tools/PackageModule.java`, `android/app/src/main/AndroidManifest.xml`, `android/tests/ManifestLauncherTest.java`
- Create: `android/tools/ElfAlign.java`, `android/tests/ElfAlignTest.java`

**Interfaces:**
- Consumes: the library list, hashes, ABI and manifest facts recorded in Task 1.
- Produces: `test-results/android-tools/libs/` populated and verified; a build where app sources compile against the library jars; an APK and AAB containing `lib/arm64-v8a/*.so` and every `classes*.dex`.

- [ ] **Step 1: Write the failing tests.**

`ElfAlignTest`: build two minimal ELF64 little-endian images in memory (64-byte header, one 56-byte program header of type `PT_LOAD`), one with `p_align = 4096` and one with `16384`.

```java
check(ElfAlign.minLoadAlign(elf(4096)) == 4096, "reads p_align");
check(!ElfAlign.ok(elf(4096)), "4 KB alignment is refused");
check(ElfAlign.ok(elf(16384)), "16 KB alignment passes");
check(!ElfAlign.ok(new byte[]{1,2,3}), "not an ELF file is refused");
```

`ManifestLauncherTest`: replace the single-permission assertion with: the set of `uses-permission` names equals exactly `{android.permission.INTERNET, android.permission.RECORD_AUDIO}`; `usesCleartextTraffic` is `false`; `allowBackup` is `false`; `versionCode` is `6`.

- [ ] **Step 2: Run the build to see them fail.** Run: `pwsh -File scripts/build-android.ps1`. Expected: FAIL at `ElfAlignTest` (class missing) or the manifest test.

- [ ] **Step 3: Pin the libraries.** Add to `android/native-preview-toolchain.json` a `libraries` array of `{ "name", "url", "sha256", "kind" }` (`kind` is `aar` or `jar`) for the AAR and every runtime jar from Task 1. Extend `scripts/prepare-android-native-tools.ps1` to download each into `test-results/android-tools/libs/`, verify the SHA-256, and for the AAR extract `classes.jar` and `jni/arm64-v8a/` beside it. Both build scripts verify the hashes the same way they verify `android.jar` and fail with a message naming the file when one is missing or wrong.

- [ ] **Step 4: Implement `ElfAlign`** in `android/tools/ElfAlign.java`: `static long minLoadAlign(byte[] elf)` (smallest `p_align` over `PT_LOAD` headers; `-1` when not ELF64-LE), `static boolean ok(byte[] elf)` (`minLoadAlign >= 16384`), and `main(String[] files)` that exits non-zero naming any file that fails.

- [ ] **Step 5: Wire the build.** In both scripts: add the library jars to the app `javac` classpath; pass them to D8 as program inputs (no shrinking; D8 emits `classes2.dex`… as needed); run `ElfAlign` over every packaged `.so`; keep the `android.webkit` check, applied to every dex file. `PackageApk` and `PackageModule` take a dex **directory** and an optional native-library directory, writing `classes*.dex` and `lib/arm64-v8a/*.so` (DEFLATED in the APK). Keep the existing argument order working for the other arguments.

- [ ] **Step 6: Manifest.** Add `RECORD_AUDIO`; `android:extractNativeLibs="true"` on `<application>`; a `<queries>` block with intent action `android.intent.action.TTS_SERVICE`; every `uses-native-library` entry the AAR's manifest declares, with `android:required="false"`; `versionCode="6"`, `versionName="2.4"`. If the AAR's `minSdkVersion` is above 26, do not raise the app's: Task 6's gate handles it at runtime, and the build must merge with the app's `minSdkVersion="26"` kept.

- [ ] **Step 7: Build and verify.** Run: `pwsh -File scripts/build-android.ps1` then `pwsh -File scripts/build-android-aab.ps1`. Expected: all JVM tests pass; `releases/Bunny-A-Android-v6.apk` and the v6 AAB exist; listing the APK shows `lib/arm64-v8a/` entries and more than one dex if D8 produced them; `aapt2 dump badging` shows both permissions and `versionCode='6'`. `releases/Bunny-A-Android-v5.*` are untouched.

- [ ] **Step 8: Install over v5 on the phone.** `adb install -r releases/Bunny-A-Android-v6.apk`, launch, confirm with `uiautomator dump` that the pairing screen appears ("Pair with Windows") and `adb logcat` shows no crash. Record the result in the build record.

- [ ] **Step 9: Commit**

```bash
git add android scripts docs/ux/android-voice
git commit -m "build(android): carry LiteRT-LM 0.19.1 and its native libraries; v6 / 2.4"
```

---

### Task 3: `Wav` and `VoiceGate`

**Files:**
- Create: `.../jev/Wav.java`, `.../jev/VoiceGate.java`, `android/tests/WavTest.java`, `android/tests/VoiceGateTest.java`
- Modify: `scripts/build-android.ps1`, `scripts/build-android-aab.ps1` (compile and run the two tests, in the style of the `PollPolicyTest` lines)

**Interfaces:**
- Produces:
  - `Wav.SAMPLE_RATE = 16_000`, `Wav.MAX_SECONDS = 30`, `Wav.MAX_PCM_BYTES = 960_000`, `Wav.MIN_PCM_BYTES = 16_000` (0.5 s)
  - `static byte[] Wav.wrap(byte[] pcm16le)` — 44-byte RIFF/WAVE header (PCM, mono, 16-bit, 16 kHz) followed by the samples
  - `static boolean Wav.tooShort(int pcmBytes)`
  - `VoiceGate.MIN_TOTAL_MEM = 7_000_000_000L`
  - `static String VoiceGate.blockedReason(int sdkInt, int librarySdk, String[] abis, long totalMemBytes)` — `null` when voice may run

- [ ] **Step 1: Write the failing tests.**

```java
// WavTest
byte[] wav = Wav.wrap(new byte[32_000]);
check(wav.length == 32_044, "44-byte header");
check(new String(wav, 0, 4, "US-ASCII").equals("RIFF") && new String(wav, 8, 4, "US-ASCII").equals("WAVE"), "RIFF/WAVE");
check(le32(wav, 4) == 32_036, "RIFF size = data + 36");
check(le16(wav, 20) == 1 && le16(wav, 22) == 1, "PCM, mono");
check(le32(wav, 24) == 16_000 && le32(wav, 28) == 32_000 && le16(wav, 34) == 16, "16 kHz, 16-bit");
check(le32(wav, 40) == 32_000, "data size");
check(Wav.tooShort(15_999) && !Wav.tooShort(16_000), "tooShort: under half a second");
check(Wav.MAX_PCM_BYTES == 960_000, "30 s cap");

// VoiceGateTest
String[] arm = {"arm64-v8a", "armeabi-v7a"};
check(VoiceGate.blockedReason(36, 26, arm, 11_500_000_000L) == null, "capable phone");
check("Voice needs a 64-bit ARM phone.".equals(VoiceGate.blockedReason(36, 26, new String[]{"x86_64"}, 11_500_000_000L)), "abi");
check("Voice needs a phone with at least 8 GB of memory.".equals(VoiceGate.blockedReason(36, 26, arm, 5_600_000_000L)), "memory");
check("Voice needs a newer version of Android.".equals(VoiceGate.blockedReason(26, 31, arm, 11_500_000_000L)), "library sdk floor");
check(VoiceGate.blockedReason(36, 26, arm, 7_000_000_000L) == null, "boundary is allowed");
```

- [ ] **Step 2: Run to verify failure.** Run: `pwsh -File scripts/build-android.ps1`. Expected: FAIL, `Wav` not found.
- [ ] **Step 3: Implement `Wav` and `VoiceGate`.** ABI is checked first, then SDK, then memory.
- [ ] **Step 4: Run to verify pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(android-voice): WAV framing and device gate"` with the four files and the scripts.

---

### Task 4: Model file and resumable download

**Files:**
- Create: `.../jev/ModelSource.java`, `.../jev/ModelFile.java`, `.../jev/ModelDownload.java`, `android/tests/ModelFileTest.java`, `android/tests/ModelDownloadTest.java`
- Modify: both build scripts (compile and run the tests)

**Interfaces:**
- Produces:
  - `ModelSource.REPO = "litert-community/gemma-4-E2B-it-litert-lm"`, `REVISION = "2d74ac41a33d7da82f39f7d5720a04c68514a103"`, `FILE = "gemma-4-E2B-it.litertlm"`, `SIZE = 2_588_147_712L`, `SHA256 = "181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c"`, `static String url()` → `https://huggingface.co/<REPO>/resolve/<REVISION>/<FILE>`
  - `ModelFile.Status { MISSING, PARTIAL, UNVERIFIED, READY }`
  - `static File ModelFile.path(File filesDir)` → `<filesDir>/models/<FILE>`; `static File ModelFile.partial(File filesDir)` → same name + `.part`
  - `static String ModelFile.marker(File f)` → `length + ":" + lastModified`
  - `static Status ModelFile.status(File filesDir, long expectedSize, String verifiedMarker)` — READY only when the file exists, has `expectedSize`, and `marker` equals `verifiedMarker`; UNVERIFIED when it exists at the right size with a different marker; PARTIAL when only the `.part` exists or the file has the wrong size; else MISSING
  - `static boolean ModelFile.verify(File f, long expectedSize, String sha256Hex)` — streaming SHA-256
  - `ModelDownload.Opener { HttpURLConnection open(String url) throws IOException; }`
  - `ModelDownload.Progress { void at(long done, long total); boolean cancelled(); }`
  - `ModelDownload.Result { DONE, CANCELLED }`
  - `static Result ModelDownload.run(Opener opener, String url, File filesDir, long expectedSize, String sha256Hex, Progress progress) throws IOException` — resumes from the `.part` length with `Range: bytes=<n>-`; `206` appends, `200` restarts from zero, `416` with a full-size `.part` proceeds to verification; on completion verifies, renames `.part` to the final name, returns DONE; a hash or size mismatch deletes the `.part` and throws `IOException("The downloaded model did not match its expected checksum. It was removed.")`; `cancelled()` keeps the `.part`. Sets no `Cookie` or `Authorization` header and calls `setUseCaches(false)`.

- [ ] **Step 1: Write the failing tests.** `ModelDownloadTest` serves a 300,000-byte pseudo-random blob from `com.sun.net.httpserver.HttpServer` on `127.0.0.1` (honours `Range`, records request headers) and passes its real size and hash as the expected values.

```java
// ModelFileTest (temp dir, small files, expectedSize = 10)
check(ModelFile.status(dir, 10, null) == Status.MISSING, "nothing there");
write(ModelFile.partial(dir), 4);  check(ModelFile.status(dir, 10, null) == Status.PARTIAL, "part file");
write(ModelFile.path(dir), 7);     check(ModelFile.status(dir, 10, null) == Status.PARTIAL, "truncatedIsNotReady");
write(ModelFile.path(dir), 10);    check(ModelFile.status(dir, 10, null) == Status.UNVERIFIED, "right size, never verified");
check(ModelFile.status(dir, 10, ModelFile.marker(ModelFile.path(dir))) == Status.READY, "verified marker matches");
check(ModelFile.status(dir, 10, "10:1") == Status.UNVERIFIED, "file replaced since verification");
check(ModelFile.verify(f, 10, sha(f)) && !ModelFile.verify(f, 10, sha(f).replace('a','b').replace('1','2')) && !ModelFile.verify(f, 11, sha(f)), "size and hash both matter");
check(ModelSource.url().equals("https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/resolve/2d74ac41a33d7da82f39f7d5720a04c68514a103/gemma-4-E2B-it.litertlm"), "pinned revision URL");
check(ModelSource.SHA256.length() == 64 && ModelSource.SIZE == 2_588_147_712L, "pinned size and hash");

// ModelDownloadTest
check(run(dir) == Result.DONE && Arrays.equals(read(ModelFile.path(dir)), blob), "full download");                    // fullDownload
// resumesWithRange: pre-write the first 100,000 bytes as .part
check(run(dir2) == Result.DONE && server.lastRange.equals("bytes=100000-") && Arrays.equals(read(ModelFile.path(dir2)), blob), "resumesWithRange");
// server ignores Range and answers 200
check(run(dir3) == Result.DONE && Arrays.equals(read(ModelFile.path(dir3)), blob), "200 restarts from zero");
// .part already complete, server answers 416
check(run(dir4) == Result.DONE, "416 with a complete part verifies and finishes");
// wrongHashIsDeleted: expected hash differs
checkThrows(() -> run(dir5, wrongHash), "checksum"); check(!ModelFile.partial(dir5).exists() && !ModelFile.path(dir5).exists(), "wrongHashIsDeleted");
// cancel after the first progress call
check(run(dir6, cancelAfterFirst) == Result.CANCELLED && ModelFile.partial(dir6).length() > 0 && !ModelFile.path(dir6).exists(), "cancel keeps the part");
check(server.sawHeader("Cookie") == false && server.sawHeader("Authorization") == false, "sendsNoCredentials");
```

- [ ] **Step 2: Run to verify failure.** Expected: FAIL, classes not found.
- [ ] **Step 3: Implement the three classes.** 64 KB buffer; report progress at most every 250 ms.
- [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(android-voice): pinned model source, file states, resumable download"`.

---

### Task 5: `VoiceSession` and `VoicePrompt`

**Files:**
- Create: `.../jev/VoiceSession.java`, `.../jev/VoicePrompt.java`, `android/tests/VoiceSessionTest.java`, `android/tests/VoicePromptTest.java`
- Modify: both build scripts

**Interfaces:**
- Produces:
  - `VoiceSession.State { IDLE, RECORDING, THINKING, SPEAKING }`, `VoiceSession.Mode { TALK, DICTATE }`
  - fields `State state`, `Mode mode`, `String text` (streamed or final model text), `String notice` (one line for the card, or null)
  - `boolean start(Mode m)` — only from IDLE; clears `text` and `notice`
  - `boolean stopRecording(int pcmBytes)` — from RECORDING: too short → IDLE with `notice = "I didn't catch anything. Try again."` and returns `false` (do not call the model); otherwise THINKING and `true`
  - `void partial(String soFar)` — only in THINKING
  - `String answered(String full)` — from THINKING: TALK → SPEAKING, returns the cleaned text to speak; DICTATE → IDLE with `notice = "Transcribed on this phone. Review it, then tap Send."`, returns the cleaned transcript (empty string when nothing was heard, with `notice = "I didn't catch anything. Try again."`)
  - `void spoken()` — SPEAKING → IDLE
  - `void failed(String message)` — any state → IDLE with `notice = message`
  - `void cancel()` — any state → IDLE, `text` and `notice` cleared
  - `String signature()` — `state + "|" + mode + "|" + notice + "|" + (text == null ? 0 : text.hashCode())`, for the activity's render check
  - `VoicePrompt.MAX_WORK_LINES = 20`, `MAX_LINE = 120`, `MAX_SPOKEN = 600`
  - `static String VoicePrompt.system(VoiceSession.Mode mode, List<String> workLines, boolean workstationReachable)`
  - `static String VoicePrompt.clean(String modelText)` — trims; removes `*`, `#`, backticks and leading list markers; collapses whitespace; caps at `MAX_SPOKEN` characters at a word boundary

  Exact instruction text. DICTATE: `Transcribe the audio exactly. Output only the words spoken, with no quotes and no commentary.` TALK: `You are Bunny, a voice assistant running on this phone. Answer the spoken question in at most three short sentences, in plain words with no formatting. You cannot run tasks, approve anything or change files; those happen on the Windows workstation.` followed by, when `workLines` is non-empty, `Work shown on this phone right now:` and one line per item, each prefixed with `- ` (at most 20 lines, each item cut to 120 characters), or `No missions or tasks are shown on this phone.` when empty; and, when `workstationReachable` is false, the final line `The workstation is not reachable right now, so this list may be out of date.`

- [ ] **Step 1: Write the failing tests.**

```java
// VoiceSessionTest
VoiceSession s = new VoiceSession();
check(s.state == State.IDLE && s.start(Mode.TALK) && s.state == State.RECORDING, "start");
check(!s.start(Mode.DICTATE), "no second start while recording");
check(!s.stopRecording(15_999) && s.state == State.IDLE && "I didn't catch anything. Try again.".equals(s.notice), "shortRecordingSkipsModel");
s.start(Mode.TALK); check(s.stopRecording(64_000) && s.state == State.THINKING, "thinking");
s.partial("Fo"); check("Fo".equals(s.text), "partial shown");
check("Four.".equals(s.answered("**Four.**")) && s.state == State.SPEAKING, "talk speaks cleaned text");
s.spoken(); check(s.state == State.IDLE, "spoken");
s.start(Mode.DICTATE); s.stopRecording(64_000);
check("check the build".equals(s.answered(" check the build ")) && s.state == State.IDLE && "Transcribed on this phone. Review it, then tap Send.".equals(s.notice), "dictation ends idle");
s.start(Mode.DICTATE); s.stopRecording(64_000);
check("".equals(s.answered("  ")) && "I didn't catch anything. Try again.".equals(s.notice), "emptyDictationKeepsDraft");
for (State st : State.values()) { VoiceSession c = at(st); c.cancel(); check(c.state == State.IDLE && c.text == null && c.notice == null, "cancelFromEveryState " + st); }
VoiceSession f = at(State.THINKING); f.failed("The voice model stopped."); check(f.state == State.IDLE && "The voice model stopped.".equals(f.notice), "failure is shown");
VoiceSession late = new VoiceSession(); late.partial("x"); check(late.text == null, "late partial after cancel is ignored");
check(late.answered("x").isEmpty() && late.state == State.IDLE, "late answer after cancel is ignored");

// VoicePromptTest
check(VoicePrompt.clean("**Four.**\n\n- `2+2`") .equals("Four. 2+2"), "cleanStripsMarkdown");
String longText = repeat("word ", 400); String cut = VoicePrompt.clean(longText);
check(cut.length() <= 600 && !cut.endsWith(" ") && longText.startsWith(cut), "cleanCaps");
check(VoicePrompt.clean(null).isEmpty() && VoicePrompt.clean("   ").isEmpty(), "empty");
String d = VoicePrompt.system(Mode.DICTATE, Arrays.asList("Mission A"), true);
check(d.equals("Transcribe the audio exactly. Output only the words spoken, with no quotes and no commentary."), "dictation carries no task list");
String t = VoicePrompt.system(Mode.TALK, lines(30, 200), false);
check(count(t, "\n- ") == 20 && maxLineLength(t, "- ") <= 122, "task list is capped");
check(t.endsWith("The workstation is not reachable right now, so this list may be out of date."), "offline note");
check(VoicePrompt.system(Mode.TALK, new ArrayList<String>(), true).contains("No missions or tasks are shown on this phone."), "empty list");
```

- [ ] **Step 2: Run to verify failure.** - [ ] **Step 3: Implement both classes.** - [ ] **Step 4: Run to verify pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(android-voice): voice state machine and prompts"`.

---

### Task 6: `VoiceEngine` and `VoiceRecorder` (Android-bound, thin)

**Files:**
- Create: `.../jev/VoiceEngine.java`, `.../jev/VoiceRecorder.java`

**Interfaces:**
- Consumes: the `EngineConfig` and audio format proven in Task 1; `Wav.wrap`, `Wav.MAX_PCM_BYTES`.
- Produces:
  - `VoiceEngine.Listener { void partial(String soFar); void done(String full); void failed(Exception e); }` — called on the engine thread
  - `static VoiceEngine VoiceEngine.get()` — process-wide, so a rotated screen keeps a loaded model
  - `void ask(Context context, File model, String system, byte[] wav, Listener listener)` — loads the model on first use (the backend Task 1 found best, falling back to CPU when initialisation throws; `cacheDir = context.getCacheDir()`), opens a fresh `Conversation` with `system` as the system instruction, sends the audio, streams partial text, closes the conversation. One request at a time on a single-thread executor.
  - `void cancel()` — stops the current generation if the library offers it; in every case the listener of a cancelled request is never called again
  - `void close()` — closes the engine and frees its memory; safe to call when nothing is loaded
  - `static final int VoiceEngine.LIBRARY_MIN_SDK` — the AAR's `minSdkVersion`, for `VoiceGate`
  - `VoiceRecorder(Runnable onLimit)`; `boolean start()` (false when `AudioRecord` cannot initialise); `byte[] stop()` → raw PCM (16 kHz, mono, 16-bit), capped at `Wav.MAX_PCM_BYTES`; `void discard()`; `int seconds()`. Recording runs on its own thread, holds the samples in memory only, and calls `onLimit` on the main thread at 30 s.

- [ ] **Step 1: Implement `VoiceEngine`** against the signatures read with `javap`. Kotlin default arguments do not exist from Java: pass every constructor argument.
- [ ] **Step 2: Implement `VoiceRecorder`** with `MediaRecorder.AudioSource.VOICE_RECOGNITION`.
- [ ] **Step 3: Build.** Run: `pwsh -File scripts/build-android.ps1`. Expected: compiles; all JVM tests still pass. Neither file imports `NativeCompanionClient`, `HostExchange` or `java.net.*`; add a build-script check that fails when `VoiceRecorder.java` or `VoiceEngine.java` contains `java.net.` or `NativeCompanionClient`.
- [ ] **Step 4: Commit** — `git commit -m "feat(android-voice): LiteRT-LM engine wrapper and in-memory recorder"`.

---

### Task 7: Voice on the Chat tab, model row on the System tab

**Files:**
- Modify: `.../jev/NativeCompanionActivity.java`

**Interfaces:**
- Consumes: every class from Tasks 3–6. Existing members to build on: `chatDraft`, `showChatTab()`, `renderCurrentTab(boolean)` and its signature string, `snapshot`, `lastFailure`, `main` (Handler), `button(...)`, `text(...)`, `banner(...)`, `bubble(...)`, `add(...)`, `dp(...)`, `onStop()`, `onDestroy()`.

- [ ] **Step 1: State.** A process-wide `VoiceSession` (static, like `chat`), a `VoiceRecorder`, a lazily created `TextToSpeech`, a download executor, and a `SharedPreferences` file `native_voice_v1` holding only the verified marker. Add `voice.signature()` and the model status to the render signature so the card re-renders when they change.

- [ ] **Step 2: The card**, placed in `showChatTab()` between the message list and the message box. Title `🎤 Voice on this phone`, detail `Runs on this phone. Your voice is not sent to the workstation or anywhere else.` Then exactly one of:

  | Condition | Content |
  |---|---|
  | `VoiceGate.blockedReason(...)` is not null | that reason as text; no buttons |
  | Model MISSING or PARTIAL, no download running | `Voice needs a 2.6 GB model (Gemma 4 E2B, from Hugging Face). It is downloaded once and stays on this phone.` Button `Download voice model (2.6 GB)` (PARTIAL: `Resume download`) |
  | Download running | `Downloading voice model… 41% (1.06 of 2.59 GB)` and button `Pause` |
  | UNVERIFIED (being checked) | `Checking the model file…` |
  | READY, session IDLE | buttons `Talk to phone` (contentDescription `Talk to phone, runs on this device`) and `Dictate message` (contentDescription `Dictate a message for the workstation`); `voice.notice` below when set |
  | RECORDING | `Listening… 0:07 of 0:30` and one button: `Stop and answer` (TALK) or `Stop and transcribe` (DICTATE); a `Cancel` button |
  | THINKING | `Thinking on this phone…`, the streamed text so far, a `Cancel` button |
  | SPEAKING | the answer, `Speaking…`, a `Stop` button |

  In TALK mode the last answer stays visible as a bubble with sender `Phone` and label `Answered on this phone · not sent to the workstation`. It is kept in memory only.

- [ ] **Step 3: Download flow.** The button opens a dialog: title `Download 2.6 GB?`, message `This uses mobile data if you are not on Wi-Fi. The download continues only while this screen is open and resumes where it stopped.`, buttons `Not now` / `Download`. Before starting, require `getExternalFilesDir(null).getUsableSpace()` ≥ remaining bytes + 200 MB, else show `Not enough free space for the voice model. Free 2.8 GB and try again.` Run `ModelDownload.run` on the download executor with an `Opener` that opens a plain `HttpsURLConnection` (no cookie handler, no shared client code). `onStop()` cancels the download (the `.part` stays). Failures show the exception message on the card. After DONE, and whenever status is UNVERIFIED, run `ModelFile.verify` off the main thread and store the marker; a failed verification deletes the file and shows `The voice model file was damaged and has been removed.`

- [ ] **Step 4: Talk and dictate.** Tapping a mic button: if `RECORD_AUDIO` is not granted, `requestPermissions`; on denial set notice `Microphone access is off. Allow it in Settings › Apps › Bunny-A › Permissions to use voice.` Otherwise `voice.start(mode)` and `recorder.start()` (false → `voice.failed("The microphone could not be opened.")`). The stop button: `byte[] pcm = recorder.stop()`; if `voice.stopRecording(pcm.length)` then `VoiceEngine.get().ask(this, model, VoicePrompt.system(mode, workLines(), lastFailure == null), Wav.wrap(pcm), listener)`. `workLines()` builds `"<title> — <state>"` strings from the missions and tasks in `snapshot`, the same items `showTasksTab()` lists. The listener posts to `main`: `partial` → `voice.partial`; `done` → `String out = voice.answered(full)`; TALK → speak `out` with `TextToSpeech` (`QUEUE_FLUSH`), `voice.spoken()` from the utterance-done callback; DICTATE and `out` not empty → `chatDraft = chatDraft.isEmpty() ? out : chatDraft + " " + out`. `failed` → `voice.failed("The voice model could not answer: " + message)`. If `TextToSpeech` fails to initialise, the answer stays on screen with `Speech output isn't available on this phone.` and the session returns to IDLE. `sendChat` is never called from voice code.

- [ ] **Step 5: Lifecycle.** `onStop()`: `recorder.discard()`, `VoiceEngine.get().cancel()`, stop TTS, `voice.cancel()`, cancel the download. Changing tab does the same except the download keeps running. `onDestroy()`: shut down TTS; when `isFinishing()`, `VoiceEngine.get().close()`. `onTrimMemory(TRIM_MEMORY_RUNNING_CRITICAL or above)`: `VoiceEngine.get().close()` when the session is IDLE.

- [ ] **Step 6: System tab.** In the status card add a row `Voice model` with value `Installed (2.6 GB)` / `Not installed` / `Not supported on this phone`, and, when a model or `.part` file exists, a button `Remove voice model` that closes the engine, deletes both files and clears the marker after a confirm dialog (`Remove the voice model?` / `Voice stops working until it is downloaded again.` / `Keep` / `Remove`). Change the `Notifications` and `Updates` rows only if their text becomes untrue.

- [ ] **Step 7: Build.** Run: `pwsh -File scripts/build-android.ps1` and `pwsh -File scripts/build-android-aab.ps1`. Expected: PASS; APK and AAB rebuilt.
- [ ] **Step 8: Commit** — `git commit -m "feat(android-voice): talk to the phone and dictate a message from the Chat tab"`.

---

### Task 8: Device checks that need no person and no Host; disclosure; record

**Files:**
- Modify: `PRIVACY.md`, `THIRD_PARTY_NOTICES.md`, `CHANGELOG.md`, `android/README.md`, `docs/ux/android-voice/VOICE_BUILD_RECORD.md`

- [ ] **Step 1: Install and smoke-test.** `adb install -r releases/Bunny-A-Android-v6.apk`; launch; `uiautomator dump` shows the pairing screen; `adb logcat` shows no crash and no `UnsatisfiedLinkError`; `adb shell dumpsys package com.routeragent.jev` lists exactly the two requested permissions, with `RECORD_AUDIO` not granted.
- [ ] **Step 2: Stage the model over USB** for the owner's attended session: `adb push` the verified file from Task 1 to `/sdcard/Android/data/com.routeragent.jev/files/models/gemma-4-E2B-it.litertlm` (create the folders by launching the app once first). If the shell is refused, record that and leave the file on the PC, noting its path.
- [ ] **Step 3: Disclosure.** `PRIVACY.md`: the Android app can use the microphone only while its screen is open and after a mic button is tapped; audio is processed on the phone, never stored and never sent; the voice model is downloaded once from Hugging Face after confirmation, which reveals the phone's IP address to Hugging Face and its CDN; no telemetry is added. `THIRD_PARTY_NOTICES.md`: LiteRT-LM, Kotlin standard library and reflect, kotlinx.coroutines, Gson (all Apache-2.0, with versions) and Gemma 4 E2B (Apache-2.0, downloaded, not bundled). `CHANGELOG.md` and `android/README.md`: the feature, the second permission, the APK size change, how to copy the model over USB.
- [ ] **Step 4: Record.** Complete `docs/ux/android-voice/VOICE_BUILD_RECORD.md` with a results table. PASS only for what ran. These are **NOT RUN** and listed for the owner's attended session (they need a paired Host, which needs a tunnel the owner approves, and a person): microphone permission prompt; Talk to phone end to end with a spoken question; Dictate into the message box; the spoken answer being audible and intelligible; cancel and Home mid-recording; rotation mid-answer; TalkBack reading the new controls; the in-app download on Wi-Fi; Remove voice model. Also record APK and AAB sizes and hashes, and the `AGENTS.md` rule 4 wording change awaiting the owner.
- [ ] **Step 5: Final verification.** Run both build scripts once more from a clean `test-results/android-build-*`; `git status` is clean apart from ignored files; `git log --oneline 316e569..HEAD` lists the task commits; `releases/Bunny-A-Android-v5.*` hashes are unchanged.
- [ ] **Step 6: Commit** — `git commit -m "docs(android-voice): privacy, notices, changelog and build record"`.

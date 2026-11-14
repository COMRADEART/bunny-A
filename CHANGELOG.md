# Changelog

## 2.4 (Android) — unreleased

- Android: voice on the phone. A "Voice on this phone" card on the Chat tab runs Google's LiteRT-LM engine with the
  Gemma 4 E2B model on the phone itself. "Talk to phone" answers aloud on the phone, using the missions and tasks the
  phone already shows; the answer is not sent to the workstation. "Dictate message" types your words into the message
  box for you to review before tapping Send; nothing is ever sent by voice alone.
- Android asks for a second permission, the microphone, used only while the screen is open and after a mic button is
  tapped. Audio is processed in memory on the phone and never stored or sent.
- The 2.6 GB voice model is not in the app: it is downloaded once from Hugging Face after you confirm (it resumes if
  interrupted and is checked against its SHA-256), or copied in over USB (see `android/README.md`). It can be removed on
  the System tab. Phones that cannot run it (not 64-bit ARM, under 8 GB of memory) show the reason instead.
- The APK grows from about 111 KB to about 16 MB because it now carries the LiteRT-LM engine (arm64-v8a only) and the
  Kotlin runtime it needs. Version 6 / 2.4.

## 28.0.0-beta.1 (Windows) / 2.3 (Android) — unreleased

First public beta.

- Windows: native workstation with a glass notch that docks to any screen edge, Approval Center for consequential
  actions, multi-agent missions, local models through Ollama, on-device voice.
- Android: native companion that pairs with your PC by a one-time code over HTTPS, with one permission and no tracking.
- Connection status uses plain language ("your PC", "Offline"); a pairing that is about to end is called out.
- Android notices a restored network within 5 seconds while the app is open.
- Android targets API 36 (Android 16), as Google Play requires; back navigation uses the Android 13+ back callback.

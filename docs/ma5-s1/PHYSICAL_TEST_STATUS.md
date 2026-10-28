# MA5-S1 — Physical test status

| Area | Status | Notes |
|---|---|---|
| Windows app on real hardware | **Exercised** | Real WPF renders on this workstation, real Host, real local Ollama model |
| Two monitors with different DPI | **Exercised** | Built-in panel at 150 % and external Samsung LS27D36xG at 100 %; dock, drag across monitors, collapse and relaunch persistence |
| Resolution / scale / taskbar change at runtime | NOT TESTED | Handlers present, not driven |
| Monitor unplug | NOT TESTED | |
| Microphone capture / speaker playback (acoustic) | NOT TESTED | Voice wiring only (open, mute, unmute, close); listening never started. No synthetic audio was used or counted |
| Screen reader by a person | NOT TESTED | UIA semantics verified by automation |
| Android device or emulator | **BLOCKED** | None attached; `adb devices` empty |
| Android upgrade over v3, pairing, polling, Stop, TalkBack | **BLOCKED** | Requires a device |
| Windows SmartScreen / unsigned-download experience | NOT TESTED | Candidate is unsigned for development only |

Nothing in this milestone was installed over the owner's active Bunny A.

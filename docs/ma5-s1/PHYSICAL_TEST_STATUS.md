# MA5-S1 — Physical test status

| Area | Status | Notes |
|---|---|---|
| Windows app on real hardware | **Exercised** | Real WPF renders on this workstation, real Host, real local Ollama model |
| Two monitors with different DPI | **Exercised** | Built-in panel at 150 % and external Samsung LS27D36xG at 100 %; dock, drag across monitors, collapse and relaunch persistence |
| Resolution / scale / taskbar change at runtime | NOT TESTED | Handlers present, not driven |
| Monitor unplug | NOT TESTED | |
| Microphone capture / speaker playback (acoustic) | NOT TESTED | Voice wiring only (open, mute, unmute, close); listening never started. No synthetic audio was used or counted |
| Screen reader by a person | NOT TESTED | UIA semantics verified by automation |
| Android device or emulator | **Exercised (S1R1)** | Galaxy SM-S948U, Android 17, attached during S1R1 (S1R1_ANDROID_DEVICE_ACCEPTANCE.md). In S1 none was attached |
| Android upgrade over v3, pairing, polling, Stop, TalkBack | **PARTIAL (S1R1)** | Upgrade over v3, pairing over trusted HTTPS, polling/backgrounding, Stop, revoke and an injected lost answer were observed on the device. Not established: whether v3's app data survived the upgrade. TalkBack, rotation and process death: NOT TESTED |
| Windows SmartScreen / unsigned-download experience | NOT TESTED | Candidate is unsigned for development only |

Nothing in this milestone was installed over the owner's active Bunny A.

S1R1: the phone's Bunny A was upgraded from v3 to the S1R1 native companion with the owner's approval, and paired only with a disposable Host.

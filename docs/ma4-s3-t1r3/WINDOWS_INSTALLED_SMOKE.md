# Windows installed smoke

The package was installed with `-StageOnly -AllowTestPackage` into `%LOCALAPPDATA%\Bunny-T1R3-Install`. The Startup directory argument was an empty isolated folder. Stage-only returned before any shortcut. The real `%LOCALAPPDATA%\Bunny-A` directory and the real Startup `Bunny-A.lnk` kept the same modification times through the smoke (`realUntouched: true`).

The owner's database was not copied. A new empty database was created with `HostDatabase` in the isolated `state` directory, with a layout-2 marker whose schema hash matched that database, so `Start-Bunny-Release.ps1` could validate it. `install.json` existed only under the isolated root.

The launcher was `Start-Bunny-Release.ps1 -NoIsland -NoGateway -NoRemote`. It exited 0. `GET /health` returned `app: Bunny-A` from the packaged `runtime/node.exe` (v24.18.0, hash `9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de`). The packaged LICENSE is the 160,552 byte Node.js notice.

`onboarding.save` returned 200 and stored `huihui_ai/qwen2.5-abliterate:7b`. The smoke's poll of `diagnostics.health` kept `ollamaReachable` false; the completed generations below are the evidence the runtime answered.

| Flow | Class | Team | State | Served digest | Verification |
| --- | --- | --- | --- | --- | --- |
| What HTTP status code means Not Found? | C0 | null | completed, 9,392 ms | matches the tag | null |
| Read NOTES.md and report its first line. | C1 | null | completed, 8,063 ms | matches the tag | null |
| Inspect several files and propose a patch. | C2 | Planner, Worker | completed, 6,243 ms | matches the tag | null |

C0 output contains 404. C1 output states a first line of NOTES.md. No file tool ran, and verification is null, so that sentence is model text only. C2 recorded Planner and Worker and still ran one model. The model asked for file text. No patch was applied. Verification is null.

Stop while a generate was running: saw `running`, settled `stopped` in 1,068 ms, output did not grow. No receipt digest, because Stop settled before the receipt.

The isolated install, its state, the isolated Startup folder, and the isolated workspace were then removed (`removed: true`). The real install and shortcut were still unmodified.

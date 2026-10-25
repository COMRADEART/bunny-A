# Node runtime license and packaging

`C:\Program Files\nodejs\node.exe` is v24.18.0, 92,534,088 bytes, SHA-256 `9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de`. That hash is the official `win-x64/node.exe` entry in the Node.js v24.18.0 SHASUMS256.txt. There is no LICENSE beside that installed exe. Program Files was not modified.

The official `node-v24.18.0-win-x64.zip` was downloaded to `%LOCALAPPDATA%\Bunny-T1R3-Node\`. The raw SHASUMS256.txt hash of the zip is `0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821`. The zip is 37,176,245 bytes and starts with the ZIP magic `50 4B 03 04`. The extracted `node.exe` matches the installed exe hash. The extracted LICENSE is 160,552 bytes and begins with the Node.js contributors copyright. The zip and LICENSE were not committed.

An isolated bin at `%LOCALAPPDATA%\Bunny-T1R3-Node\bin` holds a copy of that exe plus that LICENSE. The packager was run with that directory first on PATH, so `Get-Command node` saw the license sibling. The real Node install was not given a license file.

Package `Bunny-A-T1R3-TEST` version `0.0.1-t1r3` was built with `-SkipDashboardBuild -NoArchive` from source commit `adac5859c7a9de36f9f04dea5e071d8e297a1486`. The first attempt stopped because the pinned Whisper runtime was not staged in this worktree. A junction to the already pin-checked vendor in the T1R2 worktree supplied those files. The packager hash-checks them against `whisper-pin.json` before they enter the release. Nothing was downloaded in the package step.

The packaged `runtime/node.exe` has the same hash and size as the official exe. `runtime/LICENSE` is 160,552 bytes and names the Node.js contributors. Output directory: `%LOCALAPPDATA%\Bunny-T1R3-Package\Bunny-A-T1R3-TEST`.

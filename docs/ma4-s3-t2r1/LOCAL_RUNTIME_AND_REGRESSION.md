# Local runtime and regression

## Node

The machine Node at `C:\Program Files\nodejs\node.exe` (v24.18.0) has no `LICENSE` beside it. That install was not modified and no license text was written for it.

An official Windows x64 zip for the same version was downloaded from `https://nodejs.org/dist/v24.18.0/node-v24.18.0-win-x64.zip`. Its SHA-256 is `0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821`, which matches `SHASUMS256.txt` from that directory. The extracted tree contains `node.exe` and the Node.js `LICENSE`. Every local command in this qualification used that tree.

## Whisper.cpp 1.9.4

`scripts/stage-whisper.mjs` does not download. The pin file `native/voice/whisper-pin.json` (tag `b5130`, commit `927cfce34f31707e17f2bff35c349632fb9e2c3a`) was checked against archives and the model already present on this machine. The release zip, source tarball, `ggml-base.en.bin`, and every pinned runtime DLL matched the pin. The script then staged `native/voice/vendor/runtime/`. The shim was compiled here from `native/voice/whisper-shim.c` and linked to those DLLs. Vendor bytes stay gitignored.

`scripts/voice-worker.test.mjs` ran inside the scripts stage. The whisper cases passed on fixture PCM: pin match, `whisper.cpp v1.9.4` ready on `ggml-base.en`, synthesized phrases, silence, noise, abort during decode, and SAPI fallback when the model is missing. Those cases are not microphone audio.

## Commands

| Command | Result |
| --- | --- |
| `npm test` (one process) | Exit 1. Scripts stage 463 pass, 1 fail, 0 skip (464). The `&&` chain stopped, so the library, agent, and MA4 stages did not run in that process. |
| Failed test, rerun alone | `MA2 T1 Windows controller: after-config` passed in 17.3 s. The first attempt ran about 40 minutes and failed with empty stderr against `/Test failure/`. |
| Library stage (same command as `npm test` stage 2) | Exit 0. 1671 pass, 0 fail, 0 skip. |
| Agent stage | Exit 0. 58 pass. |
| `npm run test:ma4` | Exit 0. 271 pass, 1 skip. The skip is the opt-in live free-model contract (`BUNNY_MA4_LIVE` unset). |
| `npm run test:ui` | Exit 0. 421 pass. |
| `npm run typecheck` | Exit 0. |
| `npm run build` | Exit 0. |
| `JEV_DESKTOP_BUILD=1` `npm run build` | Exit 0. |
| Security | `npm audit --omit=dev --audit-level=high` reported 0 vulnerabilities. No committed `.env`. No secret pattern in non-test, non-doc files. `registry.ts` keeps external inference disabled. `cloud-candidates.ts` has no `enabled: true`. |

Counts are in `evidence/regression-summary.json`.

The migration hang is outside the voice path. Hosted CI on `4af7d9f` already passed the same test. It did not reproduce on the immediate rerun. This record does not treat the first process exit as a voice regression, and it does not hide the exit code.

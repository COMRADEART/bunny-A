# M-A-3 T10 — Baseline

Recorded 2026-10-10, before any T10 change.

## Checkout

| Item | Value |
|---|---|
| Branch | `claude/ma3-t9-phone-remote` |
| HEAD at start | `c06313fed80a757d1aad6e51eeb5e945ce461c9f` (F04 evidence commit) |
| F04 source commit | `43ffee8`, verified an ancestor of HEAD (`git merge-base --is-ancestor`) |
| Evidence-only descendant | `43ffee8..c06313f` touches only `test-results/` plus `MA3_T9R_F04_PROVIDER_PROCESS_CONTAINMENT.md` (the report) |
| Unpushed | 147 commits ahead of `main`; 6 ahead of the remote branch. Not pushed in T10. |

## Protected untracked files

Hashed before work began and never edited by T10:

```
6cc35b510665d7da6b69612a319208a4cca9635ce826b654a1a9b0b660e0a468  BUNNY_OPENDOTS_ADOPTION_REPORT.md
49e961ad523b4579ea586cc59eb56103c9c5c34cff0ba3def7dc8c5583c9bd05  MA1D_FINAL_INDEPENDENT_REVIEW.md
761c9432ccb0366c2f145f2eab9cfc1ff89c6602dcb0b7e75834379a6d32302d  MA1_CLAUDE_FINAL_REVIEW.md
2ac061dda6f07d86236c1c648ec738d363cb9b701e148b17c7755d5653f57d3a  MA2_FINAL_INDEPENDENT_REVIEW.md
80e9c35b8a008386a936e4db32e8ad5538fce4bd84e2678566cd5365a48d5bf9  a.txt
```

`memory/` (untracked) was also left untouched.

## Regression baseline at `c06313f` (LIVE run, this machine)

| Suite | Command | Result |
|---|---|---|
| Scripts | `npm test`, part 1 (`scripts/*.test.mjs`) | 256 / 256 pass |
| Library | `npm test`, part 2 | 916 / 916 pass |
| Agent | `npm test`, part 3 (agent-runtime, agent-recovery) | 24 / 24 pass |
| UI | `npm run test:ui` | 99 / 99 pass |
| **Total** | | **1,295 / 1,295**, 0 skipped, 0 todo |

The raw logs are in `baseline/baseline-npm-test.log` and `baseline/baseline-test-ui.log`. The tests rewrite tracked t5/t6/t7/t9r evidence, which was restored with `git checkout -- test-results/ma3` (a known F04 gotcha).

## Production (read-only observation)

`production-before.json` (observer: `production-observe.mjs`, copied from F04 with a read-only audio/privacy receipt added):

- `currentRelease` = `Bunny-A-Windows-v26-MA2-R1`; release folder has 161 files, manifest sha256 `81f83786…4729`.
- Host `127.0.0.1:43119` (pid 28108), gateway `127.0.0.1:8084` (pid 34396). Both running.
- 25 SQLite tables, hashed.
- Microphone privacy: user `Allow`, user NonPackaged `Allow`, machine `Allow`. The audio endpoint list is hashed.

## Accepted F04 limitations, preserved verbatim in scope

1. Physical phone, LAN and internet-remote behaviour: NOT TESTED.
2. A Host with no enclosing job (WMI broker launch): NOT TESTED.
3. Death in the middle of Stop cleanup was not observed live.
4. Out-of-contract classes (brokered launches, WSL, existing daemons such as the Ollama HTTP server, hosted APIs, a hostile same-user process attacking the Host) are not contained. Non-Windows platforms are uncontained.
5. The F03 D1 heuristic residual class remains.
6. Accepted LOW residuals: `close_group` can block the Host thread for up to about 3.4 s, and a database write failure mid-restart keeps that restart's hold.

## Machine audio facts (LIVE, read-only)

- Input: `Microphone Array (Intel® Smart Sound Technology for Digital Microphones)`. It is the default capture endpoint and is **muted at the Windows endpoint level** (`IAudioEndpointVolume.GetMute` = true, volume 0.81). A capture spike returned digital silence (RMS 0.5/32768). T10 never changes this setting.
- Outputs: `Speakers (Realtek(R) Audio)` (default) and `Speakers (SD4780P Audio)`.
- Speech: the SAPI 5.4 recognizer `MS-1033-80-DESK` (en-US) is installed; SAPI voices are `Microsoft David Desktop` and `Microsoft Zira Desktop`; OneCore voices are David, Mark and Zira.
- Toolchain: `csc.exe` v4.0.30319 (C# 5), .NET SDK, Python 3.12. Ollama 0.40.2 serves local models (`qwen2.5-abliterate:7b`, `qwen2.5-coder:7b`, 27b and 30b models) and one cloud model, `deepseek-v4.1-flash:cloud`.

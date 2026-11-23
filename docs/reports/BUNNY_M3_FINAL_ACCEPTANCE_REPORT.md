# Bunny-A M3 Final Acceptance Report

October 2, 2026 · America/New_York

**Verdict: M3_PASS.** This is development acceptance of the current M3 candidate. Installed v10 has not been replaced.

## Visual

- The supplied official concept image was opened and used for the comparison. It is preserved as [bunny_a_futuristic_ai_os_showcase.png](C:/Users/<user>/Documents/new/bun-router/screenshots/m3/acceptance/bunny_a_futuristic_ai_os_showcase.png).
- Island, routing, desktop Home and phone match the intended blue-black glass, restrained illumination, Bunny identity, provider color and readable task-state direction. Small fixes address recognizable provider symbols, orange Claude quota rings, the clipped routing node, oversized summary cards, and repetitive approval prose. Existing layout and backend contracts remain intact.
- Dark and light themes pass visual inspection. Native and browser surfaces use the same identity and state language. The design does not reproduce the poster's decorative scenery or illustrative values.
- Functional differences are explicitly recorded as PARTIAL in [m3-visual-comparison.md](C:/Users/<user>/Documents/new/bun-router/m3-visual-comparison.md), including truthful unsupported hardware, dedicated Agents details, and the current navigation structure. These do not prevent the intended design direction or use.
- Evidence includes 26 browser states, 17 native states, 27 sequential motion captures and five actual public phone captures. Desktop and mobile screenshots were also inspected for both dev and the packaged production middleware.
- The [final visual review manifest](C:/Users/<user>/Documents/new/bun-router/test-results/m3/acceptance/visual-review-final.json) records all 70 inspected acceptance captures and their SHA256 hashes. Final verification found no missing images or hash mismatches.
- The first expanded-state screenshot was inadequate and is retained under `attempt-1`. Its replacement asserts `data-expanded=true` and visible Island content after the actual telemetry button is clicked.
- [Main gallery](C:/Users/<user>/Documents/new/bun-router/screenshots/m3/acceptance/index.html) · [Motion gallery](C:/Users/<user>/Documents/new/bun-router/screenshots/m3/acceptance/motion/index.html).

Motion acceptance passes 30 assertions: idle → composer → routing → approval → running → verification → completion, retained real running → failure, collapse/expansion, routing flow and emphasis, journey, activity ribbon, genuine quota interpolation, notification behavior, focus, and Reduced/Off/OS policies. The browser tests project retained real task/event chronology into isolated presentation state; they do not claim to execute new provider work. Native Full/OS/Reduced/Off checks also pass. [Motion evidence](C:/Users/<user>/Documents/new/bun-router/test-results/m3/acceptance/motion-acceptance.json).

No production percentages, plans, quotas, provider states, temperatures, hardware or outputs were invented. The finite 3/5 plan, threshold warning and unavailable voice cases are labelled controlled UI fixtures. Missing sensors, quota and file preview capabilities remain unavailable.

## Backend preservation

- Host, router, provider adapters, SQLite persistence, learning, telemetry, approval, pairing and Stop implementation files remain unchanged. The only new execution-adjacent source change fixes the existing tunnel announcement parser and permits a validated loopback candidate target.
- All 43 original task records remain byte-for-byte identical. Eight additive acceptance tasks are terminal; no verification device remains paired. Telemetry and verified learning continue.
- The original Host instance/PID ended during the usage-limit interruption. On resumption the installed service had already created instance `5b8d70f2-7429-48a1-b418-beacb31441f5`, PID 14188. No acceptance process deliberately restarted it. Persistence survived; the resumed identity stayed unchanged through fresh acceptance. An unchanged original PID is therefore **not** claimed.
- All 93 preserved artifacts, installed v10 files, v10 ZIP, v12 ZIP, deployment pointer and checkpoint archives retain their hashes. The 59-file frozen audit reports only the previously authorized package copy list and the genuine tunnel-manager fix as changes; no unexpected backend changes.
- [Preservation audit](C:/Users/<user>/Documents/new/bun-router/test-results/m3/acceptance/final-audit.json).

## Claude

**CLAUDE_ACCEPTANCE=PASS.** The initial single availability check was blocked by rate limiting and is retained. After resumption the Host's automatic probe reported ready. No additional forced discovery was issued; exactly one real Claude acceptance task ran through normal submission and approval.

```text
PROVIDER=Claude Code
SESSION_ID=e8f79731-bbb5-4c48-ba01-4aa629ab68de
WORKING_DIRECTORY=C:\Users\<user>\Documents\new\bun-router\.bunny-a\validation\m3-acceptance\claude-2026-10-02T18-26-52-419Z
ABSOLUTE_PATH=C:\Users\<user>\Documents\new\bun-router\.bunny-a\validation\m3-acceptance\claude-2026-10-02T18-26-52-419Z\bunny_m3_claude_test.txt
CONTENT=BUNNY_A_M3_CLAUDE_OK
EXIT_STATUS=0
RESULT=PASS
```

The real Claude adapter exited successfully. The file was independently read from disk and verified by Bunny. Approval preceded launch, genuine activity arrived, the task completed, and the Host remained healthy. The session ID comes from the actual Host/provider stream; the provider's prose said unknown. Fresh session-reported quota evidence is retained separately from the earlier stale quota report. [Claude proof](C:/Users/<user>/Documents/new/bun-router/test-results/m3/acceptance/claude-acceptance-resumed.json).

## Public HTTPS

- Endpoint: [Bunny-A phone companion](https://silent-ceo-films-cal.trycloudflare.com/?companion=1).
- **REMOTE_TRANSPORT=TEMPORARY_QUICK_TUNNEL.** This is an approved development transport, with no permanent hostname or production availability guarantee.
- Eleven checks passed through real DNS and certificate-validated TLS 1.3. Fresh unpaired visitors see pairing and cannot access workstation status/history, submit tasks, or read the local QA identity endpoint. Cross-origin pairing and remote project registration remain refused.
- A disposable verification phone paired through the actual public form with a Secure, HttpOnly, SameSite=Strict cookie. Actual workstation/providers/tasks/telemetry appeared.
- Task `8b6f3709-9913-474d-8af8-69fbd0d696b4` remained unstarted at `waiting_for_approval`. Explicit approval launched the real Ollama cloud model; exact companion output was `BUNNY_A_M3_PUBLIC_HTTPS_OK`.
- The verification device was revoked, immediately lost data access, and returned to pairing. No cookie, pairing code or Host credential was written to evidence.
- Only identity-verified expired Bunny tunnel processes were replaced. Current manager 27924/cloudflared child 7352 target the final M3 candidate on loopback 8085. Installed gateway 8084 and v10 remain preserved.
- [Public HTTPS proof](C:/Users/<user>/Documents/new/bun-router/test-results/m3/public-https-acceptance.json) · [Network report](C:/Users/<user>/Documents/new/bun-router/test-results/m3/public-https-report.md).

## Tests

| Gate | Result |
|---|---|
| Unit/regression | 320 passed: 205 script + 103 application/Host + 12 UI; zero failures. Baseline 314 retained plus six tunnel tests. |
| Typecheck | PASS |
| Full repository lint | PASS; zero errors, ten existing warning-level findings. Archived generated checkpoint bundles are excluded; current source remains checked. |
| Default production build | PASS |
| Standalone Windows candidate build | PASS |
| Dev and packaged browser render | Desktop/mobile visible, no horizontal overflow or uncaught application errors; final built comparison does not diverge from dev. |
| Native final-package review | 17 captures; layout and Full/OS/Reduced/Off checks PASS. |
| Motion | 30 assertions and 27 sequential captures PASS. |
| Actual integrations | Codex, automatic routing, independent file verification, Ollama, Claude, approval, Stop isolation, reconnect, real usage/telemetry and public phone flow PASS. |

The initial pre-interruption Stop integration failed its immediate OS/session-ended assertion and is preserved as failure evidence. After the installed service resumed, the dedicated fresh Stop/reconnect test proved all ten recorded processes in the selected Codex tree ended, with no survivors and the unapproved peer unchanged. No provider execution code was changed to force a pass. [Original attempt](C:/Users/<user>/Documents/new/bun-router/test-results/m3/acceptance/backend-integration.json) · [Fresh Stop proof](C:/Users/<user>/Documents/new/bun-router/test-results/m3/acceptance/backend-stop-retest.json).

The external Grok branding script is blocked by this environment (`ERR_NETWORK_ACCESS_DENIED`). It remains present. Application exceptions, hydration and local module/asset failures were absent. The share-card checker emits its existing soft placeholder note. An earlier dev/built baseline comparison differed because the public test added a real task between captures; the final stable pair passes without altering values.

## Package

- Candidate: [Bunny-A-Windows-v13-M3-Acceptance.zip](C:/Users/<user>/Documents/new/bun-router/releases/Bunny-A-Windows-v13-M3-Acceptance.zip).
- Directory: `C:\Users\<user>\Documents\new\bun-router\releases\Bunny-A-Windows-v13-M3-Acceptance`.
- SHA256: `5AFFE4BFEF205A90DE4189326D2293CE5B370D6D7C33C3B37594E58FF0B68D91`.
- New package was necessary because focused UI source fixes changed the candidate. Packaged native UI and backend source hashes match the tested workspace source.
- Installed v10 and its deployment pointer are untouched. Prior v12 package and evidence are preserved. The M3 candidate is running in the existing review browser; dev and the approved temporary companion transport are left available.

## Remaining blockers

None for the current M3 development acceptance. Temporary tunnel lifetime, unsupported sensor readings, unavailable browser file opening/native speech, and the blocked external branding asset are stated limitations. A production named tunnel is outside this development acceptance.

## Verdict

**M3_PASS.** All requested acceptance areas have concrete evidence. The continuation follow-up remains PAUSED and will not repeat completed work.

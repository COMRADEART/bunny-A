# Physical performance and accessibility observations

Android 17 / API 37; samsung SM-S948U; arm64-v8a.

- Native am start -W returned Status ok and LaunchState COLD. One Android Activity Manager measurement: TotalTime 161 ms; WaitTime 166 ms. These are launch instrumentation values from one run, not input/render/streaming latency or a performance benchmark.
- Candidate process remains alive; filtered app AndroidRuntime crash-marker query returned none at collection time. No broad crash-free/stability certification.
- Verified native portrait/landscape connection and error screens, observed taps, address keyboard and Back dismissal, help open/dismiss, landscape scrolling, and background/foreground recovery. Earlier foreground loss resolved when the user left the phone untouched. Saved connection reports unreachable computer; no candidate workstation pairing or authenticated streaming was tested. Original rotation lock 0 restored.
- Portrait, landscape, keyboard opening/dismissal, touch-target usability, connection-state readability, rotation, background/foreground and Android Back: see interaction-observations.json for individually executed checks.
- Observed primary native buttons are 180 px tall at density 600 dpi (48 dp). Portrait and landscape primary controls remain inside the observed app viewport; landscape controls are reachable by vertical scrolling. Connection labels and error text are readable; saved address is masked only in evidence. TalkBack and authenticated dashboard accessibility were not tested.
- Android Back dismissal is confirmed by visually reviewed before/after screenshots with matching full app pixels. The first unscoped IME visibility flag remained true; that collector ambiguity is retained in interaction-initial-observations.json and resolved by actual screen evidence.
- Task streaming responsiveness and authenticated reconnect behavior: BLOCKED by candidate HTTPS/compatibility prerequisites. No latency invented.

Only reviewed sanitized native captures may be retained. Raw UI dumps and personal device content are not published.

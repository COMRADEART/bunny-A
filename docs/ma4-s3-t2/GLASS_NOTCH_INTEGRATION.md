# Glass notch integration

The Island status is still `islandPresence`. It only names a state the caller can support with Host facts. Offline wins, then an approval, then a fresh voice phase, then the existing task events.

## Voice words added

From `notchVoicePhase`, which returns null when the snapshot is closed or older than the fresh window:

| Snapshot evidence | Notch |
| --- | --- |
| error, `ERROR`, or `DEVICE_UNAVAILABLE` | Error |
| `INTERRUPTED` | Interrupted |
| playback confirmed | Speaking, or "Listening and speaking" when capture is also confirmed |
| `PROCESSING` or `TRANSCRIBING` | Processing |
| capture confirmed | Listening |
| open and idle | no voice word; task facts can show |

The Windows notch maps the same headlines in `Get-BunnyNotchStatus`. Processing is no longer rewritten to "Thinking". Bars still move only from a fresh `snapshot.level` while capture is confirmed.

## Agents

Horizontal edges already place the agent strip on the left. Vertical edges place it on top (`Get-BunnyPlacement` in `install/Bunny-Island.Placement.ps1`). That placement was not changed. Weapon characters and provider marks stay on their existing art paths.

## Accessibility

The status line includes the word "Status:" plus the title. WPF voice controls already have `AutomationProperties.Name`. Narrator was not run. Reduced motion is unchanged: the voice layer still has no storyboard, and level bars are data, not a loop. Multi-monitor placement was not remeasured; the placement function is still in DIPs from the work area it is given.

Approval required, Agent working, Multi-agent work, Completed, Failed, and Offline remain the task states. A non-live view stays offline even if a voice phase was passed in.

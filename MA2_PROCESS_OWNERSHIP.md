# Bunny-A M-A-2 process ownership

## T1 maintenance

The migration controller records each owned process before Stop.
The record contains the PID, parent PID, executable, command line and creation time.
The controller checks this identity again before Stop.
A changed identity stops the migration.

Host ownership also requires the saved credential and live instance ID.
Gateway ownership requires the recorded state root and installed server path.
Tunnel ownership requires the pinned worker path and recorded child relationship.
An unknown tunnel owner causes refusal.

The controller does not stop processes by name or port.
The M3 QA server is outside the owned process set.

The real cutover stopped Host PID 9984 and gateway PID 14532 only.
Both used the installed v16 runtime before Stop.
The new Host is PID 2200. The new gateway is PID 42156.
Both use the installed T1 runtime.
M3 QA PID 11020 kept its executable, command line and creation time.
Its creation time is `2026-10-03T03:49:11.7887020Z`.
Island and tunnel processes were absent before migration.
The migration left them absent.

## T4 work

Gate T4 is NOT IMPLEMENTED in this T1 change.
The accepted Git launcher repair remains in place.
The second launcher and hook process ownership need further tests.
Host crash cleanup for hook descendants is NOT TESTED.

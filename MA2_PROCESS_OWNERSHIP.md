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

## T4 work

Gate T4 is NOT IMPLEMENTED in this T1 change.
The accepted Git launcher repair remains in place.
The second launcher and hook process ownership need further tests.
Host crash cleanup for hook descendants is NOT TESTED.

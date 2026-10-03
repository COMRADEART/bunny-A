# Bunny-A M-A-2 operational security

## T1 controls

The installed launcher checks the manifest hash against `install.json`.
It checks the complete installed file inventory.
It checks the shared state helper before it executes that helper.
Missing, changed or unexpected release files cause refusal.

The launcher refuses an existing Host with a different runtime path.
It does not kill that Host.
State cannot use a directory link or a critical file link.
The Host refuses a missing database, damaged database or unknown schema.

Cloudflared has a recorded binary hash.
Both launcher and worker check the client.
The migration preserves local credentials and paired-device records.
The reports contain row fingerprints and file hashes. They do not contain bearer tokens.

Mission and capability authority checks stay unchanged.
Missions and triggers must retain their pre-migration flags.

## Open gates

T3 must add fatal-error containment.
T4 must complete Windows Git process ownership.
T9 must define bounded desktop approval policy.
T10 must test the completed operational architecture.
This T1 change does not certify those gates.

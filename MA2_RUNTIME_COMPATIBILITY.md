# Bunny-A M-A-2 runtime compatibility

Gate T2 is NOT IMPLEMENTED in this T1 change.

The accepted Codex security validation used `codex-cli 0.153.4`.
T1 does not certify a different Codex version.
T2 must record the executable, version and security capabilities.
Unknown versions must fail closed for hardened Mission execution.

The T1 package uses an exact source commit and an installed Node runtime.
State layout 2 requires Host database schema 3.
The Host checks the schema fingerprint before writable startup.
A missing or damaged database cannot become an empty production database.

The cloudflared record contains the copied binary hash and version.
The launcher and worker refuse a missing or changed client.
Ordinary startup does not download a replacement client.

The manifest records the source SHA, tooling SHA and file hashes.
The final installed identities will be in the implementation report.

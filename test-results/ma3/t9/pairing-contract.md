# Pairing contract

The workstation creates a one-time 96-bit code with ten-minute lifetime. /api/bunny-pair validates configured HTTPS origin and the loopback connector peer, then exchanges the code at the existing Host /pair endpoint. The gateway sets a HttpOnly, Secure, SameSite=Strict cookie. A device never receives the master credential. The Host stores only the device credential hash.

Each protected read, command admission and event delivery authenticates the device row, revocation and expiry. The maximum session lifetime is 365 days; 30 days idle also expires it. Presence is additive and cannot extend absolute lifetime. DELETE on the pairing endpoint revokes this device before expiring its cookie. A device may not revoke another device, create pairing codes, or silently repair a revoked session.

Physical-phone pairing form, trusted production TLS, mobile browser cookie persistence and background suspension: NOT TESTED. The protocol and disposable browser adapter receipts are separately labeled.

# Live security results

- **Observed:** selected authorized physical ADB session; exact candidate installed APK hash; valid APK v2/v3 signature; only installed INTERNET permission; no app storage clear, downgrade or uninstall.
- **Observed blocker:** installed gateway source 8145377880fa4ab330238db827fa488430b2328d differs from candidate b23005136c48036968036475e841dcf67a38a794; ten relevant mission source hashes differ and no phone/API compatibility attestation exists. Pairing was correctly withheld. This is an unmet acceptance prerequisite, not proof of an exploitable incompatibility.
- **Observed blocker:** prior HTTPS configuration missing; current TLS/remote authentication and phone reachability cannot be assessed. TLS bypass, cleartext public exposure and authorization changes were not used.
- **Software support only:** fresh APK manifest inspection; 21 Java origin-policy tests passed; WebView source disables mixed content, file/content access and third-party cookies and cancels SSL errors. These are not live phone network security proofs.
- **NOT TESTED ON PHONE:** Bunny-A code expiry/single use/rate limiting, device session authorization/scope, reconnect validation, revocation, stale approval rejection, remote privilege escalation and workstation-only authority. All remain mandatory.
- **No confirmed critical app/security defect** from completed checks. Absence of a detected crash or security violation in limited native-launch checks is not a security PASS.

Prior T13 security receipts remain unchanged and their limits remain intact. No synthetic task, mock authentication, simulated expiry clock, new authority grant or destructive task was used. Evidence excludes serials, phone addresses, pairing codes, tokens, signing secrets and unrelated phone content.

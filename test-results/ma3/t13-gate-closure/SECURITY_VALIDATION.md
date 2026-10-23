# T13 security validation

Source `b23005136c48036968036475e841dcf67a38a794`; no authorization, transport, provider or production logic changes.

| Scope | Result | Evidence / limitation |
|---|---|---|
| Entire configured software pipeline | PASS, exit 0 | test-final.log; includes remote-device, remote-remediation, remote-authority, routing and PKCE tests. |
| Pairing and credential HTTP boundary | 8/8 PASS | pairing-security.json: anonymous read rejected (401), workstation-only code, successful software pairing/authentication/device listing, reused code rejected (403), owner-header forgery refused (400), expired code rejected (403), revoked read rejected (401). Disposable real Host HTTP; **software client**, expiry clock SIMULATED +600001ms. |
| Existing real HTTPS gateway | PASS for installed transport availability only | transport-probe.json: normal certificate validation, health 200, anonymous stream 401, clickjacking/referrer headers present. Installed manifest declares 8145377880fa4ab330238db827fa488430b2328d; this is not candidate-source gateway acceptance. No credential sent or response body retained. |
| APK signature and identity | PASS | android-checks/verify-existing-apk.log, apk-manifest.log; v2/v3 verified; v1 false disclosed. This is not a new APK-source reproducibility claim. |
| Android address boundary | 21 checks PASS | android-checks/address-policy.log; unsafe origins/cleartext/credential/query/fragment/loopback/lookalikes refused. |
| Device/canonical approval scope, cross-Project/Agent/Mission, stale/replay/restart, revocation, provider restrictions | PASS in full software pipeline | test-final.log and copied receipts/*.json; genuine disposable Host/SQLite/filesystem; scripted adapters or simulated scheduling explicitly remain software evidence. |
| CSRF/state/replay and provider URL PKCE checks | 8/8 in full library lane | oauth-pkce.test.ts test names in test-final.log; exchanges are explicitly SIMULATED, not live provider authentication. |
| Dev/build auth invariant | PASS, sign-in off agrees | auth-final.log; app-level sign-in off does not remove Host/device authentication. Initial sandbox observation was indeterminate, exit 2, retained in auth.log. |
| Offline UI boundary | PASS in workstation browser | Tasks/Agents/Projects navigate; theme mutation refused offline and disabled project controls remain disabled. No task submitted. |
| Physical Android authentication/approval/bypass matrix | BLOCKED | All 15 physical checks require actual authorized handset evidence. |

Native Android source review: manifest disables cleartext and backup, requests Internet only; MainActivity disables file/content access, mixed content and third-party cookies and rejects SSL errors. No JavaScript-to-native bridge was added. This review is STATIC; actual handset WebView behavior and persistence remain untested.

Evidence capture uses per-line secret redaction; final retained-file scan records pattern names and locations only in secret-scan.json. No pairing code, bearer, cookie, private signing key/password or remote origin is intentionally stored. Existing signing state was not read. No credentials rotated, permissions broadened, installed service restarted or network exposure created. No blanket security certification is claimed: hardware checks remain a mandatory gate.

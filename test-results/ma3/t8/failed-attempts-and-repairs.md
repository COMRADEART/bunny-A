# Retained attempts and repairs

- Initial baseline/native/SQLite/Chromium tests encountered sandbox TEMP/network/CIM restrictions. Original failed logs are retained alongside approved reruns. Approved execution used the same tests and isolated fixture inputs, without auth bypasses.
- typecheck-attempt1.log: missing JSX delimiter in Models layout; corrected. typecheck-attempt2.log: nonexistent OrchTask.route fields; changed to actual canonical routeDecision shape. Final typecheck passes.
- lint-attempt1.log: additional implementation warnings; fixed newly introduced unused symbols/effect dependencies. Final lane has zero errors, 23 warnings, including 22 pre-existing and one export Fast Refresh warning.
- review-fixture.log: seed helper selected an older same-name Agent during repeated fixture setup; changed selection to the newest returned Agent. review-fixture.json records three new requests staying pending without approval for five seconds. No runtime auto-approval conclusion is inferred from this setup failure.
- Visual review found imported @theme tokens were not expanded as expected. Explicit scoped semantic variables repaired actual radii/type/spacing. Existing platform branding is preserved.
- Visual review found web preferences for native-only Island presentation had no web behavior; removed those inert controls and retained actual theme/motion controls.
- An early native screenshot did not visibly expose offline state when collapsed. Final source 987afeace77520b9f4ef49e27b137dd01fb3fee8 makes CompactHealth visible; native-offline.json and screenshot verify the repaired final package.
- Project loading briefly displayed a zero-item count. Final source uses Loading Projects… until the Host list arrives. Final Project screenshots were captured after actual rows appeared.
- Initial stream probe sandbox network rejection and unsupported fetch Host-header override were discarded as a test-harness assumption; the final probe uses actual peer/origin/fetch metadata and verifies four fail-closed requests plus authenticated redacted replay. No authentication weakening was applied.
- R1/R2/R3 local test packages preceded final fixes. Only R4 is final-source acceptance. Package payloads are intentionally excluded from the evidence commit; all retained metadata and logs identify actual provenance. Packaging still carries legacy v26 semantic-version/release-pin metadata; the named R4 TEST package explicitly pins T8 source/tooling and is not installed or claimed as a release candidate.


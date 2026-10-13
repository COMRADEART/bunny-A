# BUNNY-A MA3 T7 — Project Organization and Durable Agent Workspaces

Verdict: **BUNNY_MA3_T7_PASS_WITH_LIMITATIONS**.

T7 extends the existing Host registry and AgentRuntime. Real disposable Windows Hosts verified registration, file preservation, durable scratch, authorized context, independently verified capability execution, Project UI actions and genuine restart recovery. No unresolved BLOCKER/HIGH authority defect remains in the exercised boundaries.

The limitations are material: arbitrary autonomous model planning and live provider execution were not tested in the T7 Mission. A complete initial T7 byte snapshot of mutable production data was not collected. Final read-only checks establish installed release integrity, unchanged observed process lifetimes, schema membership/disabled flags and protected user-file integrity; full initial-to-final byte equality of mutable SQLite, Phone credentials, provider configuration and OS Startup is not claimed.

## Source and baseline

- Branch: codex/ma3-t7-project-workspaces.
- Executable/source pin: **8b71167ba13de496ba25a6f78a7c70e99b388284**.
- Implementation commit: 6d299065109af4fd33bee14e7d7b1806a24158fd.
- The pin adds only a new-test correction: the retention fixture deliberately inserts one stopped Agent, so its count must be one.
- Starting HEAD: 697d9abb8de5ed3e85de6f323e5486e76347f356, an evidence-only descendant of accepted T6 executable b3ae2f52aa5b62cd8bbbcca1c9fd37c45c61bd7f.
- Source changes: **26 files**. Exact names/statistics and retained-test Git blob hashes are in source-provenance.json and regression-inventory.json.

The files comprise attributes/package scripts, the disposable Host fixture, three Projects UI/model/style files, new registry/path/context/workspace/service/type modules, two new T7 tests, and integration edits to desktop navigation, AgentRuntime/AgentStore, TaskManager, Host HTTP/presentation, MissionManager, capability bus/filesystem, orchestration types/bridge and Island state. Existing core formatting broadened the diff; it did not replace the existing scheduler, router, permission, event, memory or artifact authorities. No existing test/assertion changed. Protected untracked reports and memory/t7-signout-done.md remain unchanged and unstaged.

## Registry and migration

The existing projects(id,record) table remains canonical. **ma3.projects.v1** retains ID/path and adds description, timestamps/activity, lifecycle, source/type, owner scope, tags, favorite, directory identity, revision and attention. Vocabulary: ACTIVE, INACTIVE, ARCHIVED, MISSING_ROOT, NEEDS_RELINK; root loss/replacement currently projects NEEDS_RELINK.

Projects do not own models. Legacy preferred becomes auto; TaskManager and routing-policy-v1 select each model-backed Task independently.

Registration validates canonical directory identity and writes metadata only. It preserves the folder in place, runs no scripts/install/Git initialization/fetch and copies/renames no user files. The same proven directory deduplicates registration; similar names/remotes never merge distinct roots. Explicit empty creation allocates a UUID directory beneath configured workspace/projects.

Rename/favorite/tags/archive/restore update revision-checked metadata. Archive retains files and canonical work/history; restore keeps IDs and revives neither stopped/completed work nor consent. Legacy remove archives. Relink requires explicit confirmation, current revision, valid identity, no competing root and no active Mission. Historical Missions retain their frozen root.

Migration adds columns/indexes transactionally, retains IDs and malformed original bytes, and quarantines ambiguity without merging or assigning unrelated Missions. Disposable real SQLite tests cover new/populated/repeat/interrupted/malformed/duplicate-root cases. Injected interruption rolls back exact row bytes and retries successfully. Production was not migrated. Rollback remains a separately reviewed consistent SQLite+WAL backup and matching-source restoration; no destructive down migration exists.

Evidence: project-schema.md, migration-audit.json, t7-final.log.

## Workspaces, context and isolation

Subordinate agent_workspaces metadata uniquely binds Agent/Mission, pins Project/configured-root/owned-root/scratch identities, owner UUID, manifest revision/hash, state and timestamps. Layout follows the actual configured root: agents/<Agent UUID>/<Mission UUID>/scratch. User roots, scratch, reviewed worktrees and existing artifact storage remain separate domains.

Atomic staging/rename and transactional publication refuse collisions. Admission/recovery checks ancestor links/junctions, identity, ownership marker and manifest hash. UNC/device/ADS/reserved/trailing-dot paths, traversal, prefix cousins and cross-root hard links fail closed. Bounds: **64 MB, 1,000 entries, depth 12**, including proposed writes. Replaced/unknown ownership becomes CONTEXT_CHANGED and recovery stops for review. Cleanup always refuses pending a separate reviewed operation. Existing WorkspaceCoordinator exclusive locks protect shared-root mutation.

ProjectContextResolver binds current Project/Mission/Agent/workspace/step and actual model Task at admission. It records identity, HEAD reference, explicit file hashes, dependency artifacts, version/provenance and consent ID/revision/generation as observations, never grants.

Bounds: **12 files, 64 KB aggregate observation, 24 dependency artifacts, 16 KB snapshot, 20 retained snapshots per step**. Private Host state, sensitive filenames, browser profiles, links and other-Agent scratch are excluded. No raw selected content, hidden reasoning or secret-bearing prompts are exported in snapshots. No repository/README automatic upload or duplicate memory authority exists. Root/file/branch drift is revalidated, including model admission; changed HEAD under the same consent requires fresh review.

Exact T5 identity/operation/budget/revision/generation remains authoritative. Project membership/text grants no capability. Project B root/artifact access without exact current scope is refused. Actual TaskManager/T3 selects two different eligible models for one Project using **SIMULATED discovery probes**, with zero execution.

Evidence: workspace-contract.md, workspace-isolation-matrix.json, project-context-contract.md, project-context-provenance.json.

## Real Mission and restart

Two disposable Git repositories and real isolated Windows Hosts run with zero model providers. A's Agent acquires owned scratch, resolves approved context, reads an approved file, inspects reviewed Git status, writes a disposable result, runs a bounded reviewed Node check and saves a report. Independent observations verify all outputs.

All **five deterministic steps** complete: nine capability runs, **two writes, one terminal operation**, 12 canonical artifacts. B stays unchanged and receives neither A context nor artifacts. Correct-Project artifact opening hash-checks provenance; cross-Project open is denied.

The first Host genuinely closes; a new PID/generation reopens the same state. Project/Agent/Mission/workspace identities, completed steps, **34 checkpoints** and artifacts persist. Completed work stays completed, stale consent is refused and duplicate side effects are **zero**.

Planning: **NOT TESTED — preauthored deterministic graph**. Model execution: **NOT TESTED — zero calls**. Canonical steps/capability runs are recorded; this fixture admits zero model-backed OrchTasks. This proves authorized capability integration and recovery, not arbitrary autonomous planning.

Evidence: integrated-project-mission.json, restart-recovery.json, agent-project-links.json, artifact-provenance.json.

## Real Projects UI

Semantic controls against the built dashboard and disposable Host exercised registration, empty creation, opening, favorite, name/tag search, sort, filters, pending/completed Agent display, Mission/step history, verified artifact opening, archive/restore, missing-root display and explicit-confirmation relink. API/read-only SQLite audit corroborates durable records/events after these actions and a UI Host restart.

Overview, Agents, Missions / Tasks, Files / Workspace, Artifacts and Activity use bounded canonical projections. UI Project pages hold 24 records; API maxima are 100 with bounded offsets. Task/provider/verification fields reflect actual facts. Private prompts/output/diagnostics/checkpoint detail are redacted; artifact opening is separately bounded and hash-checked.

Light/dark **1280×800, 1920×1080, 390×844** checks have no horizontal overflow. Keyboard focus, empty search, pagination, genuinely offline Host and a **>260-character Windows root** were exercised. The long reference wraps visibly on mobile. Real loading transitions were observed; artificial latency injection and populated live-provider history were NOT TESTED.

Dev/built smoke shows visible content and zero console/page errors. Final same-fixture comparison has no divergence. Earlier mismatched-data comparisons are retained. Available CUA drove interaction because agent-browser CLI was unavailable. Existing global chrome remains outside T8 scope.

Evidence: project-ui-acceptance.json, ui-responsive.json, ui-host-restart.json, long-path-project.json, screenshots and smoke logs.

## Gates and package

| Gate | Result |
|---|---|
| Scripts | 256 PASS |
| Library | 650 PASS |
| Agent | 24 PASS |
| UI | 59 PASS |
| Distinct total | **989 PASS; 0 fail; 0 skip** |
| Existing baseline | 950 retained unchanged |
| T7 addition | 38 focused + 1 live = 39 |
| Explicit security reruns | 222 PASS + 24 Agent recovery PASS |
| TypeScript | PASS |
| ESLint | PASS; 0 errors, 22 pre-existing warnings |
| Desktop production build | PASS |
| Windows package | PASS; 358 manifest files |
| Adversarial matrix | **68 PASS**, classifications/limits explicit |

Focused reruns are not double-counted. Explicit regressions cover held-process ownership, SSE/device revocation, MA2 restart consent, T9/T9R, T1/T2/T3, T4 recovery/duplicate prevention, T5 finite authorization/private state and T6 path/junction/Git/browser-network/cross-app boundaries.

Bunny-A-Windows-v28-MA3-T7-test is built from the exact source/tooling pin with its dashboard, bundled Node, ownership addon and browser runtime. Its own Node verifies import closure (85 source files), source matching, real browser navigation/read and registry registration. All **358** manifest files match with no missing/changed/extra files. It remains disposable output, **not installed**. Binary payloads are excluded from evidence Git staging; package-manifest.json seals their bytes.

## Historical failures and repairs

- Windows sandbox temp/process/browser restrictions: retained failures, ordinary approved reruns; baseline 950 passed.
- Type/lint integration failures: repaired narrowing/JSON projection and path-control-character guard; final checks pass.
- Incorrect force-exit/socket handling in first integration attempts: restored appropriate runner lanes.
- T7 briefly changed T5 refusal ordering and standalone scratch location: restored T5 precedence and Mission-state/workspace fallback.
- Existing T5 presentation regression found T7 generic command-data leakage: explicit Project-action whitelist repaired it. Original assertions untouched; new T7 regression added.
- Harmless pre-existing Git-helper fixture cleanup hit EPERM during concurrent suites: unchanged isolated five-test rerun passed; isolated final full regression passed.
- New stopped-Agent retention fixture expected zero after inserting one: corrected only the new count and reran.
- UI seed omitted independent verification and was correctly rejected: stopped rejected disposable fixture via API and created valid waiting Agent.
- Mission links selected absent desktop sheet: repaired to existing Home detail and verified.
- Initial built baseline unavailable; later fixture data mismatch: final same-fixture comparison clean.
- Initial production probe used sandbox-shadowed LOCALAPPDATA and was NOT TESTED: final absolute-path read-only audit, incomplete initial snapshot disclosed.
- Automatic approval review usage limit prevented one fixture command from executing: ordinary retry after user continuation succeeded.
- Evidence assembly compared Windows line endings to raw Git bytes: corrected to Git-filtered object hashes; all old tests unchanged.

All failed logs are retained. Seventeen generated historical T5/T6 files were copied under T7 before exact restoration from starting HEAD. No destructive reset/clean occurred.

## Production and limitations

Read-only audit verifies **160** installed v26 manifest files, unchanged schema membership, zero Project rows, Missions/Triggers disabled and unchanged startup.sh hash. Initial T7 PIDs **13672/23016**, parent **22328**, executable paths and creation times remain the same. T6's prior unexplained rotation remains unexplained; no normalization restart/kill occurred.

No production migration/restart, Startup edit, tunnel activation, Phone credential/provider edit, feature activation, package installation, deployment or Git push was performed. Full initial-to-final mutable production byte equality remains **NOT TESTED** because the initial snapshot was not collected.

Inherited T5/T6 limits remain. No unrestricted Git/worktree writes, arbitrary desktop/browser execution, team collaboration, voice, Phone Agent control, global redesign or MA3 production readiness is claimed. **T8 was not started**.

## Evidence seal

Evidence: **test-results/ma3/t7/**. INDEX.md describes files; INDEX.sha256 seals included report/provenance/logs/JSON/screenshots. Package payload is independently sealed by its release manifest. Ephemeral credentials/state and live append-only UI Host logs are excluded. The root report and evidence copy have identical bytes.

The local evidence commit follows the source pin and contains audit material only. Checksums are verified before/after commit. Final Git status retains only protected untracked user reports/memory.

**BUNNY_MA3_T7_PASS_WITH_LIMITATIONS**

# Bunny-A M-A-2 architecture

This record covers Gate T1. Gates T2 through T10 remain open.
The production T1 migration passed on 3 October 2026.

## Accepted baseline

| Item | Identity |
|---|---|
| M-A-0 freeze | `180ab234b2e81e7745e7402c4eb9483586c36eab` |
| M-A-1 application | `f1934bda6b0d33f27bef198e8967a69f6eb329ff` |
| M-A-1D tools | `be6e2e56c627a8969b7ecc1c9d992737710d5c11` |
| M-A-1D documents | `2a8a9eac98acddb6b1b660ba7e59d923c849e358` |
| Branch before T1 | `ma1-live-acceptance` |
| M-A-2 branch | `ma2-operational-hardening` |
| Independent baseline result | `BUNNY_MA1D_PROMOTION_APPROVED_WITH_LIMITATIONS` |

The accepted commits stay unchanged. The two existing untracked review files stay in place.

The installed T1 source is `898c52cbb439cbaa738f6a44e89ca4c526591cc9`.
The installed tooling is `e7f82de8f82fb427bc00fdb19a715b58df32fadf`.
The release name is `Bunny-A-Windows-v17-T1`.
This release name identifies the T1 checkpoint. It does not imply full M-A-2 acceptance.

## Installed state layout

The canonical state root is `%LOCALAPPDATA%\Bunny-A\state`.
This root is a real directory. It contains no junction to the development repository.

```text
Bunny-A/
  install.json
  releases/                 immutable runtime packages
  state/
    host.sqlite             Host schema 3
    host.sqlite-wal         SQLite owns this file when needed
    host.sqlite-shm         SQLite owns this file when needed
    state-layout.json       state path and schema fingerprint
    credentials/            local Host credential
    settings/               gateway, consent, remote and Island settings
    runtime/                tunnel process record and screenshots
    cloudflared/            client binary and hash/version record
    logs/                   current logs and previous log files
    backups/                existing backups and future state backups
    sessions/               raw provider transcripts
    provider-observations/  reserved provider evidence location
    validation/             retained validation workspaces
    ...                     other existing state directories
  backups/                  complete T1 cutover and recovery records
  rollback/                 release configuration rollback records
```

This layout follows the first Gate 1 target. Tools and logs stay below the canonical state root.
The full M-A-2 brief also permits application-owned tool directories. All listed locations are outside Git.

## Runtime contract

`install.json` uses `bunny-install/2` and `stateLayoutVersion: 2`.
`dataDirectory` equals `stateRoot`.
The launcher sets the state path, credential path and default workspace explicitly.
The Host checks its state marker and database schema before it opens a writable database.
The installed entry points refuse legacy state fallback.

The default workspace stays `C:\Users\allam\Bunny-Workspace`.
The development repository remains an explicit project when the user selects it.
Historical task paths remain in the database as evidence.

## Change limits

T1 changes state paths and deployment checks.
It does not change Mission scheduling, task routing, provider authority or capability grants.
The gateway remains the installed v10 dashboard until T5.
T6 must test the public tunnel. T7 must test real Windows sign-in.

## Report language

The reports use short sentences and active voice.
Technical names keep their code spelling.
The reference is [ASD-STE100 Issue 9](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf).
A complete controlled-dictionary check is NOT TESTED.

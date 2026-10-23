# MA4-S2-T2 — Local file connector

`ma4/connectors/files.server.ts`. Tests: `ma4-s2t2-files.test.ts` (T2-F1…F13), workflows A and C.

## Folders ("roots")

The owner registers folders on the workstation (`connector.roots.set`, workstation-only). Tasks see only the root id.
Registration refuses: relative paths; anything that is not an existing directory; a folder that is itself a link or
whose real path differs from the given path; a whole drive; system and application folders (`%SystemRoot%`,
`Program Files`, `ProgramData`, `%APPDATA%`, `%LOCALAPPDATA%`, `/etc`, `/usr`, …); the user's whole home folder; any
folder that contains or sits inside the Host's own state (data, credentials, logs, runtime). A grant names a root id and
`read` or `write`; the root must be registered at creation **and** at execution (unregistering it stops a task that was
already granted it: T2-F4, `PERMISSION_DENIED`, nothing read).

## Path and handle validation (not string prefixes)

1. **Parse**, at task creation (zod refine) and again at run: plain relative segments only — no `..`/`.`/empty parts,
   drive letters, UNC or absolute paths, `:` (alternate data streams), `<>"|?*` or control characters, trailing dot or
   space, device names (`CON`, `NUL`, `COM1`…), 8.3 aliases (`~1`), more than 24 parts or 400 characters.
2. **Walk** from the root with `lstat` on every component: a symlink or junction anywhere is refused; protected names
   are refused before they are touched.
3. **Real path equality:** `realpath.native(walked) === walked` — catches reparse points that `lstat` does not report.
4. **Hard links:** a file with `nlink > 1` is refused (it may point outside the root).
5. **Handle identity:** the file is opened, `fstat(fd)` must have the walked file's `dev`+`ino` (bigint) and still be a
   single-link regular file, then read through that handle — a swap between the checks and the read is refused.

## Content rules

* Protected (never listed, searched or read): `.env*`, keys and certificates (`*.pem`, `*.key`, `*.pfx`, `id_rsa*`…),
  `.npmrc`, `.netrc`, `.git-credentials`, `credentials*`, `*secret(s).json|yaml|toml|txt`, cookie and browser login
  stores; folders `.git`, `.ssh`, `.aws`, `.azure`, `.gnupg`, `.kube`, `.docker`, `.config`, `node_modules`.
* Text only (a NUL byte in the first 8 KB = binary, refused); files over 1 MiB refused; reads return at most 40,000
  characters with `truncated`; search visits at most 2,000 files / 32 MiB; listings at most 500 entries.
* Secret-shaped lines in content are redacted by the broker (T2-F11).
* Errors name the root id and the relative path the task gave — never an absolute path. Receipts carry no paths
  outside the task's own relative input (T2-F1 checks the absolute test folder never appears).

## Operations

`file.list`, `file.read` (content + SHA-256 version), `file.stat`, `file.search` (names, optionally content),
`file.changes` (files modified in the last N hours, with versions and short excerpts — the "what changed" analysis),
`file.prepare` (line diff of proposed new content; writes nothing), `file.apply` (consequential).

### Apply (consequential, idempotent by condition)

* New content comes from a literal (≤ 8,000 chars) or `contentFrom` = a generating step's raw text (a connector
  result is refused as content); ≤ 256 KiB.
* `prepare()` reads the current version; the payload `{root, path, expectedSha256, newSha256}` is what the owner
  approves (preview = line diff). Optional `expectedSha256` in the spec pins the version the plan was made against.
* At execution: the current version must equal the approved one **and** the new content must hash to the approved one,
  else nothing is written and the task returns to a fresh proposal (T2-F8). Then: backup of the old file to
  `<Host data>/connector-backups/<task>/`, write a temp file (`O_EXCL`) in the same folder, `fsync`, a **second**
  version check, `rename` over the target (atomic on NTFS and POSIX). No temp file survives (T2-F7).
* Recovery: `verify()` compares the file's version to the approved new version — found ⇒ success without writing
  again; absent ⇒ the same approval may write once (T2-F9, crash at all four boundaries, ≤ 1 dispatch).

## Acceptance example ("check my approved project folder and summarize what changed")

Workflow A (END_TO_END_QUALIFICATION.md): permitted folder confirmed by grant + registry; `file.changes` enumerates only
allowed files (`.env` excluded); `file.read` within scope; Worker summary; Reviewer check; versions recorded as
evidence hashes and receipts; nothing modified or uploaded.

## Known limits

* A residual window remains between the second version check and `rename`; a concurrent writer in that window is
  overwritten (its version is in the backup). Windows offers no compare-and-swap rename.
* Detection of reparse points relies on `realpath` equality; exotic filter drivers that virtualize paths without a
  reparse point are not modelled.
* `file.changes` is mtime-based; it does not diff against an earlier snapshot.

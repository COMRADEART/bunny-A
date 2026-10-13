# D1 — Purpose-aware classification of paired-device file writes

Implementation: `classifyDeviceWrite()` and `deviceWriteClassRefusal()` in `src/lib/bunny-missions/authorization.server.ts`. They are wired into `remoteExecutionRefusal()` (the canonical `decide()` and device-answer paths) and recorded on every staged change.

**This is risk reduction, not content safety.** A file of any name can be read, imported or executed by some program. The authoritative controls are:
- inert staging (D2);
- workstation promotion of the exact reviewed bytes;
- the F01 review gate before any Bunny code runs.

## Classes

| Class | Phone write authority | Meaning |
|---|---|---|
| `PHONE_SAFE_DOCUMENT` | yes, staged | `.md .markdown .txt .text` that passed every check below |
| `PHONE_SAFE_DATA` | yes, staged | `.csv .tsv .jsonl .ndjson .log` anywhere; `.json .yaml .yml` **only** inside a data or document folder (`data datasets docs doc notes reports exports documents journal inbox records logs`) |
| `EXECUTION_RELEVANT` | no (Windows Host) | can change what runs: Git metadata, hook/script/CI/tool folders, watched source folders, code or extensionless files, program-like content, project-metadata references |
| `CONFIGURATION` | no (Windows Host) | configures programs: F01 execution-config files and folders, dotfiles, every dot-folder, config folders, consumed names, JSON/YAML outside data folders |
| `AGENT_INSTRUCTIONS` | no (Windows Host) | files and folders agents load as instructions or settings |
| `UNKNOWN` | no (Windows Host) | anything that cannot be resolved and judged safely (fail closed) |

## Order of judgement (first match wins, fail closed)

The checks use verified context: the canonical path, the lexical path, the native (8.3-expanding) path, directory identity relative to the step's working folder, the existing destination, project metadata and the new content.

1. **No concrete path; UNC, device or drive-relative path** → `UNKNOWN`.
2. **Alias forms** → `UNKNOWN`:
   - 8.3 short-name leaf (`~N`);
   - NTFS stream suffix (`name:stream`);
   - trailing dot or space;
   - any invisible, bidirectional, format, control or separator code point (`\p{Cf}\p{Cc}\p{Zl}\p{Zp}`), Hangul and Braille fillers, and variation selectors;
   - any 8.3 short-name component below the step folder.
3. **Unresolvable path; destination outside the step folder (canonically or lexically)** → `UNKNOWN`.
4. **Links and identity** → `UNKNOWN`:
   - a symlink or junction on any existing component (lexical and canonical walk);
   - a lexical/canonical mismatch (alias);
   - an existing destination that is not a regular file;
   - an existing destination with `nlink > 1` (possible cross-root hard link).
5. **`AGENT_INSTRUCTIONS`**:
   - files: `AGENTS.md`, `AGENTS.override.md`, `AGENT.md`, `CLAUDE.md`, `CLAUDE.local.md`, `GEMINI.md`, `QWEN.md`, `WARP.md`, `CRUSH.md`, `OPENCODE.md`, `KILOCODE.md`, `CODY.md`, `CONVENTIONS.md`, `SKILL.md`, `copilot-instructions.md`, `.mcp.json`, `.cursorrules`, `.windsurfrules`, `.clinerules`, `.goosehints`, `.aider*`, `llms.txt`, `llms-full.txt`, `*.prompt.md`, `*.instructions.md`, `*.chatmode.md`, `*.agent.md`, `*.mdc`;
   - folders: `.claude .cursor .codex .gemini .continue .clinerules .windsurf .roo .kiro .aider .grok .agent(s) agents skills prompts rules instructions chatmodes .amazonq .junie .opencode .cline .augment .qwen .warp .trae .crush .goose .specify .amp .zed .codebuddy .kilocode .tabnine .sourcegraph .copilot`, and `.github/{instructions,prompts,chatmodes,agents}`.
6. **`EXECUTION_RELEVANT`**:
   - Git metadata, including the 8.3 alias `GIT~N`;
   - folders `.husky .githooks hooks bin script(s) node_modules .github .gitlab .circleci .buildkite .azure-pipelines .woodpecker .forgejo .gitea .vscode .devcontainer .idea .cargo .yarn .mvn .gradle .venv venv __pycache__`;
   - watched or served source folders relative to the step folder: `src app lib pages components server api public static assets routes test tests __tests__ spec e2e fixtures migrations prisma db include cmd pkg internal content plugins middleware functions netlify supabase layouts styles views templates`.
7. **`CONFIGURATION`**: F01 `EXECUTION_CONFIG_FILE` / `EXECUTION_CONFIG_DIR`, e.g. `package.json`, `tsconfig*.json`, `Makefile`, `.env*`, `*.config.*`, CI YAML, `Dockerfile`, `.gitattributes`.
8. **`EXECUTION_RELEVANT`**: any type that is not a document or data extension (code, binaries, `.mdx`, extensionless files).
9. **`CONFIGURATION`**:
   - dotfiles; every dot-folder inside the project (unknown tool folders fail closed);
   - folders `config .config configs settings conf .settings etc env environments`;
   - consumed names `requirements*.txt`, `constraints*.txt`, `runtime.txt`, `CMakeLists.txt`, `dependencies.txt`, `packages.txt`, `apt.txt`, `robots.txt`, `ads.txt`, `security.txt`, `humans.txt`.
10. **`EXECUTION_RELEVANT`**: new content or existing destination content that starts like a program (`#!`, `@echo`, `MZ`, ELF, `<?php`, `<script`, `import`, `export`, `require(`, `"use strict"`).
11. **Consumer references** (review round 4, `consumerOf()`):
    - Scanned files:
      - consumer files in the project root and in every existing folder above the destination: manifests, build files, CI pipeline roots such as `.gitlab-ci.yml`, `Jenkinsfile`, `azure-pipelines`, `buildspec` and `cloudbuild`, tool configs, and agent instruction files such as `CLAUDE.md` and `AGENTS.md`;
      - every text file in the root CI, hook, editor and agent folders (`.github`, `.gitlab`, `.circleci`, `.husky`, `.vscode`, `.claude`, …).
    - A reference is matched both root-relative and relative to the consumer's own folder. Text is normalized: lowercase, `\` to `/`, and `./` and `//` collapsed.
    - A reference in an agent instruction file → `AGENT_INSTRUCTIONS`; any other reference → `EXECUTION_RELEVANT`.
    - Fail closed (`UNKNOWN`): a consumer that is oversize (>1 MiB), unreadable or a link, or more than 400 consumers.
    - Not matched (disclosed, see the final report §Limitations): glob, quoted or variable spellings; folder-level tool settings (for example pytest `testpaths`, Sphinx `docs/conf.py`); consumer names outside the lists (for example `Dockerfile.dev`, compose override files, `Procfile`, `.cirrus.yml`, `.semaphore/`); UTF-16 consumers; references through `../` from sibling folders.
12a. **Name, folder and content rules** (review round 4):
    - → `CONFIGURATION`: config-like structured names anywhere (`_config.yml`, `mkdocs`, `pipeline`, …); underscore site-generator folders; requirements-style `.txt` names anywhere and a `requirements/` folder.
    - → `EXECUTION_RELEVANT`: pip installer directives in content; any content line that starts with `import` or `export` (word boundary).
    - → `UNKNOWN`: variation selectors in paths. They are also escaped in review text.
12. **JSON/YAML** → `PHONE_SAFE_DATA` only inside a data folder; otherwise `CONFIGURATION`.
13. **Remaining types**: data types → `PHONE_SAFE_DATA`, document types → `PHONE_SAFE_DOCUMENT`, anything else → `UNKNOWN`.

## Where the classification is enforced

- **Remote (paired-device) envelope:** a `filesystem.write` or `filesystem.delete` to a non-`PHONE_SAFE` path is a `desktopRequired` ask. The device cannot answer it.
- **Device one-time answers:** `deviceRequestRefusal()` runs `remoteExecutionRefusal()` on every parameter set the answer can reach, so a phone never answers a non-safe write.
- **Staging:** every staged change records its class, reasons and warnings. The workstation review shows them.
- **Promotion:** the destination is re-classified. An `UNKNOWN` result refuses promotion. Under a remote envelope, anything no longer `PHONE_SAFE` refuses promotion (for example, `package.json` started referencing the file).
- **Deletes:** a device-attributed `filesystem.delete` always needs the workstation's exact-operation grant.

## Explicitly not claimed

Bunny cannot see every downstream consumer of a file: external watchers, editors, CI, other users' tools. A promoted document can still be read by such programs. That is why promotion is a deliberate workstation action on exact bytes.

# MA4-S3-T3R2 — Filesystem Path Containment & Reparse Point Boundary

## 1. Problem Statement & Threat Vectors

In a desktop agent execution runtime, agents and test suites must operate within strictly bounded project trees. A vulnerability occurs when relative path representations, symlinks, junctions, or platform-specific path semantics allow an operation to access, mutate, or leak data outside the authorized root.

The specific threat vectors addressed in MA4-S3-T3R2 include:
1. **Directory Traversal:** Relative `..` sequences attempting to climb out of the project hierarchy.
2. **Windows Junctions & Reparse Points:** Directory junctions (`mklink /J`) pointing to sensitive system or user directories (`%USERPROFILE%`, `%APPDATA%`, `C:\Windows`).
3. **Symbolic & Hard Links:** File symlinks targeting protected credentials (`.env`, `.ssh/id_rsa`, `.git/config`).
4. **UNC Network Paths:** Remote network share paths (`\\attacker-host\share`) designed to leak NTLM credentials or bypass boundaries.
5. **Windows Reserved Device Names:** Legacy DOS device names (`NUL`, `CON`, `PRN`, `AUX`, `COM1-9`, `LPT1-9`) which cause hanging, denial of service, or arbitrary device access on Windows.
6. **8.3 Short-Name Traversal:** Short names (e.g. `PROGRA~1`) designed to bypass string-matching filters.
7. **Control Character & Wildcard Injection:** Unsafe characters (`<`, `>`, `:`, `"`, `|`, `?`, `*`, ASCII 0–31) attempting to exploit Windows filesystem parsing anomalies.

---

## 2. Containment Architecture & Enforcement Engine

Path containment in Bunny A is implemented via the unified `validatePathContainment` engine in `src/lib/bunny-host/ma4/test-runner.server.ts` and `connectors/files.server.ts`.

### 2.1 Lexical & Syntactic Validation
Before any filesystem I/O is performed, the candidate path is strictly validated:
- **Relative Path Only:** Must not be absolute (`isAbsolute(filePath)` is rejected).
- **No Drive Letters:** Cannot contain Windows drive specifiers (`/^[a-zA-Z]:/`).
- **No UNC Paths:** Cannot begin with `\\` or `//`.
- **No Traversal Segments:** Cannot contain `..` in any normalized path segment.
- **No Control Characters:** Rejects ASCII 0–31 and invalid characters (`[\x00-\x1f<>:"|?*]`).
- **No 8.3 Short Names:** Rejects `~[0-9]` segments.
- **No Reserved DOS Device Names:** Rejects `^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$` (case-insensitive).
- **No Protected Files/Folders:** Prohibits `.env`, `.git`, `.ssh`, `.aws`, `.azure`, private keys (`.pem`, `.key`), and sensitive credentials.

### 2.2 Canonical Path & Reparse Point Inspection
Syntactic checks alone cannot protect against filesystem aliases. The engine performs physical boundary validation:
1. **Segment-by-Segment Lstat:** Each path segment from the registered root downward is inspected using `lstatSync` (never `statSync`).
2. **Symlink and Junction Rejection:** If `isSymbolicLink()` is true on any intermediate directory or final leaf, execution is immediately aborted with a validation error (`dispatched: false`, `receipt: null`).
3. **Native Canonical Resolution:** The full path is resolved using `realpathSync.native`. The resolved canonical path is compared against the registered root path:
   ```ts
   const canonicalRoot = realpathSync.native(rootPath);
   const canonicalTarget = realpathSync.native(resolvedTarget);
   const isContained = process.platform === "win32"
     ? canonicalTarget.toLowerCase().startsWith(canonicalRoot.toLowerCase() + "\\")
     : canonicalTarget.startsWith(canonicalRoot + "/");
   if (!isContained) {
     throw new Error("Path escapes authorized project root.");
   }
   ```

---

## 3. Scope of Enforcement

Containment rules are applied uniformly to all execution and artifact parameters:

| Parameter | Containment Check | Enforcement Layer | Failure Behavior |
| :--- | :--- | :--- | :--- |
| **`testFile`** | Lexical, canonical, no symlinks/reparse | `test-runner.server.ts` | Refused before process launch; zero exit code prevented |
| **`reportFile`** | Lexical, canonical, must stay in root | `test-runner.server.ts` | Refused before launch; report verification fails closed |
| **Working Directory (`cwd`)** | Resolved through Host registry; canonical verified | `test-runner.server.ts` | Refused before spawn; task fails closed |
| **`file.read` target** | Relative segments, protected names, `walkSafe` | `connectors/files.server.ts` | Throws `FileScopeError`; task transitions to `FAILED` |
| **`file.apply` target** | Atomic write in same directory; no escape | `connectors/files.server.ts` | Proposal validation fails; zero disk mutation |

---

## 4. Adversarial Test Evidence

The path containment boundary is verified by automated adversarial tests in `src/lib/bunny-host/ma4-s3-t3r2-command-isolation.test.ts` and `ma4-s3-t3r2-held-out-eval.test.ts`:

1. **Traversal Escape:**
   - Attempt: `testFile: "../../../calc.test.js"`
   - Result: Refused (`Path contains directory traversal (..) sequences.`).
2. **Drive Letter Escape:**
   - Attempt: `testFile: "C:\\Windows\\win.ini"`
   - Result: Refused (`Path must be a relative path within the project root.`).
3. **UNC Path:**
   - Attempt: `testFile: "\\\\attacker-host\\share\\exploit.js"`
   - Result: Refused (`UNC network paths are forbidden.`).
4. **DOS Reserved Name:**
   - Attempt: `testFile: "NUL.js"`
   - Result: Refused (`Path contains reserved DOS device name: "NUL.js"`).
5. **Protected Credential File:**
   - Attempt: `testFile: ".env"`
   - Result: Refused (`Path references protected file: ".env"`).
6. **Windows Junction Escape:**
   - Attempt: Intermediate folder created with `mklink /J` pointing to parent directory.
   - Result: Refused at `lstat` boundary (`is a link; links are not followed`).

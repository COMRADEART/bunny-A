/**
 * M-A-3 T13.1: Host-owned Jev credential storage.
 *
 * The plaintext key exists only in Host memory during a save or an outbound
 * call. At rest it is Windows DPAPI ciphertext (CurrentUser scope, Bunny-specific
 * entropy) in its own Host database table — never in settings JSON, browser
 * storage, Agent memory or logs. Without DPAPI the store fails closed instead of
 * writing plaintext.
 */
import { execFile } from "node:child_process";
import type { HostDatabase } from "./persistence.server.ts";
import { registerDiagnosticSecret } from "./failure.server.ts";
import { systemTool } from "./system-tools.server.ts";

export interface SecretProtector {
  readonly kind: "dpapi" | "test";
  protect(plaintext: string): Promise<Buffer>;
  unprotect(ciphertext: Buffer): Promise<string>;
}

const DPAPI_SCRIPT = `
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$entropy = [Text.Encoding]::UTF8.GetBytes('Bunny-A/TypeSafe-Jev/credential/v1')
$data = [Console]::In.ReadToEnd().Trim()
if ($env:BUNNY_DPAPI_MODE -eq 'protect') {
  $plain = [Convert]::FromBase64String($data)
  $cipher = [Security.Cryptography.ProtectedData]::Protect($plain, $entropy, 'CurrentUser')
  [Console]::Out.Write([Convert]::ToBase64String($cipher))
} else {
  $plain = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($data), $entropy, 'CurrentUser')
  [Console]::Out.Write([Convert]::ToBase64String($plain))
}`;

/** Real Windows DPAPI through Windows PowerShell; the secret travels base64-encoded on stdin, never argv or env. */
export class DpapiProtector implements SecretProtector {
  readonly kind = "dpapi" as const;
  private run(mode: "protect" | "unprotect", input: string): Promise<string> {
    return new Promise((resolve, reject) => {
      if (process.platform !== "win32") return reject(new Error("Windows secret protection is unavailable on this platform."));
      const child = execFile(
        systemTool("powershell.exe"),
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", DPAPI_SCRIPT],
        { windowsHide: true, timeout: 20_000, maxBuffer: 64 * 1024, env: { ...process.env, BUNNY_DPAPI_MODE: mode } },
        (error, stdout) => {
          if (error) reject(new Error("Windows secret protection failed."));
          else resolve(stdout.trim());
        },
      );
      child.stdin?.end(input);
    });
  }
  async protect(plaintext: string) {
    return Buffer.from(await this.run("protect", Buffer.from(plaintext, "utf8").toString("base64")), "base64");
  }
  async unprotect(ciphertext: Buffer) {
    return Buffer.from(await this.run("unprotect", ciphertext.toString("base64")), "base64").toString("utf8");
  }
}

/** Test-only reversible protector. Production code never selects it. */
export class TestProtector implements SecretProtector {
  readonly kind = "test" as const;
  async protect(plaintext: string) {
    return Buffer.from(Buffer.from(plaintext, "utf8").toString("base64").split("").reverse().join(""), "utf8");
  }
  async unprotect(ciphertext: Buffer) {
    return Buffer.from(ciphertext.toString("utf8").split("").reverse().join(""), "base64").toString("utf8");
  }
}

export const API_KEY_SHAPE = /^[\x21-\x7e]{8,512}$/;

export class JevSecretStore {
  private readonly db: HostDatabase;
  private readonly protector: SecretProtector;
  constructor(db: HostDatabase, protector: SecretProtector = new DpapiProtector()) {
    this.db = db;
    this.protector = protector;
    this.db.db.exec("CREATE TABLE IF NOT EXISTS jev_credentials(id INTEGER PRIMARY KEY CHECK(id=1), ciphertext BLOB NOT NULL, protector TEXT NOT NULL, updated_at INTEGER NOT NULL)");
  }
  get protectorKind() {
    return this.protector.kind;
  }
  hasCredential(): boolean {
    return !!this.db.db.prepare("SELECT id FROM jev_credentials WHERE id=1").get();
  }
  updatedAt(): number | null {
    const row = this.db.db.prepare("SELECT updated_at AS at FROM jev_credentials WHERE id=1").get() as { at: number } | undefined;
    return row?.at ?? null;
  }
  /** Saves (or replaces) the credential. Success means local encrypted storage only — never remote acceptance. */
  async save(apiKey: string): Promise<void> {
    const key = typeof apiKey === "string" ? apiKey.trim() : "";
    if (!API_KEY_SHAPE.test(key)) throw new Error("Enter a valid API key (8-512 visible characters, no spaces).");
    registerDiagnosticSecret(key);
    const ciphertext = await this.protector.protect(key);
    if (ciphertext.includes(Buffer.from(key, "utf8"))) throw new Error("Secret protection returned unprotected data; nothing was saved.");
    this.db.db
      .prepare("INSERT INTO jev_credentials(id,ciphertext,protector,updated_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET ciphertext=excluded.ciphertext, protector=excluded.protector, updated_at=excluded.updated_at")
      .run(ciphertext, this.protector.kind, Date.now());
  }
  /** Host-internal only. Callers must never serialize, log or forward the result anywhere but the TypeSafe origin. */
  async retrieve(): Promise<string | null> {
    const row = this.db.db.prepare("SELECT ciphertext, protector FROM jev_credentials WHERE id=1").get() as { ciphertext: Uint8Array; protector: string } | undefined;
    if (!row) return null;
    if (row.protector !== this.protector.kind) throw new Error("The saved credential was protected by a different mechanism; replace it.");
    let key: string;
    try {
      key = await this.protector.unprotect(Buffer.from(row.ciphertext));
    } catch {
      throw new Error("The saved credential could not be decrypted on this Windows account; replace it.");
    }
    registerDiagnosticSecret(key);
    return key;
  }
  remove(): void {
    this.db.db.prepare("DELETE FROM jev_credentials WHERE id=1").run();
  }
}

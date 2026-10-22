// Tests write evidence to a scratch folder by default, so `npm test` never rewrites tracked historical evidence.
// Regenerate the tracked files deliberately with BUNNY_TEST_EVIDENCE_DIR=test-results.
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

export function evidenceDir(sub: string): string {
  const dir = resolve(process.env.BUNNY_TEST_EVIDENCE_DIR ?? resolve(tmpdir(), "bunny-test-evidence"), sub);
  mkdirSync(dir, { recursive: true });
  return dir;
}

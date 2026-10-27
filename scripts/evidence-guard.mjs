import { writeFileSync } from "node:fs";

/** Field names whose string values are credentials. A boolean or null under these names is a safe indicator. */
const SECRET_KEY = /^(authorization|auth[-_]?header|bearer|(access|refresh|device|host|api|session)?[-_]?token|api[-_]?key|secret|client[-_]?secret|password|cookie|set-cookie)$/i;
/** Credential shapes that must never appear in acceptance JSON or logs, whatever the field is called. */
const SECRET_TEXT = [
  // Prose like "Bearer credentials" is not a token; a real one is long and carries a digit.
  /\bBearer\s+(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]{16,}/i,
  /\bsk-(ant-)?[A-Za-z0-9_-]{20,}/,
  /\b(ghp|gho|ghs|ghu|github_pat)_[A-Za-z0-9_]{20,}/,
  /\bxai-[A-Za-z0-9]{20,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
];

/** Returns the first credential found in `text` (as a description, never the value), or null. */
export function findSecretText(text, known = []) {
  for (const secret of known) if (secret && text.includes(secret)) return "a known credential value";
  for (const pattern of SECRET_TEXT) if (pattern.test(text)) return `text matching ${pattern.source.slice(0, 24)}…`;
  return null;
}

/** Throws (naming the path, never the value) when `value` carries a credential. */
export function assertNoSecrets(value, known = [], path = "$") {
  if (typeof value === "string") {
    const found = findSecretText(value, known);
    if (found) throw new Error(`Evidence refused: ${path} contains ${found}.`);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    // An UPPER_SNAKE value under these names is a state (e.g. authorization: "AWAITING_APPROVAL"), not a credential.
    if (SECRET_KEY.test(key) && typeof child === "string" && child.length >= 12 && !/^[A-Z][A-Z_]*$/.test(child))
      throw new Error(`Evidence refused: ${path}.${key} is a credential field with a value.`);
    assertNoSecrets(child, known, `${path}.${key}`);
  }
}

/** The only way acceptance scripts write evidence: fails closed before anything reaches disk. */
export function writeEvidence(file, value, known = []) {
  assertNoSecrets(value, known);
  writeFileSync(file, JSON.stringify(value, null, 2));
}

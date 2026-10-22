// @ts-nocheck untyped harness script like its scripts/ma4-* siblings; typechecked only because a test imports it
// MA4-S1R4-G7C: owner-scoped Groq access for the frozen G7 v2 qualification ONLY. Not a Bunny A feature: nothing in
// src/ imports this file and the product registry keeps every cloud candidate disabled. Scope (owner authorization):
// groq / openai/gpt-oss-120b, Worker+Tester only, synthetic G7 specs only, <= 12 requests total and <= 4 per trial,
// $0, 7-day approval, no fallback provider. The credential and approval live in an isolated store, never the Host DB.
//
// Owner, in your OWN terminal (the key is read with echo off and never printed, logged or written in plaintext):
//   node --experimental-strip-types scripts/ma4-s1r4/g7c-cloud.mjs issue    # attest ZDR + free plan, save key, approve
//   node --experimental-strip-types scripts/ma4-s1r4/g7c-cloud.mjs status
//   node --experimental-strip-types scripts/ma4-s1r4/g7c-cloud.mjs revoke   # also run automatically after the trials
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { HostDatabase } from '../../src/lib/bunny-host/persistence.server.ts';
import { IntelligenceStore } from '../../src/lib/bunny-host/ma4/store.server.ts';
import { approvalExclusion } from '../../src/lib/bunny-host/ma4/hybrid.ts';
import { DpapiProtector } from '../../src/lib/bunny-host/jev-secrets.server.ts';
import { registerDiagnosticSecret } from '../../src/lib/bunny-host/failure.server.ts';

export const PROVIDER = 'groq', MODEL = 'openai/gpt-oss-120b', ORIGIN = 'https://api.groq.com', PATH = '/openai/v1/chat/completions';
export const CAPS = Object.freeze({ total: 12, perTrial: 4 });
// shortcut: gpt-oss counts hidden reasoning inside max_completion_tokens; a flat headroom over the strategy's numPredict
// keeps the visible-output budget comparable to the local runs. Upgrade to per-role measurement if replies truncate.
export const REASONING_TOKENS = 2048;
export const STORE_PATH = join(process.env.LOCALAPPDATA ?? homedir(), 'Bunny-A', 'ma4-g7c', 'g7c.sqlite');
const ENTROPY = 'Bunny-A/MA4-G7C/groq/v1';
const sha = v => createHash('sha256').update(v).digest('hex');

/** Ends the whole run: unauthorized data, paid usage, quota exhaustion, bad credential or invalid approval. */
export class StopRun extends Error {}

export function openStore(path = STORE_PATH) {
  const db = new HostDatabase(path);
  db.db.exec('CREATE TABLE IF NOT EXISTS g7c_credential(id INTEGER PRIMARY KEY CHECK(id=1),ciphertext BLOB NOT NULL,attestation TEXT NOT NULL)');
  return { db, store: new IntelligenceStore(db) };
}
export const approvalBlock = (store, now = Date.now()) =>
  approvalExclusion(store.approvals(), { provider: PROVIDER, model: MODEL, purpose: 'coding', dataCategory: 'synthetic', estimatedUsd: 0, spentUsd: 0, now });

/** Revocation only removes access, so the harness may do it; issuing stays with the workstation owner. */
export function revoke({ db } = openStore()) {
  db.db.prepare('DELETE FROM g7c_credential').run();
  db.db.prepare("UPDATE ma4_approvals SET record=json_set(record,'$.approval_status','revoked') WHERE provider=? AND model=?").run(PROVIDER, MODEL);
}

export async function loadCloud(opened = openStore()) {
  const block = approvalBlock(opened.store);
  if (block) throw new Error(`G7C not run: ${block}`);
  const row = opened.db.db.prepare('SELECT ciphertext,attestation FROM g7c_credential WHERE id=1').get();
  if (!row) throw new Error('G7C not run: no Groq credential saved (owner: g7c-cloud.mjs issue).');
  const key = await new DpapiProtector(ENTROPY).unprotect(Buffer.from(row.ciphertext));
  registerDiagnosticSecret(key);
  const approval = opened.store.approvals().find(a => a.provider_id === PROVIDER && a.model_id === MODEL);
  return { key, attestation: JSON.parse(row.attestation), approval: { ...approval }, approved: () => approvalBlock(opened.store) };
}

const seconds = s => { const m = /^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?(?:([\d.]+)ms)?$/.exec(s ?? ''); return m ? (+(m[1] ?? 0)) * 3600 + (+(m[2] ?? 0)) * 60 + (+(m[3] ?? 0)) + (+(m[4] ?? 0)) / 1000 : 0; };
const readLimits = h => ({ limitRequests: +h.get('x-ratelimit-limit-requests') || null, limitTokens: +h.get('x-ratelimit-limit-tokens') || null,
  remainingRequests: h.has('x-ratelimit-remaining-requests') ? +h.get('x-ratelimit-remaining-requests') : null, remainingTokens: h.has('x-ratelimit-remaining-tokens') ? +h.get('x-ratelimit-remaining-tokens') : null,
  resetRequestsS: seconds(h.get('x-ratelimit-reset-requests')), resetTokensS: seconds(h.get('x-ratelimit-reset-tokens')) });

/**
 * Capped, serialized Groq client with the harness ModelCall shape. `forbidden` = exact strings that must never leave the
 * host (hidden tests, reference solutions). Caps are checked BEFORE sending; a refused call is never sent.
 */
export function createCloud({ key, fetcher, forbidden, approved, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  const calls = []; let trial = null, limits = null, chain = Promise.resolve();
  const sent = t => calls.filter(c => c.sent && (t === undefined || c.trial === t)).length;
  const send = async ({ role, prompt, schema, signal, attempt, options }) => {
    if (schema) return { ok: false, error: 'Cloud roles take fenced replies only.', durationMs: 0 };
    const block = approved();
    if (block) throw new StopRun(`approval invalid: ${block}`);
    if (forbidden.some(s => prompt.includes(s)) || /test_hidden|[A-Za-z]:\\|\\Users\\|\/home\//.test(prompt)) throw new StopRun('unauthorized data in a cloud request (refused before sending)');
    if (sent(trial) >= CAPS.perTrial) { calls.push({ trial, role, attempt, sent: false, refused: 'per-trial cap' }); return { ok: false, error: `Cloud request budget exhausted (${CAPS.perTrial} per trial).`, durationMs: 0 }; }
    if (sent() >= CAPS.total) throw new StopRun(`total cloud request cap (${CAPS.total}) reached`);
    const maxTokens = (options?.numPredict ?? 2048) + REASONING_TOKENS, need = Math.ceil(prompt.length / 3) + maxTokens;
    if (limits?.limitTokens && need > limits.limitTokens) return { ok: false, error: 'Request exceeds the tokens-per-minute limit.', durationMs: 0 };
    // Free-plan TPM is small; wait for the window instead of drawing a 429 (which would stop the run).
    const lowTokens = (limits?.remainingTokens ?? Infinity) < need, lowRequests = (limits?.remainingRequests ?? Infinity) < 1;
    if (lowTokens || lowRequests) await sleep(1000 * (1 + Math.max(lowTokens ? limits.resetTokensS : 0, lowRequests ? limits.resetRequestsS : 0)));
    const body = JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], stream: false, max_completion_tokens: maxTokens, ...(options?.temperature !== undefined ? { temperature: options.temperature } : {}) });
    const started = Date.now(), rec = { trial, role, attempt, sent: true, at: new Date(started).toISOString(), promptSha256: sha(prompt), promptChars: prompt.length, maxCompletionTokens: maxTokens };
    calls.push(rec);
    let res;
    try { res = await fetcher(ORIGIN + PATH, { method: 'POST', redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(240_000)]), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body }); }
    catch { rec.durationMs = Date.now() - started; rec.error = signal.aborted ? 'aborted' : 'network'; return { ok: false, error: signal.aborted ? 'Stopped.' : 'Cloud request failed (network or timeout).', stopped: signal.aborted, durationMs: rec.durationMs }; }
    rec.status = res.status; rec.durationMs = Date.now() - started; limits = rec.rateLimit = readLimits(res.headers);
    if ([401, 402, 403, 429].includes(res.status)) { await res.body?.cancel(); throw new StopRun(`Groq HTTP ${res.status} (${res.status === 429 ? 'quota/rate limit' : res.status === 402 ? 'payment required' : 'credential or access'})`); }
    if (!res.ok) { await res.body?.cancel(); return { ok: false, error: `HTTP ${res.status}`, durationMs: rec.durationMs }; }
    const raw = await res.json(), choice = raw.choices?.[0];
    Object.assign(rec, { servedModel: raw.model ?? null, finishReason: choice?.finish_reason ?? null,
      usage: { promptTokens: raw.usage?.prompt_tokens ?? null, completionTokens: raw.usage?.completion_tokens ?? null, reasoningTokens: raw.usage?.completion_tokens_details?.reasoning_tokens ?? null } });
    if (typeof choice?.message?.content !== 'string') return { ok: false, error: 'Malformed completion.', durationMs: rec.durationMs };
    return { ok: true, text: choice.message.content, servedModel: raw.model ?? '', durationMs: rec.durationMs };
  };
  return {
    calls, sent,
    setTrial: t => { trial = t; },
    call: req => { const p = chain.then(() => send(req)); chain = p.catch(() => {}); return p; },
  };
}

async function hiddenLine(prompt) {
  if (!process.stdin.isTTY) throw new Error('Run this in your own terminal: the key must be typed, not piped or relayed.');
  process.stdout.write(prompt);
  process.stdin.setRawMode(true); process.stdin.resume();
  let value = '';
  for await (const chunk of process.stdin) {
    for (const ch of chunk.toString('utf8')) {
      if (ch === '\u0003') { process.stdin.setRawMode(false); process.exit(130); }
      if (ch === '\r' || ch === '\n') { process.stdin.setRawMode(false); process.stdin.pause(); process.stdout.write('\n'); return value.trim(); }
      value = ch === '\u007f' || ch === '\b' ? value.slice(0, -1) : value + ch;
    }
  }
  return value.trim();
}

async function issue() {
  if (!process.stdin.isTTY) throw new Error('Run this in your own terminal (not through an agent).');
  console.log(`Scope: ${PROVIDER} / ${MODEL}; Worker+Tester; synthetic G7 specs; <= ${CAPS.total} requests (<= ${CAPS.perTrial}/trial); $0; 7 days; no fallback.`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const zdr = (await rl.question('Is Zero Data Retention ON in Groq console > Settings > Data Controls? (yes/no) ')).trim() === 'yes';
  const free = (await rl.question('Is this Groq organization on the Free plan with no payment method (no possible spend)? (yes/no) ')).trim() === 'yes';
  rl.close();
  if (!zdr || !free) throw new Error('Not issued: Zero Data Retention and the Free plan are both required.');
  const key = await hiddenLine('Groq API key (input hidden): ');
  if (!/^gsk_[A-Za-z0-9]{20,}$/.test(key)) throw new Error('Not issued: that does not look like a Groq API key.');
  // Metadata only (no inference, no task data): the key works and the exact model is offered to this organization.
  const res = await fetch(`${ORIGIN}/openai/v1/models`, { headers: { Authorization: `Bearer ${key}` }, redirect: 'error' });
  if (!res.ok) throw new Error(`Not issued: Groq model listing returned HTTP ${res.status}.`);
  const listed = (await res.json()).data?.find(m => m.id === MODEL);
  if (!listed || listed.active === false) throw new Error(`Not issued: ${MODEL} is not available to this organization.`);
  const opened = openStore(), now = Date.now();
  const attestation = { zeroDataRetention: 'owner-attested', freePlanNoPaymentMethod: 'owner-attested', modelListed: true, checkedAt: new Date(now).toISOString(), metadataRequests: 1 };
  const ciphertext = await new DpapiProtector(ENTROPY).protect(key);
  opened.db.db.prepare('INSERT INTO g7c_credential(id,ciphertext,attestation) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET ciphertext=excluded.ciphertext,attestation=excluded.attestation').run(ciphertext, JSON.stringify(attestation));
  const issued = opened.store.issueApproval({ provider_id: PROVIDER, model_id: MODEL, approval_status: 'approved', approved_purpose: ['coding', 'debugging'], data_categories: ['synthetic'], spending_limit_usd: 0, expiry: new Date(now + 7 * 86_400_000).toISOString() }, 'workstation', now);
  console.log('Issued:', JSON.stringify({ ...issued, attestation }));
}

function status() {
  const opened = openStore();
  const credential = !!opened.db.db.prepare('SELECT 1 FROM g7c_credential WHERE id=1').get();
  console.log(JSON.stringify({ store: STORE_PATH, credentialSaved: credential, approval: opened.store.approvals().find(a => a.provider_id === PROVIDER && a.model_id === MODEL) ?? null, block: approvalBlock(opened.store) }, null, 1));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const cmd = process.argv[2];
  try {
    if (cmd === 'issue') await issue();
    else if (cmd === 'revoke') { revoke(); console.log('Revoked: approval marked revoked and the saved credential deleted. Also delete the key in the Groq console.'); status(); }
    else if (cmd === 'status') status();
    else { console.error('usage: g7c-cloud.mjs issue|status|revoke'); process.exitCode = 2; }
  } catch (e) { console.error(e.message); process.exitCode = 1; }
}

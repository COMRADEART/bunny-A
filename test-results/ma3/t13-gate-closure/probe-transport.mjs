import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const configPath = join(process.env.LOCALAPPDATA, 'Bunny-A/state/settings/remote.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('Refusing to validate transport with TLS verification disabled.');
const configured = new URL(config.url);
if (configured.protocol !== 'https:' || configured.username || configured.password) throw new Error('Transport requires an existing HTTPS origin without embedded credentials.');
const results = [];
for (const path of ['/bunny-health', '/api/bunny-events']) {
  const started = Date.now();
  try {
    const response = await fetch(new URL(path, configured.origin), { redirect: 'manual', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    const body = await response.text();
    let payload = null;
    try { payload = JSON.parse(body); } catch { /* HTML error responses are never retained. */ }
    results.push({ path, method: 'GET', status: response.status, elapsedMs: Date.now() - started, tlsVerification: 'platform defaults; no bypass', app: typeof payload?.app === 'string' ? payload.app : undefined, securityHeaders: Object.fromEntries(['x-frame-options', 'content-security-policy', 'referrer-policy', 'content-type'].map(name => [name, response.headers.get(name)])), unauthenticated: true, responseBodyRetained: false });
  } catch (error) { results.push({ path, method: 'GET', elapsedMs: Date.now() - started, error: error.cause?.code ?? error.name, responseBodyRetained: false }); }
}
const pass = results[0]?.status === 200 && results[0]?.app === 'Bunny-A' && results[1]?.status === 401;
writeFileSync(join(import.meta.dirname, 'transport-probe.json'), JSON.stringify({ checkedAt: new Date().toISOString(), configuredOriginWithheld: true, command: 'node test-results/ma3/t13-gate-closure/probe-transport.mjs', existingConfigurationOnly: true, results, pass, physicalPhoneTest: false }, null, 2) + '\n');
console.log(JSON.stringify({ pass, results: results.map(row => ({ path: row.path, status: row.status, error: row.error })) }));
process.exitCode = pass ? 0 : 1;

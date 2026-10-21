import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost } from '../../src/lib/bunny-host/http.server.ts';
import { OllamaAdapter } from '../../src/lib/bunny-host/adapters.server.ts';

// Isolated live UI Host. Never opens an external provider or the installed application's state.
const allowed = ['qwen2.5-coder:7b', 'huihui_ai/qwen2.5-abliterate:7b'];
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const u = new URL(String(input));
  if (u.origin !== 'http://127.0.0.1:11434') throw new Error('UI qualification blocks external network transmission.');
  if (u.pathname === '/api/generate' || u.pathname === '/api/chat') {
    const body = JSON.parse(String(init?.body));
    if (!allowed.includes(body.model)) throw new Error('Model outside the qualification resource allowlist.');
  }
  return original(input, init);
};
const directory = mkdtempSync(join(tmpdir(), 'bunny-s1r-ui-'));
const root = join(directory, 'workspace'); mkdirSync(root);
const adapter = new OllamaAdapter(), launch = adapter.launch.bind(adapter);
adapter.launch = (task, hooks) => launch({ ...task, maxRuntimeMs: Math.min(task.maxRuntimeMs ?? 45000, 45000),
  constraints: { ...task.constraints, contextTokens: 2048, outputTokens: 160 } }, hooks);
const host = await startHost({ dataDirectory: directory, root, port: 43149, adapters: [adapter] });
// This ignored local pointer contains a directory only, never a token. No credential is printed.
writeFileSync('.grok/s1r-ui-directory.txt', directory);
console.log('Isolated UI qualification Host ready. External inference blocked.');
let closing = false;
async function close() { if (closing) return; closing = true; await host.close(); }
process.on('SIGINT', close); process.on('SIGTERM', close);

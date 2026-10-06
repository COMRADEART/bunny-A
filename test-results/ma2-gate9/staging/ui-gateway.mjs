// QA-only server for the EXACT installed dashboard build. No authority implementation here.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const installRoot = 'C:/Users/allam/AppData/Local/Bunny-A-T9-stage';
const config = JSON.parse(readFileSync(join(installRoot, 'install.json'), 'utf8'));
const releaseRoot = config.currentRelease.folder;
if (config.currentRelease.name !== 'Bunny-A-Windows-v20-T9') throw new Error('Wrong staged dashboard');
process.env.BUNNY_STATE_LAYOUT = '2';
process.env.BUNNY_HOST_DATA_DIRECTORY = join(installRoot, 'state');
process.env.BUNNY_HOST_CREDENTIALS_FILE = join(installRoot, 'state/credentials/credentials.json');
delete process.env.BUNNY_REMOTE_ORIGIN;
process.chdir(releaseRoot);
const { pathToFileURL } = await import('node:url');
const { middleware } = await import(pathToFileURL(join(releaseRoot, '.output/server/index.mjs')).href);
const server = createServer(async (req, res) => {
  if (!['127.0.0.1:8086', 'localhost:8086'].includes(req.headers.host) || req.headers['x-forwarded-for'] || req.headers['cf-connecting-ip']) { res.writeHead(403); res.end('QA loopback only'); return; }
  try { await middleware(req, res); } catch { res.writeHead(500); res.end('Staged dashboard unavailable'); }
});
server.listen(8086, '127.0.0.1', () => console.log('Exact installed v20-T9 dashboard ready for isolated UI QA'));

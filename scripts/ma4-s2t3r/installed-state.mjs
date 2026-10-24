// Create a new, synthetic state for an isolated installed-release qualification.
// Never points at the production installation or copies user state.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const [release, stateArg] = process.argv.slice(2);
if (!release || !stateArg) throw new Error('usage: installed-state.mjs <verified release> <new state>');
const state = resolve(stateArg);
if (existsSync(join(state, 'host.sqlite'))) throw new Error('Existing state is never replaced.');
for (const folder of ['', 'credentials', 'settings', 'runtime', 'logs', 'backups', 'cloudflared', 'sessions']) mkdirSync(join(state, folder), { recursive: true });
const { HostDatabase } = await import(pathToFileURL(join(resolve(release), 'src/lib/bunny-host/persistence.server.ts')).href);
const host = new HostDatabase(join(state, 'host.sqlite'));
const schema = host.db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
const version = host.db.prepare('PRAGMA user_version').get().user_version;
host.db.close();
writeFileSync(join(state, 'state-layout.json'), JSON.stringify({ schema: 'bunny-state/2', stateRoot: state, databaseUserVersion: version, databaseSchemaSha256: createHash('sha256').update(JSON.stringify(schema)).digest('hex') }, null, 2));
console.log(JSON.stringify({ created: true, version }));

// Read-only audit of one already-stopped disposable Host's permission requests. Never reads credentials.
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
if (!/bunny-t13-final-live-[^/\\]+[/\\]state[/\\]host\.sqlite$/.test(process.argv[2] ?? '')) throw new Error('Only this lane disposable database is accepted');
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const tables = db.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name LIKE '%request%'").all();
const report = tables.map(t => ({ table: t.name, schema: t.sql, rows: db.prepare(`SELECT * FROM ${t.name}`).all() }));
writeFileSync(process.argv[3], JSON.stringify(report, null, 2));
db.close();

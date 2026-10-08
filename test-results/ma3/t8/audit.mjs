import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { verifyRelease } from '../../../scripts/bunny-release.mjs';
const dir = resolve('test-results/ma3/t8');
mkdirSync(dir, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const save = (name, value) => writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + '\n');
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', windowsHide: true }).trim();
const walk = path => existsSync(path) ? readdirSync(path, { withFileTypes: true }).flatMap(item => item.isDirectory() ? walk(join(path, item.name)) : [join(path, item.name)]) : [];
const phase = process.argv[2] ?? 'before';
const protectedPaths = ['BUNNY_OPENDOTS_ADOPTION_REPORT.md', 'MA1D_FINAL_INDEPENDENT_REVIEW.md', 'MA1_CLAUDE_FINAL_REVIEW.md', 'MA2_FINAL_INDEPENDENT_REVIEW.md', ...walk('memory')];
save(`protected-${phase}.json`, { files: protectedPaths.map(path => ({ path, sha256: hash(readFileSync(path)) })) });
const source = { accepted: '8b71167ba13de496ba25a6f78a7c70e99b388284', head: git('rev-parse', 'HEAD'), branch: git('branch', '--show-current'), ancestry: git('merge-base', '8b71167ba13de496ba25a6f78a7c70e99b388284', 'HEAD'), descendants: git('diff', '--name-only', '8b71167', 'HEAD'), status: git('status', '--short'), tests: git('ls-files').split(/\r?\n/).filter(path => /\.test\.(mjs|ts)$/.test(path)).map(path=>({path,sha256:hash(readFileSync(path))})), expected: { scripts:256, library:650, agent:24, ui:59, total:989 } };
save(`source-${phase}.json`, source);
const root = 'C:/Users/allam/AppData/Local/Bunny-A';
const database = join(root, 'development/host.sqlite');
let production = { classification:'NOT TESTED', observedAt:new Date().toISOString(), mutationCommands:[] };
if (existsSync(database)) {
  const db = new DatabaseSync(database, {readOnly:true});
  try {
    db.exec('BEGIN');
    const schema = db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
    const flags = db.prepare("SELECT value FROM settings WHERE key='missions_config'").get();
    const counts = schema.filter(row=>row.type==='table' && !row.name.startsWith('sqlite_')).map(row=>({table:row.name, count:db.prepare(`SELECT COUNT(*) n FROM "${row.name.replaceAll('"','""')}"`).get().n}));
    const settingsHash = hash(JSON.stringify(db.prepare('SELECT key,value FROM settings ORDER BY key').all()));
    production = {...production,classification:'LIVE VERIFIED',openedReadOnly:true,consistentReadTransaction:true,schemaSha256:hash(JSON.stringify(schema)),counts,settingsSha256:settingsHash,config:flags ? JSON.parse(flags.value):null};
    db.exec('ROLLBACK');
  } finally {db.close();}
  production.installed = verifyRelease(join(root,'releases/Bunny-A-Windows-v26-MA2-R1'));
}
try {
  production.processes = JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',"@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*Bunny-A-Windows-v26-MA2-R1*' } | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath) | ConvertTo-Json -Depth 4 -Compress"],{encoding:'utf8',windowsHide:true}));
} catch { production.processes = null; production.processObservation='Unavailable'; }
production.startupSha256=hash(readFileSync('startup.sh'));
save(`production-${phase}.json`,production);
if(phase==='before') writeFileSync(join(dir,'baseline.md'),`# T8 baseline\n\nAccepted executable source ${source.accepted}; starting HEAD ${source.head}; branch ${source.branch}. Accepted source is an ancestor. Its only descendant is T7 evidence (no executable changes). Existing untracked reports and memory are hashed and preserved. Existing tracked tests are inventoried by hash. Starting expected distinct floor: 989.\n\nNo deployment, production migration/restart, Startup change, tunnel, push, reset or clean is authorized. Production observations use a consistent read-only SQLite transaction; mutable database byte equality is never used.\n`);
console.log(`T8 ${phase} audit saved; no credentials emitted.`);

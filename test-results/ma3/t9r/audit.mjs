import {readFileSync,writeFileSync,readdirSync,existsSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {verifyRelease} from '../../../scripts/bunny-release.mjs';
const out=resolve('test-results/ma3/t9r'),phase=process.argv[2]??'before';
mkdirSync(out,{recursive:true});
const sha=b=>createHash('sha256').update(b).digest('hex');
const save=(name,v)=>writeFileSync(join(out,name),JSON.stringify(v,null,2)+'\n');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',windowsHide:true}).trim();
const walk=p=>existsSync(p)?readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(p,e.name)):[join(p,e.name)]):[];
const protectedPaths=['BUNNY_OPENDOTS_ADOPTION_REPORT.md','MA1D_FINAL_INDEPENDENT_REVIEW.md','MA1_CLAUDE_FINAL_REVIEW.md','MA2_FINAL_INDEPENDENT_REVIEW.md',...walk('memory')].filter(existsSync);
save(`protected-${phase}.json`,protectedPaths.map(path=>({path,sha256:sha(readFileSync(path))})));
const source='0a5988c5eef7e6beae3d1622529e2c638cca7788',accepted='987afeace77520b9f4ef49e27b137dd01fb3fee8';
const tests=git('ls-files').split(/\r?\n/).filter(p=>/\.test\.(mjs|ts)$/.test(p));
save(`source-${phase}.json`,{observedAt:new Date().toISOString(),head:git('rev-parse','HEAD'),branch:git('branch','--show-current'),acceptedT9:source,acceptedT8:accepted,t9Ancestor:git('merge-base',source,'HEAD')===source,t8Ancestor:git('merge-base',accepted,'HEAD')===accepted,evidenceCommit:'89f8217d488fd033bd9489d3ccc16c4d67a85b85',status:git('status','--short'),testFiles:tests.map(path=>({path,sha256:sha(readFileSync(path))})),runner:JSON.parse(readFileSync('package.json')).scripts,acceptedInventory:{scripts:256,library:664,agent:24,ui:99,total:1043},previousEvidenceSealSha256:sha(readFileSync('test-results/ma3/t9/INDEX.sha256'))});
const prodRoot=join(process.env.LOCALAPPDATA,'Bunny-A');
const configPath=join(prodRoot,'install.json'),config=JSON.parse(readFileSync(configPath));
if(!config.stateRoot)throw new Error('Installed state root missing; do not guess development state.');
const dbPath=join(config.stateRoot,'host.sqlite');
const db=new DatabaseSync(dbPath,{readOnly:true});
const tables={};
try{
 db.exec('BEGIN');
 const schema=db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
 for(const row of schema.filter(r=>r.type==='table'&&!r.name.startsWith('sqlite_'))){const rows=db.prepare(`SELECT * FROM "${row.name.replaceAll('"','""')}" ORDER BY rowid`).all();tables[row.name]={count:rows.length,sha256:sha(JSON.stringify(rows))};}
 tables._schema={sha256:sha(JSON.stringify(schema))};db.exec('ROLLBACK');
}finally{db.close();}
const powershell=text=>execFileSync('powershell.exe',['-NoProfile','-Command',text],{encoding:'utf8',windowsHide:true});
const processes=JSON.parse(powershell("@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*Bunny-A-Windows-v26-MA2-R1*' } | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath,SessionId) | ConvertTo-Json -Depth 4 -Compress"));
const startup=join(process.env.APPDATA,'Microsoft/Windows/Start Menu/Programs/Startup');
const credentials=join(config.stateRoot,'credentials/credentials.json');
const prod={observedAt:new Date().toISOString(),classification:'LIVE read-only audit',databasePath:dbPath,resolvedThroughInstallJson:true,openedReadOnly:true,consistentTransaction:true,tables,configurationSha256:sha(readFileSync(configPath)),credentialsFileSha256:existsSync(credentials)?sha(readFileSync(credentials)):null,processes,startupSha256:sha(readFileSync('startup.sh')),windowsStartupFiles:walk(startup).map(path=>({path,sha256:sha(readFileSync(path))})),installedManifest:verifyRelease(join(prodRoot,'releases/Bunny-A-Windows-v26-MA2-R1')),productionCommands:[],installPerformed:false,tunnelActivated:false};
save(`production-${phase}.json`,prod);
if(phase==='after'){
 const before=JSON.parse(readFileSync(join(out,'production-before.json')));
 save('production-final.json',{classification:'LIVE read-only before/after',window:{before:before.observedAt,after:prod.observedAt},databasePath:dbPath,resolvedThroughInstallJson:true,tableComparison:Object.fromEntries(Object.entries(before.tables).map(([name,value])=>[name,{before:value,after:prod.tables[name],equal:JSON.stringify(value)===JSON.stringify(prod.tables[name])}])),processesUnchanged:JSON.stringify(before.processes)===JSON.stringify(prod.processes),credentialsUnchanged:before.credentialsFileSha256===prod.credentialsFileSha256,configurationUnchanged:before.configurationSha256===prod.configurationSha256,startupUnchanged:before.startupSha256===prod.startupSha256,windowsStartupUnchanged:JSON.stringify(before.windowsStartupFiles)===JSON.stringify(prod.windowsStartupFiles),installedManifest:prod.installedManifest,protectedFilesUnchanged:readFileSync(join(out,'protected-before.json'),'utf8')===readFileSync(join(out,'protected-after.json'),'utf8'),productionCommands:[],installed:false,restarted:false,migrated:false,tunnelActivated:false,limitation:'Row/schema digests, not byte equality of an active SQLite/WAL. Audit proves only the stated T9R observation window.'});
}
console.log(`T9R ${phase}: installed state resolved via install.json and opened read-only; secret values omitted.`);

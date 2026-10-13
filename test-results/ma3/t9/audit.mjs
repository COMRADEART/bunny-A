import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,existsSync,readdirSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {verifyRelease} from '../../../scripts/bunny-release.mjs';
const out=resolve('test-results/ma3/t9');
const phase=process.argv[2]??'before';
const sha=b=>createHash('sha256').update(b).digest('hex');
const save=(name,value)=>writeFileSync(join(out,name),JSON.stringify(value,null,2)+'\n');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',windowsHide:true}).trim();
const walk=p=>existsSync(p)?readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(p,e.name)):[join(p,e.name)]):[];
mkdirSync(out,{recursive:true});
const protectedFiles=['BUNNY_OPENDOTS_ADOPTION_REPORT.md','MA1D_FINAL_INDEPENDENT_REVIEW.md','MA1_CLAUDE_FINAL_REVIEW.md','MA2_FINAL_INDEPENDENT_REVIEW.md',...walk('memory')].filter(existsSync);
save(`protected-${phase}.json`,protectedFiles.map(path=>({path,sha256:sha(readFileSync(path))})));
const accepted='987afeace77520b9f4ef49e27b137dd01fb3fee8';
save(`source-${phase}.json`,{accepted,head:git('rev-parse','HEAD'),branch:git('branch','--show-current'),ancestor:git('merge-base',accepted,'HEAD')===accepted,descendants:git('diff','--name-only',accepted,'HEAD'),status:git('status','--short'),existingTests:git('ls-files').split(/\r?\n/).filter(p=>/\.test\.(mjs|ts)$/.test(p)).map(path=>({path,sha256:sha(readFileSync(path))})),expected:{scripts:256,library:650,agent:24,ui:78,total:1008}});
const prodRoot=join(process.env.LOCALAPPDATA,'Bunny-A');
const configPath=join(prodRoot,'install.json');
const installedConfig=existsSync(configPath)?JSON.parse(readFileSync(configPath)):null;
const stateRoot=installedConfig?.stateRoot;
const dbPath=stateRoot?join(stateRoot,'host.sqlite'):'';
const prod={observedAt:new Date().toISOString(),classification:'NOT TESTED',productionCommands:[],limitation:'Before observation begins at Codex takeover; no whole-task before/after claim.'};
prod.databasePath=dbPath;
prod.auditBoundary=phase==='installed-before'?'Correct installed-state baseline begins here. Earlier production-before.json audited development state; it does not prove installed device preservation.':'Compare only against the explicitly resolved installed-state baseline.';
prod.configurationSha256=existsSync(configPath)?sha(readFileSync(configPath)):null;
prod.credentialsFileSha256=stateRoot&&existsSync(join(stateRoot,'credentials/credentials.json'))?sha(readFileSync(join(stateRoot,'credentials/credentials.json'))):null;
const startupDirectory=join(process.env.APPDATA,'Microsoft/Windows/Start Menu/Programs/Startup');
prod.windowsStartupFiles=walk(startupDirectory).map(path=>({path,sha256:sha(readFileSync(path))}));
if(dbPath&&existsSync(dbPath)){
 const db=new DatabaseSync(dbPath,{readOnly:true});
 try{
  db.exec('BEGIN');
  const schema=db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
  const counts=schema.filter(r=>r.type==='table'&&!r.name.startsWith('sqlite_')).map(r=>({table:r.name,count:db.prepare(`SELECT COUNT(*) n FROM "${r.name.replaceAll('"','""')}"`).get().n}));
  Object.assign(prod,{classification:'LIVE',openedReadOnly:true,consistentTransaction:true,schemaSha256:sha(JSON.stringify(schema)),counts,settingsSha256:sha(JSON.stringify(db.prepare('SELECT key,value FROM settings ORDER BY key').all())),devicesSha256:sha(JSON.stringify(db.prepare('SELECT * FROM devices ORDER BY id').all()))});
  db.exec('ROLLBACK');
 }finally{db.close();}
}
try{prod.installedManifestVerified=verifyRelease(join(prodRoot,'releases/Bunny-A-Windows-v26-MA2-R1'));}catch{prod.installedManifestVerified=null;}
try{prod.processes=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-Command',"@(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*Bunny-A-Windows-v26-MA2-R1*' } | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath) | ConvertTo-Json -Depth 4 -Compress"],{encoding:'utf8',windowsHide:true}));}catch{prod.processes=null;}
prod.startupSha256=sha(readFileSync('startup.sh'));
save(`production-${phase}.json`,prod);
if(phase==='after'){
 const before=JSON.parse(readFileSync(join(out,'production-installed-before.json')));
 const processBefore=JSON.parse(readFileSync(join(out,'production-before.json')));
 save('production-final.json',{classification:'LIVE with incomplete whole-task database baseline',boundary:'Installed database: corrected installed-before observation through completion. Process continuity: Codex takeover through completion.',databasePath:dbPath,schemaUnchanged:before.schemaSha256===prod.schemaSha256,settingsUnchanged:before.settingsSha256===prod.settingsSha256,deviceRowsUnchanged:before.devicesSha256===prod.devicesSha256,credentialsFileUnchanged:before.credentialsFileSha256===prod.credentialsFileSha256,configurationUnchanged:before.configurationSha256===prod.configurationSha256,countsUnchanged:JSON.stringify(before.counts)===JSON.stringify(prod.counts),processesUnchanged:processBefore.processes!==null&&JSON.stringify(processBefore.processes)===JSON.stringify(prod.processes),startupUnchanged:before.startupSha256===prod.startupSha256,windowsStartupUnchanged:JSON.stringify(before.windowsStartupFiles)===JSON.stringify(prod.windowsStartupFiles),installedManifestVerified:prod.installedManifestVerified,protectedFilesUnchanged:readFileSync(join(out,'protected-before.json'),'utf8')===readFileSync(join(out,'protected-after.json'),'utf8'),productionCommands:[],installPerformed:false,tunnelActivated:false,limitation:'Initial audit selected development state, not installed state. Full task-wide installed database/device equality is NOT TESTED; corrected short-window equality, release manifest, process identities and protected files are verified separately.'});
}
console.log(`T9 ${phase} read-only audit saved; credentials omitted.`);

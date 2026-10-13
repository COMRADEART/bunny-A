// Enrich only the original captured 68 IDs. Never regenerate the pre-change baseline.
import {readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
const root='test-results/ma2-gate9r/';
const record=JSON.parse(readFileSync(root+'launch-lineage.json','utf8'));
const db=new DatabaseSync('C:/Users/allam/AppData/Local/Bunny-A-T9-stage/state/host.sqlite',{readOnly:true});
const runs=new Map(db.prepare('SELECT record FROM capability_runs').all().map(row=>{const r=JSON.parse(row.record);return [r.id,r];}));
const supporting=readdirSync('test-results/ma2-gate9').filter(n=>n.endsWith('.json')).map(n=>({file:n,text:readFileSync('test-results/ma2-gate9/'+n,'utf8')}));
for(const row of record.records){
  const run=runs.get(row.capabilityRunId);
  if(!run)throw Error('Original captured run missing');
  const pid=run.summary?.match(/\(pid\s+(\d+)\)/i)?.[1];
  row.launcherProcess=pid?{processId:Number(pid),source:'Original capability run summary',windowAuthority:false}:null;
  row.testCase=[...new Set([...row.testCase,...supporting.filter(s=>row.missionId&&s.text.includes(row.missionId)&&/-live\.json$/.test(s.file)).map(s=>s.file)])];
  row.windowIdentityProvenance=row.windowIdentity?'Later canonical batch binding recorded after focus; not proof that this launcher PID produced that HWND.':'Not retained in original launch capability record.';
  row.testCaseLabel=row.missionTitle??'Direct probe; no Mission/Task identity';
}
record.enrichedAt=new Date().toISOString();record.originalCapturedIdsPreserved=true;
record.launcherIdentityNote='Launcher process may exit into the UWP package. It is not the visible frame/content process and cannot authorize cleanup.';
writeFileSync(root+'launch-lineage.json',JSON.stringify(record,null,2)+'\n');db.close();
console.log('Original 68-run lineage enriched without changing reconstruction baseline.');

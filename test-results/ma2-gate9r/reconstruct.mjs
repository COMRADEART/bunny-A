import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root = 'test-results/ma2-gate9r/';
const stage = 'C:/Users/allam/AppData/Local/Bunny-A-T9-stage/state/host.sqlite';
const db = new DatabaseSync(stage,{readOnly:true});
const parse = table => db.prepare('SELECT record FROM ' + table).all().map(row => JSON.parse(row.record));
const missions = parse('missions'), steps = parse('mission_steps'), requests = parse('permission_requests'), batches = parse('approval_batches'), runs = parse('capability_runs');
const labels = [];
for (const name of readdirSync('test-results/ma2-gate9').filter(n => /-live\.json$/.test(n))) {
  try {
    const r = JSON.parse(readFileSync('test-results/ma2-gate9/' + name,'utf8').replace(/^\uFEFF/,''));
    const id = r.evidence?.missionId ?? r.evidence?.missionA ?? r.missionId;
    if(id) labels.push([id,name]);
  } catch {}
}
const lineage = runs.filter(r => r.action === 'computer.open_app' && r.params?.app === 'calculator').sort((a,b) => a.startedAt-b.startedAt).map(run => {
  const mission = missions.find(m => m.id === run.missionId), step = steps.find(s => s.id === run.stepId);
  const req = requests.filter(r => r.missionId === run.missionId && r.stepId === run.stepId && r.createdAt <= run.startedAt).sort((a,b)=>b.createdAt-a.createdAt)[0];
  const batch = batches.find(b => b.missionId === run.missionId && b.createdAt <= run.startedAt && run.startedAt < b.expiresAt);
  return {
    timestamp:new Date(run.startedAt).toISOString(), taskId:step?.taskId ?? null, missionId:run.missionId, stepId:run.stepId,
    missionTitle:mission?.title ?? null, attemptCount:step?.attempts?.length ?? null, authorizationId:mission?.authorizationId ?? null,
    grantId:batch?.id ?? null, approvalRequestId:req?.id ?? null, capabilityRunId:run.id, operation:run.action,
    decision:'unconditional Start-Process in old Runtime; successful run indicates launch call, not a proved one-to-one visible window',
    launcherProcess:run.output?.pid ?? null, windowIdentity:batch?.windowIdentity ?? null,
    testCase:labels.filter(([id]) => id === run.missionId).map(([,name])=>name), result:run.status,
    priorTargetValidity:'not captured by old launcher or harness', cleanup:'no per-target close in old harness',
  };
});
const countsByMission = Object.fromEntries([...new Set(lineage.map(r=>r.missionId))].map(id=>[id,lineage.filter(r=>r.missionId===id).length]));
writeFileSync(root+'launch-lineage.json',JSON.stringify({gate:'M-A-2 T9R',recordedAt:new Date().toISOString(),databaseReadOnly:true,launchCallCount:lineage.length,successfulLaunchRuns:lineage.filter(r=>r.result==='succeeded').length,countsByMission,records:lineage,limits:'Capability run storage does not retain output; original live-record output and current target inventory are supporting evidence. Launcher PID is not UWP window identity. Unrecorded historical windows cannot be closed on this record alone.'},null,2)+'\n');
const prod = 'C:/Users/allam/AppData/Local/Bunny-A/';
const readJson = path => JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));
const protectedFiles = ['install.json','state/state-layout.json','state/credentials/credentials.json','state/settings/deployment.json'];
writeFileSync(root+'baseline.json',JSON.stringify({gate:'M-A-2 T9R',recordedAt:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),branch:execFileSync('git',['branch','--show-current'],{encoding:'utf8'}).trim(),regressionFloor:{scripts:247,application:340,ui:37,total:624,evidence:'test-results/ma2-gate9/regression-final.json'},production:readJson(prod+'install.json').currentRelease.name,protectedFiles:protectedFiles.map(path=>({path,sha256:createHash('sha256').update(readFileSync(prod+path)).digest('hex')})),sourceChangeBeforeReconstruction:false},null,2)+'\n');
console.log(JSON.stringify({launchCallCount:lineage.length,successful:lineage.filter(r=>r.result==='succeeded').length,missions: Object.keys(countsByMission).length,multipleLaunchMissions:Object.entries(countsByMission).filter(([,n])=>n>1)},null,2));
db.close();

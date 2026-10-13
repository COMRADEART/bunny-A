import{readFileSync,writeFileSync}from'node:fs';
let source=readFileSync('test-results/ma2-gate10/stop-composition.ts','utf8');
source=source.replace("const before=missions.store.runs", "const batchBefore=missions.store.batches(m.id)[0];assert.equal(batchBefore.status,'active');let refused='';try{missions.retargetTask(providerTask.id,'codex');}catch(error){refused=String(error.message);}assert.match(refused,/Codex|compatibility|unvalidated|restricted/i);assert.deepEqual(missions.store.batches(m.id)[0],batchBefore);assert.equal(records.length,1);\n const before=missions.store.runs");
source=source.replace("'stop-composition.json'","'reroute-composition.json'").replace("'stop-composition-harness-failure.json'","'reroute-composition-harness-failure.json'").replace("attackIds:['T10-XG-04'", "providerRerouteRefused:refused,grantUnchangedDuringReroute:true,attackIds:['T10-XG-03','T10-XG-04'");
writeFileSync('test-results/ma2-gate10/reroute-composition.ts',source);

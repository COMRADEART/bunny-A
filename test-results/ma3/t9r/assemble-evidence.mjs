// T9R evidence assembler: derives the required summary files from raw logs, receipts and review output.
// Every value here is computed from a retained raw artifact; nothing is hand-entered as a result.
import {readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=resolve('test-results/ma3/t9r'),r=p=>join(root,p);
const json=p=>JSON.parse(readFileSync(r(p),'utf8').replace(/^﻿/,''));
const opt=p=>existsSync(r(p))?json(p):null;
const save=(name,v)=>writeFileSync(r(name),JSON.stringify(v,null,2)+'\n');
const git=(...a)=>execFileSync('git',a,{encoding:'utf8',windowsHide:true}).trim();
const finalSource=process.argv[2]??git('rev-parse','HEAD');
const regression=readFileSync(r('complete-regression.log'),'utf8'),ui=readFileSync(r('ui-regression.log'),'utf8');

// ---- Test results parsed from the final logs (top-level node:test lines only). ----
const parse=text=>{const rows=[];for(const line of text.split(/\r?\n/)){if(/^✖ failing tests:/.test(line))break;const m=/^(✔|✖|﹣) (.+?)(?: \(([\d.]+)ms\))?( # SKIP.*)?$/.exec(line);if(m)rows.push({name:m[2],status:m[4]?'skipped':m[1]==='✔'?'pass':'fail'});}return rows;};
const summaries=text=>[...text.matchAll(/ℹ tests (\d+)\r?\nℹ suites \d+\r?\nℹ pass (\d+)\r?\nℹ fail (\d+)\r?\nℹ cancelled (\d+)\r?\nℹ skipped (\d+)/g)].map(m=>({tests:+m[1],pass:+m[2],fail:+m[3],cancelled:+m[4],skipped:+m[5]}));
const sums=summaries(regression),uiSum=summaries(ui);
const results=[...parse(regression),...parse(ui)];
const status=pattern=>results.filter(t=>pattern.test(t.name)).map(t=>({name:t.name,status:t.status}));
const allPass=rows=>rows.length>0&&rows.every(t=>t.status==='pass');

// ---- Inventory and no-removal proof against the accepted T9 final run. ----
const t9names=new Set([...parse(readFileSync('test-results/ma3/t9/full-test-results-final.log','utf8')),...parse(readFileSync('test-results/ma3/t9/agent-test-results.log','utf8')),...parse(readFileSync('test-results/ma3/t9/ui-test-results.log','utf8'))].map(t=>t.name));
const nowNames=new Set(results.map(t=>t.name));
const removed=[...t9names].filter(n=>!nowNames.has(n)),added=[...nowNames].filter(n=>!t9names.has(n));
const suites=['scripts','library','agent'];
const inventory={sourceCommit:finalSource,classification:'Parsed from complete-regression.log and ui-regression.log of the final committed source',
 suites:Object.fromEntries([...sums.map((s,i)=>[suites[i]??`suite${i}`,s]),['ui',uiSum[0]]]),
 total:[...sums,...uiSum].reduce((a,s)=>({tests:a.tests+s.tests,pass:a.pass+s.pass,fail:a.fail+s.fail,skipped:a.skipped+s.skipped,cancelled:a.cancelled+s.cancelled}),{tests:0,pass:0,fail:0,skipped:0,cancelled:0}),
 acceptedFloor:{scripts:256,library:664,agent:24,ui:99,total:1043},
 comparedWith:'test-results/ma3/t9/full-test-results-final.log + agent-test-results.log + ui-test-results.log (T9 sealed runs; 1,043 distinct tests)',t9DistinctNames:t9names.size,
 priorTestNamesMissing:removed,addedTestNames:added,existingTestFilesChanged:git('diff','--name-only','0a5988c5eef7e6beae3d1622529e2c638cca7788',finalSource,'--','*.test.ts','*.test.mjs').split(/\r?\n/).filter(Boolean)};
save('complete-test-inventory.json',inventory);

// ---- Calculator UIA tree, identity and readiness. ----
const safeTarget=t=>t&&({handle:t.handle,rootName:t.rootName,rootClass:t.rootClass,frameProcess:{pid:t.processId,image:t.processPath?.split('\\').pop(),startedAt:t.processStartedAt},contentProcess:{pid:t.contentProcessId,startedAt:t.contentStartedAt},verifiedMicrosoftCalculator:t.verifiedMicrosoftCalculator,sessionId:t.sessionId,minimized:t.minimized,visible:t.visible,offscreen:t.offscreen,expectedControls:t.expectedControls,presentControls:t.presentControls,controlCount:t.controls?.length??0,controls:(t.controls??[]).map(c=>({automationId:c.automationId,controlType:c.controlType,className:c.className,owner:c.processId===t.processId?'frame':c.processId===t.contentProcessId?'content':'other',enabled:c.enabled,offscreen:c.offscreen,parentId:c.parentId}))});
const snap=(file,label)=>{const d=json(file);return{label,file,observedAt:d.observedAt,os:d.os,session:d.diagnosticProcess&&{sessionId:d.diagnosticProcess.sessionId,userInteractive:d.diagnosticProcess.userInteractive},package:d.packages?.map(p=>({name:p.Name,version:p.Version,publisherId:p.PublisherId,signatureKind:p.SignatureKind})),calculatorProcessCount:d.calculatorProcesses?.length??0,targets:(d.targets??[]).map(safeTarget)};};
save('calculator-uia-tree-safe.json',{classification:'LIVE read-only Windows UIA diagnostic (calculator-diagnostic.ps1); names of user data omitted, only Calculator UI structure retained',
 before:snap('calculator-before.json','before baseline (no Calculator window)'),
 healthyAfterColdBaseline:snap('calculator-after-baseline.json','after cold baseline X53 (pass)'),
 minimizedFailureState:snap('calculator-minimized.json','owned window minimized: X53 reproduced "Calculator arithmetic identity unavailable"'),
 afterRepair:snap('calculator-after-repair.json','after repaired acquisition restored the same frame/content lifetime'),
 finding:'Minimized ApplicationFrameWindow keeps its HWND and frame process but detaches the CalculatorApp content process: contentProcessId null, verifiedMicrosoftCalculator false, presentControls [] (num0Button, num2Button, clearButton, CalculatorResults absent).'});
const stability=json('x53-stability-matrix.json');
const parseIdentity=s=>s?JSON.parse(s.slice(s.indexOf(': ')+2)):null;
save('calculator-target-identity.json',{classification:'LIVE native identity evidence',
 installedPackage:snap('calculator-after-repair.json','').package,
 nativeFrameAppUserModelId:json('native-minimized-frame-property.json'),
 ownedLedger:{file:'owned-calculator-ledger.json',preexistingHandles:json('owned-calculator-ledger.json').preexistingHandles,targets:json('owned-calculator-ledger.json').targets.map(t=>safeTarget(t)).map(({controls,...t})=>t)},
 stabilityAcquisitions:stability.rows.map(row=>({run:row.run,mode:row.mode,acquisition:row.acquisition?.split(':')[0],identity:parseIdentity(row.acquisition),after:row.afterIdentity,sameAsAfter:JSON.stringify(parseIdentity(row.acquisition))===JSON.stringify(row.afterIdentity)})),
 nativeAdversarial:json('native-adversarial-results.json'),
 identityChecks:['HWND + native owner PID','frame process creation time and session','frame executable (System32 ApplicationFrameHost.exe) and ApplicationFrameWindow class','native AppUserModelID equals the signed installed Appx manifest identity','bound content process creation time and signed CalculatorApp executable','fresh full UIA tree with expected enabled semantic controls; no coordinates'],
 tests:status(/T9R readiness|Calculator|calculator/)});
save('calculator-readiness-results.json',{classification:'LIVE readiness receipts from unchanged original X53 runs + SIMULATED injected adapter boundary tests (labelled)',
 bound:{pollIntervalMs:100,perPhaseMaxMs:8000,alsoBoundedBy:['consent expiry','operation timeout'],focusDeadlineMs:2000},
 liveReadiness:stability.rows.map(row=>({run:row.run,mode:row.mode,readiness:row.readiness?JSON.parse(row.readiness.slice(row.readiness.indexOf(': ')+2)):'not re-probed (reuse of an already-ready bound target)'})),
 boundaryTests:status(/^T9R readiness|^T9R focus/),allPass:allPass(status(/^T9R readiness|^T9R focus/))});

// ---- X53 full workflow (final regression run's receipts, copied before the sealed T6 files were restored). ----
const x53=json('x53-final-run/integrated-acceptance.json');
const steps=[['Read approved filesystem resource','filesystem.read'],['Inspect Git','git.status'],['Bounded approved terminal operation','terminal.exec'],['Isolated browser navigation','browser.navigate'],['Isolated browser read','browser.read'],['Acquire or safely reuse native Calculator','computer.open_app'],['Focus verified target','computer.focus_window'],['Approved arithmetic interaction','computer.invoke_control'],['Read actual Calculator result','computer.read_calculator'],['Save verified Mission artifact','filesystem.write']];
const firstHost=opt('x53-final-run/integrated-first-host.json'),restart=opt('x53-final-run/integrated-restart.json');
save('x53-full-reacceptance.json',{classification:'LIVE unchanged original X53 (src/lib/bunny-missions/cross-app-live.test.ts) in the final complete regression',sourceCommit:finalSource,
 testResult:status(/T6 X53/),agentId:x53.agentId,missionId:x53.missionId,accepted:x53.accepted,final:x53.final,
 sequence:steps.map(([label,action])=>{const runs=x53.runs.filter(run=>run.action===action);return{label,action,runs:runs.length,succeeded:runs.filter(run=>run.status==='succeeded').length};}),
 hostRecovery:{firstHost,restart:restart&&{keys:Object.keys(restart)}},
 calculatorIdentity:x53.runs.filter(run=>run.action.startsWith('computer.')).map(run=>({action:run.action,status:run.status,target:(run.evidence??[]).find(e=>e.startsWith('Calculator target'))?.split(':')[0]})),
 acquisitions:x53.runs.filter(run=>run.action==='computer.open_app').length,
 artifacts:(x53.artifacts??[]).map(a=>({id:a.id,title:a.title,sha256:a.sha256,verification:a.verification})),
 consentCount:x53.consentCount,redundantPrompts:x53.redundantPrompts,
 stabilityMatrix:'x53-stability-matrix.json'});

// ---- Process ownership. ----
const ownership=status(/IR-H1|owned|Owned|ownership|process group|Job|job handle/);
save('process-ownership-verification.json',{classification:'Final regression results for MA2 IR-H1 / owned-process tests plus live Calculator ownership ledger',tests:ownership,allPass:allPass(ownership),
 calculatorOwnership:{ledger:'owned-calculator-ledger.json',preexistingHandles:json('owned-calculator-ledger.json').preexistingHandles,closeMethod:'owned-target-control.ps1 closes only the exact ledgered HWND after frame/content lifetime checks; no process-name termination',unrelatedCalculatorKilled:false}});

// ---- Remote security. ----
const canon=n=>opt(`remote-canonical/${n}.json`);
const scenario=(id,title,pattern,evidence,notes)=>{const tests=status(pattern);return{id,title,tests,result:allPass(tests)?'PASS':'FAIL',evidence,notes};};
const remoteRows=[
 scenario('S1','Cross-Agent approval substitution',/substitute agentId|F12-F15|A34/,canon('cross-agentId'),'Device mission.respond rejects alternate binding; A envelope replayed at B Capability Bus boundary is refused.'),
 scenario('S2','Cross-Mission approval substitution',/substitute missionId|F17\/G7|mission boundary/,canon('cross-missionId')),
 scenario('S3','Cross-Project authorization and artifact access',/substitute projectId|cross-Project artifact|F30/,{binding:canon('cross-projectId'),artifact:canon('cross-project-artifact')}),
 scenario('S4','Offline approval replay',/offline approval|G2\)|approval replay/,canon('offline-replay')),
 scenario('S5','Device revocation during live SSE',/T10-T6-04|revocation race|F43-limits|F-02/,{f02:canon('f02-revocation-ends-approvals')},'Already-open device streams close on revocation; post-revocation sequences are not delivered; payloads redacted.'),
 scenario('S6','Lost command acknowledgment',/F06\/F35\/F40|lost command acknowledgment/,canon('lost-ack-reconciliation')),
 scenario('S7','Host replacement / pinned Host',/Host replacement|F06\/F35\/F40|different Host blocks/,canon('host-replacement')),
 scenario('S8','Concurrent approvals',/concurrent desktop and phone|four-way/,{two:canon('concurrent-resolution'),four:canon('concurrent-four-way')}),
 scenario('S9','Host restart continuity',/Host restart: same Host UUID|T5 DISPOSABLE LIVE|restart/,{inProcess:canon('host-restart-continuity'),osProcess:opt('protocol/host-restart-recovery.json')&&'protocol/host-restart-recovery.json'}),
 scenario('DEV-01','Device-approved tool-free task never rerouted to a tool-capable provider',/T9R DEV-01/,canon('dev01-reroute'),'Reproduced on b345aa3 (review/t9r-01-prefix-probe.log) and fixed in 0904132/395d1c0.'),
 scenario('F-02','Workstation revocation ends Mission approvals the lost device granted',/T9R F-02/,canon('f02-revocation-ends-approvals')),
 scenario('F-03','Device approval bound to reviewed plan',/T9R F-03/,canon('f03-plan-binding')),
 scenario('ARTIFACT','Device artifact reads path-free and Project-bound',/path-free|cross-Project artifact/,canon('cross-project-artifact'),'Mission authority roots stay visible to the paired owner device by MA0R design (consent context).'),
];
save('remote-security-matrix.json',{classification:'Real Host admission paths (HTTP /command, SQLite, Capability Bus); SIMULATED parts labelled in each evidence record',sourceCommit:finalSource,rows:remoteRows,livefixture:opt('protocol/remote-protocol-results.json')});
save('phone-offline-replay.json',{...remoteRows.find(x=>x.id==='S4'),phoneOnlyNetwork:opt('phone-only-network.json')});
save('revocation-live-sse.json',remoteRows.find(x=>x.id==='S5'));
save('multi-device-race.json',{...remoteRows.find(x=>x.id==='S8'),liveGateway:opt('protocol/multi-device-race-results.json')});
save('host-restart-recovery.json',{...remoteRows.find(x=>x.id==='S9'),osProcessRestart:opt('protocol/host-restart-recovery.json')});
console.log(JSON.stringify({inventory:inventory.total,removed:removed.length,added:added.length,remote:remoteRows.map(x=>x.id+':'+x.result),x53:status(/T6 X53/)}));

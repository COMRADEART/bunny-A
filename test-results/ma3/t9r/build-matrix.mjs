// Consolidates the four independent review rounds into t9r-adversarial-matrix.json with explicit dispositions,
// and writes network-validation.json from retained live receipts. Values come from the review JSON and receipts.
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
const root='test-results/ma3/t9r/',j=p=>JSON.parse(readFileSync(root+p,'utf8'));
const disposition={
 // round 1 (T9 remote layer, ea48c40)
 'F-01':['POLICY — owner decision','Reverted after b345aa3 broke accepted MA0R tests (missions.test.ts:412, capabilities.test.ts:264) that require a paired phone to approve exact Host-serialized Mission authority including write model steps. Escalated to the owner; not changed by T9R.'],
 'F-02':['FIXED','b345aa3 + 0904132 + 395d1c0: workstation revocation revokes and stops device-approved plain Missions, including failed ones (Retry refused). Test: T9R F-02.'],
 'F-03':['FIXED (narrowed)','After a replan a device approval must name the reviewed planReference (0904132). Unrevised plans keep MA0R semantics. Test: T9R F-03.'],
 'F-04':['POLICY — accepted design','Answering exact Host-offered WRITE/EXECUTE requests is the kept MA0/MA2/T9 phone right (remote-command-contract.md §2).'],
 'T-01':['ACCEPTED DESIGN','Path scrubbing reverted: MA0R test requires the phone to see the exact roots it consents to. Device artifact reads stay location-free; task cwd/process facts stay removed.'],
 'CAL-18':['LIMITATION (LOW)','Pre-existing non-crossApp computer path uses substring title match; each such action is individually consented. X53/cross-app path uses verified identity.'],
 'T9R-15':['REFUTED','Both verifiers refuted (log lines exist).'],
 // round 2 (b345aa3)
 'T9R-01':['FIXED','DEV-01 reroute escape reproduced on b345aa3 (review/t9r-01-prefix-probe.log); fixed in 0904132 (+ remote tags 395d1c0). Test: T9R DEV-01.'],
 'T9R-02':['POLICY — accepted design','Read-scope Mission provider sessions remain device-approvable under MA0R.'],
 'F02-1':['FIXED','Failed Missions included in revocation sweep (0904132).'],
 'T01-11':['WITHDRAWN','Applies only to the reverted T-01 scrubber.'],'T01-12':['LIMITATION (LOW)','Pre-existing hidePaths leaves the tail of a spaced path in a project.artifact fs error; device already sees roots by design.'],
 'REG-R20':['RESOLVED','Caused by b345aa3; reverted in 0904132; existing test green.'],'REG-R21':['RESOLVED','Caused by b345aa3; reverted in 0904132; existing test green.'],
 'A-01':['WITHDRAWN','Applies only to the reverted T-01 scrubber.'],
 // round 3 (0904132)
 'A07':['FIXED','deviceMayLaunch consults probed remoteModels and refuses empty model (395d1c0).'],
 'A4':['FIXED','Revocation sweep re-reads state before stop (395d1c0).'],
 'A04':['FIXED','Refused duplicate approve keeps the device marker (395d1c0); exercised in T9R DEV-01.'],
 'A09':['FIXED','F-02 now asserts the exact canonical Retry refusal (395d1c0).'],
 // round 4 (395d1c0)
 'F1':['LIMITATION (LOW)','Remote-tag refusal uses the registry snapshot; a suffix-less tag converted to a remote proxy by the workstation owner between refreshes could pass. Requires owner-side action; the phone cannot cause it.'],
 'T1':['TEST LABEL','One assertion message overstates coverage; revocation itself is asserted by revokedAt and the canonical Retry refusal.'],
 'T2':['LIMITATION (LOW)','Call-site wiring of remoteModels has no end-to-end failing assertion (unit + static review only).'],
};
const rounds=[['round-1 (ea48c40, T9 remote + native repair)','review/workflow-1.json',r=>r.reviewed.map(x=>({lens:x.lens,all:x.all,verified:x.verified}))],
 ['round-2 (b345aa3)','review/workflow-2.json',r=>r],['round-3 (0904132)','review/workflow-3.json',r=>r],
 ['round-4 (395d1c0)','review/workflow-4.json',r=>[{lens:'security',all:r[0].findings,verified:[]},{lens:'tests',all:r[1].findings,verified:[]}]]];
const rows=[];
for(const [round,file,shape] of rounds){for(const lens of shape(j(file))){for(const f of lens.all){const v=(lens.verified||[]).find(x=>x.id===f.id);const verdicts=v?.verdicts?.map(x=>({refuted:x.refuted,severity:x.realSeverity}))??null;const d=disposition[f.id];
 rows.push({round,lens:lens.lens,id:f.id,claimedSeverity:f.severity,blocked:f.blocked,title:f.title,verdicts,disposition:d?.[0]??(f.blocked?'BLOCKED (canonical boundary)':(['LOW','INFO'].includes(f.severity)?'LIMITATION (LOW/INFO) — recorded':'REVIEW')),note:d?.[1]??(f.blockedBy||'')});}}}
const open=rows.filter(r=>['HIGH','BLOCKER'].includes(r.claimedSeverity)&&!r.blocked&&!/FIXED|RESOLVED|REFUTED|WITHDRAWN|POLICY|TEST LABEL/.test(r.disposition));
writeFileSync(root+'t9r-adversarial-matrix.json',JSON.stringify({classification:'Four independent read-only adversarial review rounds (multi-agent, 2 refuters per open MEDIUM+ finding) plus executed reproductions where stated',rounds:rounds.map(r=>r[0]),totals:{findings:rows.length,blocked:rows.filter(r=>r.blocked).length,fixed:rows.filter(r=>/FIXED|RESOLVED/.test(r.disposition)).length,policy:rows.filter(r=>/POLICY|ACCEPTED DESIGN/.test(r.disposition)).length},unresolvedHighOrBlocker:open.map(r=>r.id),ownerPolicyDecisions:rows.filter(r=>/POLICY/.test(r.disposition)).map(r=>({id:r.id,title:r.title,note:r.note})),rows},null,2)+'\n');
const proto=JSON.parse(readFileSync(root+'protocol/remote-protocol-results.json','utf8'));
writeFileSync(root+'network-validation.json',JSON.stringify({classification:'Loopback-only transport validation; no LAN or internet path exercised',sourceCommit:'395d1c0a246d8f2b0c85c236e11a9a0437ad6456',
 loopbackTrustedTls:{result:proto.result,rows:proto.rows.map(r=>({id:r.id,title:r.title,result:r.result})),evidence:'protocol/remote-protocol-results.json'},
 transportDowngrade:JSON.parse(readFileSync(root+'protocol/transport-downgrade.json','utf8')),
 certificateTrust:proto.rows.find(r=>r.id==='F08'),
 phoneOnlyNetworkLoss:JSON.parse(readFileSync(root+'phone-only-network.json','utf8')),
 lan:{result:'NOT TESTED',reason:'No authorized physical phone on the Wi-Fi network (device-inventory.json); binding a disposable Host to the LAN interface without a real second device would only exercise the local stack.'},
 internet:{result:'NOT TESTED',reason:'Public tunnel not authorized; it was not started.'},
 publicTunnel:false,firewallChanged:false,productionNetworkConfigChanged:false},null,2)+'\n');
console.log(JSON.stringify({findings:rows.length,unresolvedHighOrBlocker:open.map(r=>r.id)}));

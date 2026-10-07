import{readFileSync,writeFileSync,copyFileSync}from'node:fs';
const root='test-results/ma2-gate10/';
for(const file of ['candidate-package.json','candidate-manifest.json'])copyFileSync(root+file,root+'v24-'+file);
for(const name of ['native-matrix','restart-fixture','restart-verify','offline-probe','ui-gateway','rollback-attacks','final-restart-campaign']){
 const extension=['offline-probe','ui-gateway'].includes(name)?'mjs':'ts';
 const old=name==='offline-probe'?name+'.mjs':name==='final-restart-campaign'?name+'.ts':name+'-v24.'+extension;
 let source=readFileSync(root+old,'utf8').replaceAll('v24','v25');
 if(name==='final-restart-campaign')source=source.replace("closeSync,writeFileSync,copyFileSync}","closeSync,writeFileSync,copyFileSync,existsSync}").replace("copyFileSync(rec+file,", "if(existsSync(rec+file))copyFileSync(rec+file,").replace("'final-native-operations.ps1'","'final-native-operations-v25.ps1'").replace("import('./offline-probe.mjs')","import('./offline-probe-v25.mjs')");
 writeFileSync(root+name+'-v25.'+extension,source);
}
let ops=readFileSync(root+'final-native-operations.ps1','utf8').replaceAll('v24','v25');
ops=ops.replace('ui-gateway-owner.json','ui-v24-gateway-owner-final.json').replace("-Entry 'ui-gateway.mjs'","-Entry 'ui-gateway-v24.mjs'").replace('ui-v22-gateway-cleanup.json','ui-v24-gateway-cleanup.json');
ops=ops.replace("-RollbackDirectory (Join-Path $stage 'roundtrip-v25\\tampered-bundle')",'-RollbackDirectory $config.rollbackDirectory');
writeFileSync(root+'final-native-operations-v25.ps1',ops);
let installer=readFileSync(root+'install-stage.ps1','utf8');
installer=installer.replace("$link=(New-Object", "if(-not(Test-Path -LiteralPath (Join-Path $stageRoot 'startup\\Bunny-A.lnk'))) {\n$link=(New-Object").replace('$link.Save()','$link.Save()\n}');
writeFileSync(root+'install-stage-v25.ps1',installer);

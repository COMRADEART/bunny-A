import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,relative,resolve,dirname,basename} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {importClosure} from '../../../scripts/bunny-release.mjs';
const root=mkdtempSync(join(tmpdir(),'bunny-t5-native-package-'));
try {
  const copy=(source,target)=>{mkdirSync(dirname(target),{recursive:true});copyFileSync(source,target);};
  const walk=directory=>{for(const item of readdirSync(directory,{withFileTypes:true})){const path=join(directory,item.name);if(item.isDirectory())walk(path);else if(item.name.endsWith('.ts')&&!item.name.endsWith('.test.ts'))copy(path,join(root,relative(process.cwd(),path)));}};
  for(const folder of ['bunny-host','orch','bunny-missions'])walk(resolve('src/lib',folder));
  copy('install/Bunny-Host.mjs',join(root,'Bunny-Host.mjs'));
  for(const file of ['scripts/bunny-tunnel.mjs','scripts/bunny-tunnel-state.mjs','scripts/bunny-tunnel-paths.mjs','scripts/bunny-tunnel-worker.mjs','scripts/build-owned-process.mjs','native/bunny-owned-process.c','native/bunny-owned-process.node','native/bunny-owned-process.node.json'])if(existsSync(file))copy(file,join(root,file));
  writeFileSync(join(root,'package.json'),'{"type":"module"}');
  const closure=importClosure(root);
  const imported=spawnSync(process.execPath,['--experimental-strip-types','--input-type=module','-e',"await import('./src/lib/bunny-missions/manager.server.ts'); await import('./src/lib/bunny-missions/capabilities/bounded-terminal.server.ts'); console.log('Native imports succeeded without node_modules');"],{cwd:root,encoding:'utf8',windowsHide:true});
  const upstream=readFileSync('node_modules/acorn/dist/acorn.mjs');const vendor=readFileSync('src/lib/bunny-missions/vendor/acorn.ts','utf8');
  const report={classification:'DISPOSABLE LIVE VERIFIED',closure,installedStyleImportsWithoutNodeModules:imported.status===0,output:imported.stdout,diagnostic:imported.status?imported.stderr:null,parserVersion:'8.18.0',upstreamSha256:createHash('sha256').update(upstream).digest('hex'),unchangedUpstreamBody:vendor.endsWith(upstream.toString()),licenseIncluded:vendor.includes('MIT License'),noProductionInstallation:true};
  writeFileSync('test-results/ma3/t5/native-package-closure.json',JSON.stringify(report,null,2));
  if(!closure.ok||imported.status!==0||!report.unchangedUpstreamBody)throw new Error('Native package validation failed.');
  console.log('Disposable native package closure and imports passed.');
}finally{if(!basename(root).startsWith('bunny-t5-native-package-')||dirname(root).toLowerCase()!==resolve(tmpdir()).toLowerCase())throw new Error('Unsafe fixture cleanup');rmSync(root,{recursive:true,force:true,maxRetries:10,retryDelay:50});}

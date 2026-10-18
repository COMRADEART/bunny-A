import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
const out = import.meta.dirname;
const repo = resolve(out, '../../..');
const baseline = 'b23005136c48036968036475e841dcf67a38a794';
const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 16000000 });
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex');
const save = (name, data) => writeFileSync(join(out, name), JSON.stringify(data, null, 2) + '\n');
if (process.argv[2] === 'snapshot') {
  const status = git('status', '--porcelain=v1', '-z').split('\0').filter(Boolean);
  const tracked = git('ls-files', '-z', '--modified').split('\0').filter(Boolean);
  const untracked = git('ls-files', '-z', '--others', '--exclude-standard').split('\0').filter(Boolean);
  const files = [...new Set([...tracked, ...untracked])].filter(p => existsSync(join(repo,p))).map(path => ({ path, sha256: hash(join(repo,path)) }));
  const delta = git('diff', '--name-only', baseline, 'HEAD').trim().split('\n').filter(Boolean);
  save('source-preservation-before.json', { recordedAt: new Date().toISOString(), branch: git('branch','--show-current').trim(), head: git('rev-parse','HEAD').trim(), baseline, committedDelta: delta, executableSourceUnchanged: delta.every(p => p.startsWith('test-results/ma3/t13-gate-closure/')), status, files });
  const indexRoot = join(repo, 'test-results/ma3/t13-gate-closure');
  const entries = readFileSync(join(indexRoot,'INDEX.sha256'),'utf8').trim().split('\n').map(line => { const [,sha,path] = /^(\S+)  (.+)$/.exec(line.trim()); return { path, matches: existsSync(join(indexRoot,path)) && hash(join(indexRoot,path)) === sha }; });
  save('previous-gates-integrity.json', { recordedAt: new Date().toISOString(), previousReceiptCommit: git('log','-1','--format=%H','--','test-results/ma3/t13-gate-closure/FINAL_ACCEPTANCE.md').trim(), checked: entries.length, allMatch: entries.every(e => e.matches), mismatches: entries.filter(e => !e.matches), freshExecution: false, limitation: 'Receipt integrity and unchanged executable source retain prior results; this does not repeat native, voice or browser testing.' });
  console.log(JSON.stringify({ snapshotFiles: files.length, priorReceipts: entries.length, receiptIntegrity: entries.every(e => e.matches), executableSourceUnchanged: delta.every(p => p.startsWith('test-results/ma3/t13-gate-closure/')) }));
} else if (process.argv[2] === 'transport') {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') throw new Error('TLS verification must remain enabled.');
  const installRoot = 'C:/Users/allam/AppData/Local/Bunny-A';
  const config = JSON.parse(readFileSync(join(installRoot,'install.json'),'utf8'));
  const release = config.currentRelease;
  const manifestPath = join(release.folder,'release-manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath,'utf8'));
  const relevant = manifest.files.filter(f => /^(?:src\/lib\/bunny-host\/(?:host|remote|release|types)|src\/lib\/bunny-missions\/|Bunny-(?:Host|Server)|src\/components\/.*(?:Remote|Pair)|src\/routes\/.*pair)/i.test(f.path));
  const differences = [];
  const payloadMismatches = relevant.filter(f => !existsSync(join(release.folder,f.path)) || hash(join(release.folder,f.path)) !== f.sha256).map(f=>f.path);
  for (const f of relevant) {
    if (f.origin !== 'source' || !f.repoPath) continue;
    let candidate;
    try { candidate = createHash('sha256').update(execFileSync('git',['cat-file','blob',`${baseline}:${f.repoPath}`],{cwd:repo,maxBuffer:16000000})).digest('hex'); } catch { candidate = null; }
    if (candidate !== f.sha256) differences.push({ path: f.repoPath, installedManifestHash: f.sha256, candidateHash: candidate });
  }
  const observations = [];
  async function probe(label,url) {
    const started = Date.now();
    try {
      const response = await fetch(url,{redirect:'manual',headers:{accept:'application/json'},signal:AbortSignal.timeout(12000)});
      let body; try {body = await response.json();} catch {body = null;}
      const identity = body?.release ?? body?.buildIdentity ?? null;
      observations.push({label,status:response.status,elapsedMs:Date.now()-started,app:body?.app,securityHeaders:Object.fromEntries(['x-frame-options','content-security-policy','referrer-policy'].map(k=>[k,response.headers.get(k)])),sourceCommit:identity?.sourceCommit ?? null,manifestSha256:identity?.manifestSha256 ?? null,hostSchemaVersion:body?.schemaVersion ?? null,responseBodyRetained:false});
    } catch(e) {observations.push({label,elapsedMs:Date.now()-started,error:e.cause?.code ?? e.name,responseBodyRetained:false});}
  }
  await probe('local-host-health',`http://127.0.0.1:${config.hostPort}/health`);
  await probe('local-gateway-health','http://127.0.0.1:8084/bunny-health');
  const remotePath = join(config.stateRoot ?? join(installRoot,'state'),'settings/remote.json');
  const remotePresent = existsSync(remotePath);
  let safeHttpsOrigin = false;
  if (remotePresent) {
    const remote = JSON.parse(readFileSync(remotePath,'utf8'));
    const url = new URL(remote.url);
    safeHttpsOrigin = url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash;
    if (!safeHttpsOrigin) throw new Error('Existing origin is not a safe HTTPS origin.');
    await probe('https-health',new URL('/bunny-health',url.origin));
    await probe('https-anonymous-events',new URL('/api/bunny-events',url.origin));
  }
  const result = {recordedAt:new Date().toISOString(),command:'node test-results/ma3/t13-phone-hardware/inspect-environment.mjs transport',readOnly:true,installedRelease:release.name,installedSource:manifest.sourceCommit,candidateSource:baseline,manifestSha256:hash(manifestPath),manifestMatchesInstallPin:hash(manifestPath)===release.manifestSha256,compatibility:manifest.compatibility,explicitPhoneProtocolVersion:manifest.protocol ?? null,explicitApiVersion:manifest.apiVersion ?? null,explicitPhoneCapabilities:manifest.capabilities ?? null,relevantFilesCompared:relevant.length,sourceDifferences:differences,observations,httpsOriginWithheld:true,tlsVerification:'platform defaults; no bypass',phoneNetworkReachability:'NOT TESTED',candidateCompatible:manifest.sourceCommit===baseline && differences.length===0,pairingAttempted:false,decision:manifest.sourceCommit===baseline && differences.length===0?'IDENTITY MATCH; remaining live prerequisites required':'BLOCKED: installed source differs, relevant candidate source differs, and deployment metadata provides no phone/API compatibility attestation'};
  result.remoteConfigPresent = remotePresent;
  result.safeHttpsOrigin = safeHttpsOrigin;
  result.relevantPayloadIntegrity = {checked:relevant.length,allMatch:payloadMismatches.length===0,mismatches:payloadMismatches};
  save('transport-observations.json',result);
  console.log(JSON.stringify({candidateCompatible:result.candidateCompatible,sourceDifferences:differences.map(f=>f.path),observations:observations.map(({label,status,error,sourceCommit})=>({label,status,error,sourceCommit}))}));
} else throw new Error('Expected snapshot or transport.');

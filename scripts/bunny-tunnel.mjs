// Outbound TLS tunnel only. The Host API remains loopback-only and the
// production web bridge requires a revocable paired-device cookie.
// The public address is state (remote.json), never a constant: a temporary quick tunnel by default,
// or a stable hostname configured in the installed settings/tunnel.json
// ({"mode":"named","hostname":"bunny.example.com","config":"C:\\Users\\you\\.cloudflared\\bunny-a.yml"}).
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { readyTunnelAddress, loopbackTunnelOrigin, startupTunnelDecision } from "./bunny-tunnel-state.mjs";
import { tunnelPaths, assertOutsideGit } from "./bunny-tunnel-paths.mjs";
import { execFileSync } from "node:child_process";
import { HostContainment } from "../src/lib/bunny-host/failure.server.ts";
import { superviseTunnel } from "./bunny-tunnel-worker.mjs";
if(existsSync(new URL("../release-manifest.json",import.meta.url)) && process.env.BUNNY_STATE_LAYOUT!=="2") throw new Error("Start the installed tunnel through the pinned release launcher. Legacy state fallback was refused.");
const paths=tunnelPaths();
const {root,data,binary}=paths;
if(!paths.installed) mkdirSync(data,{recursive:true});
const target=loopbackTunnelOrigin(process.env.BUNNY_TUNNEL_ORIGIN);
let child=null,receive=()=>{};
const controller=new AbortController();
const containment=new HostContainment({diagnosticDirectory:join(data,"logs/tunnel"),runtimeDirectory:join(data,"runtime/tunnel"),shutdown:async()=>{controller.abort();child?.kill();}});
const removeHandlers=containment.installProcessHandlers();
async function configure(enabled,url) {
  const credentials=JSON.parse(readFileSync(paths.credentials,"utf8"));
  const response=await fetch(`http://127.0.0.1:${credentials.port}/command`,{method:"POST",headers:{authorization:`Bearer ${credentials.token}`,"content-type":"application/json"},body:JSON.stringify({action:"remote.configure",data:{enabled,url}})});
  if(!response.ok) throw new Error("Host refused tunnel configuration.");
}
/** Named-tunnel settings, or null for the default temporary quick tunnel. */
function namedTunnel() {
  const path=paths.config;
  if(!existsSync(path)) return null;
  const settings=JSON.parse(readFileSync(path,"utf8"));
  if(settings.mode!=="named") return null;
  if(paths.installed) assertOutsideGit(settings.config);
  const origin=new URL(`https://${settings.hostname}`);
  if(origin.hostname!==settings.hostname || !existsSync(settings.config)) throw new Error("tunnel.json needs a bare hostname and an existing cloudflared config file.");
  return {url:origin.origin,config:settings.config};
}
function start() {
  if(paths.installed) tunnelPaths();
  const named=namedTunnel();
  const args=named ? ["tunnel","--no-autoupdate","--config",named.config,"run"] : ["tunnel","--no-autoupdate","--url",target,"--protocol","http2"];
  child=spawn(binary,args,{cwd:root,windowsHide:true,stdio:["ignore","pipe","pipe"]});
  const startedAt=process.platform==="win32" ? execFileSync(join(process.env.WINDIR,"System32/WindowsPowerShell/v1.0/powershell.exe"),["-NoProfile","-Command",`(Get-CimInstance Win32_Process -Filter 'ProcessId=${process.pid}').CreationDate.ToUniversalTime().ToString('o')`],{encoding:"utf8",windowsHide:true,env:{...process.env,PSModulePath:join(process.env.WINDIR,"System32/WindowsPowerShell/v1.0/Modules")}}).trim() : new Date().toISOString();
  writeFileSync(paths.process,JSON.stringify({pid:process.pid,childPid:child.pid,startedAt,root,mode:named ? "named" : "quick",target}));
  let pending="",configured=false;
  receive=async chunk=>{
    const value=String(chunk);pending=(pending+value).slice(-16000);
    // Quick tunnels announce their random hostname; a named tunnel's hostname is configured and is
    // published only once cloudflared reports a registered connection.
    const url=readyTunnelAddress(pending,named?.url);
    if(url && !configured) {
      configured=true;
      writeFileSync(paths.remote,JSON.stringify({url,temporary:!named,createdAt:Date.now(),tunnelPid:process.pid},null,2));
      await configure(true,url);
    }
  };
  return child;
}
async function unavailable(exit) {
  await configure(false);
  const remotePath=paths.remote;
  if(existsSync(remotePath) && JSON.parse(readFileSync(remotePath,"utf8")).tunnelPid===process.pid) unlinkSync(remotePath);
  console.log(`Tunnel exited (${exit}).`);
}
function pidAlive(pid) {
  try{process.kill(pid,0);return true;}catch(error){return error.code!=="ESRCH";}
}
function parseStateFile(path) {
  if(!existsSync(path)) return null;
  try{return JSON.parse(readFileSync(path,"utf8"));}catch{return null;}
}
// remote.json is owned by exactly one worker; a residue proves the recording
// worker died without running its cleanup (hard kill) and must not keep the
// Host pointing at a dead public address. A live foreign worker refuses us.
await (async function reconcileRecordedRemote() {
  const remote=parseStateFile(paths.remote),recorded=parseStateFile(paths.process);
  const decision=startupTunnelDecision({remote,recorded,pid:process.pid,pidAlive});
  if(decision.action==="refuse") throw new Error(`Remote transport is already managed by a live tunnel worker (pid ${decision.recordedPid}).`);
  if(decision.action!=="reconcile") return;
  if(existsSync(paths.remote)) unlinkSync(paths.remote);
  console.log(`Reconciled stale remote state (${decision.reason ?? "publication-without-record"}).`);
  try{await configure(false);}catch{console.log("Host remote reconfiguration deferred; the stale publication is cleared locally.");}
})();
const publishedUrl=()=>{
  const remote=parseStateFile(paths.remote);
  return remote?.tunnelPid===process.pid ? remote.url ?? null : null;
};
async function probeHealth(origin) {
  try{const response=await fetch(`${origin}/bunny-health`,{signal:AbortSignal.timeout(8000)});return response.status;}catch{return 0;}
}
const health={
  async probe() {
    const url=publishedUrl();
    if(!url) return null;
    const direct=await probeHealth(target);
    if(direct!==200) return {outcome:"origin"};
    const served=await probeHealth(url);
    return served===200 ? {outcome:"ok"} : {outcome:"public"};
  },
  onDegraded:(event)=>console.log(`Tunnel degraded (${event.reason}; ${event.activeCount} active edge connections, ${event.registeredTotal} registrations). Restarting the owned child; the Host stays independent.`),
};
for(const signal of ["SIGINT","SIGTERM"]) process.once(signal,()=>controller.abort());
const result=await superviseTunnel({start,output:chunk=>receive(chunk),unavailable,signal:controller.signal,containment,health});
removeHandlers();
if(result.degradations?.length) console.log(`Tunnel health: ${result.degradations.length} degradation(s) across ${result.attempts} attempt(s).`);
if(result.recoveryRequired) {console.error("Remote transport unavailable after three bounded attempts; local Host remains independent. Explicit relaunch required.");process.exitCode=2;}

import { scrubChildEnvironment } from "./connections.ts";
import { spawn } from "node:child_process";
import type { UsageWindow } from "../orch/types.ts";
import { trackOwnedChild } from "./owned-processes.server.ts";
import { OwnedProcessGroup, outputPipe } from "./owned-process-group.server.ts";

type Window={usedPercent?:number;windowDurationMins?:number|null;resetsAt?:number|null};
type Bucket={primary?:Window|null;secondary?:Window|null};
/** Official windows with their duration: weekly is the 10080-minute window, anything shorter is the short window. */
export function codexUsageWindows(bucket:Bucket|undefined):UsageWindow[] {
  const windows:UsageWindow[]=[];
  for(const [name,value] of [["Primary",bucket?.primary],["Secondary",bucket?.secondary]] as const) {
    if(!value || typeof value.usedPercent!=="number" || !Number.isFinite(value.usedPercent)) continue;
    const duration=value.windowDurationMins;
    const label=duration===10080 ? "Weekly" : duration ? `${duration/60} hour window` : name;
    const kind=duration===10080 ? "weekly" as const : duration && duration<10080 ? "short" as const : "other" as const;
    windows.push({label,usedPercent:Math.min(100,Math.max(0,value.usedPercent)),resetsAt:value.resetsAt==null ? null : value.resetsAt*1000,kind,windowMinutes:duration ?? null});
  }
  return windows;
}
export function quotaWindows(bucket:Bucket|undefined):{label:string;usedPercent:number;resetsAt:number|null}[] {
  return codexUsageWindows(bucket).map(({label,usedPercent,resetsAt})=>({label,usedPercent,resetsAt}));
}
type Transport={write:(text:string)=>void;close:()=>Promise<void>};
/**
 * M-A-3 T9R-F04 (review round 1, BYPASS-2): on Windows the app-server probe runs in its own Bunny-owned job with a
 * bounded, Host-held stdin writer, and closing terminates the whole job. Containment failure rejects the probe (no
 * fallback); Codex is then reported without a readable catalogue, which refuses launch.
 */
async function containedTransport(command:string,args:string[],onData:(chunk:Buffer)=>void,onExit:()=>void):Promise<Transport> {
  const out=await outputPipe(onData),err=await outputPipe(()=>{});
  let group:OwnedProcessGroup|null=null,poll:ReturnType<typeof setInterval>|null=null;
  const close=async()=>{
    if(poll) clearInterval(poll);
    if(group?.live) {
      group.endInput();
      for(let tries=0;group.terminate()!==0&&tries<50;tries++) await new Promise(resolve=>setTimeout(resolve,100));
      group.close("stopped");
    }
    await Promise.all([out.close(),err.close()]);
  };
  try {
    group=new OwnedProcessGroup(command,process.cwd(),{action:"provider.probe"});
    group.spawn(command,args,process.cwd(),scrubChildEnvironment(process.env).env,out.name,err.name,true);
  } catch(error) {await close().catch(()=>{});throw error;}
  const owned=group;
  poll=setInterval(()=>{try {if(owned.inspect().exitCode!==null) onExit();} catch {onExit();}},100);
  return {write:(text)=>owned.writeInput(Buffer.from(text,"utf8")),close};
}
// Official stdio app-server methods, verified against this installed CLI's
// generated schema. No account secrets or raw authentication payloads escape.
export async function probeCodexCatalog(command:string,prefix:string[]=[],readAccount=false):Promise<{model:string|null;models:string[];usageWindows:UsageWindow[];limited:boolean;usageRead:boolean;account?:{type:string;email:string|null;planType:string|null}|null}> {
  const pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void}>();let sequence=0,buffer="";
  const fail=(error:Error)=>{for(const row of pending.values()) row.reject(error);pending.clear();};
  let transport:Transport|null=null;
  const onData=(chunk:Buffer)=>{buffer+=String(chunk);if(buffer.length>2_000_000) {fail(new Error("Codex discovery output exceeded its bound."));void transport?.close();return;}let at:number;while((at=buffer.indexOf("\n"))>=0) {
    const line=buffer.slice(0,at);buffer=buffer.slice(at+1);
    try {const message=JSON.parse(line);const row=pending.get(message.id);if(row){pending.delete(message.id);if(message.error) row.reject(new Error("Codex catalog/usage method unavailable."));else row.resolve(message.result);}} catch { /* Diagnostics are not protocol events. */ }
  }};
  const exited=()=>fail(new Error("Codex app-server exited during discovery."));
  const args=[...prefix,"app-server","--stdio","-c",'model_provider="openai"'];
  if(process.platform==="win32") transport=await containedTransport(command,args,onData,exited);
  else {
    const child=trackOwnedChild(spawn(command,args,{env:scrubChildEnvironment(process.env).env,windowsHide:true,shell:false,stdio:["pipe","pipe","pipe"]}));
    child.once("error",fail);child.once("exit",exited);
    child.stderr.on("data",()=>{});child.stdin.on("error",()=>{});
    child.stdout.on("error",fail);child.stderr.on("error",fail);child.stdout.on("data",onData);
    transport={write:(text)=>{child.stdin.write(text);},close:async()=>{child.stdin.end();child.kill();}};
  }
  const channel=transport;
  const request=(method:string,params:unknown)=>new Promise<unknown>((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});try {channel.write(JSON.stringify({id,method,params})+"\n");} catch(error) {pending.delete(id);reject(error instanceof Error ? error : new Error(String(error)));}});
  const timeout=setTimeout(()=>{fail(new Error("Codex discovery timed out."));void channel.close();},8000);
  try {
    await request("initialize",{clientInfo:{name:"bunny_a_host",version:"0.2.0"},capabilities:{experimentalApi:false}});
    channel.write('{"method":"initialized","params":{}}\n');
    const [models,usage,accountResult]=await Promise.all([
      request("model/list",{includeHidden:false}).catch(()=>null),
      request("account/rateLimits/read",{}).catch(()=>null),
      readAccount ? request("account/read",{refreshToken:false}).catch(()=>null) : Promise.resolve(null),
    ]);
    const catalogue=models as {data?:{model:string;isDefault?:boolean;hidden?:boolean}[]}|null;
    const visible=(catalogue?.data ?? []).filter(m=>!m.hidden);
    const model=visible.find(m=>m.isDefault)?.model ?? visible[0]?.model ?? null;
    const limits=usage as {rateLimits?:Bucket;rateLimitsByLimitId?:Record<string,Bucket>;ordinaryUsageAllowed?:boolean}|null;
    const usageWindows=codexUsageWindows(limits?.rateLimitsByLimitId?.codex ?? limits?.rateLimits);
    const a=(accountResult as {account?:{type?:unknown;email?:unknown;planType?:unknown}}|null)?.account;
    const account=a&&typeof a.type==="string"?{type:a.type,email:typeof a.email==="string"?a.email:null,planType:typeof a.planType==="string"?a.planType:null}:null;
    return {model,models:visible.map(m=>m.model),usageWindows,limited:limits?.ordinaryUsageAllowed === false,usageRead:!!limits,...(readAccount?{account}:{})};
  } finally {clearTimeout(timeout);await channel.close();}
}

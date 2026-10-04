import { spawn } from "node:child_process";
import type { UsageWindow } from "../orch/types.ts";
import { trackOwnedChild } from "./owned-processes.server.ts";

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
// Official stdio app-server methods, verified against this installed CLI's
// generated schema. No account secrets or raw authentication payloads escape.
export async function probeCodexCatalog(command:string,prefix:string[]=[]):Promise<{model:string|null;models:string[];usageWindows:UsageWindow[];limited:boolean;usageRead:boolean}> {
  const child=trackOwnedChild(spawn(command,[...prefix,"app-server","--stdio"],{windowsHide:true,shell:false,stdio:["pipe","pipe","pipe"]}));
  const pending=new Map<number,{resolve:(value:unknown)=>void;reject:(error:Error)=>void}>();let sequence=0,buffer="";
  const fail=(error:Error)=>{for(const row of pending.values()) row.reject(error);pending.clear();};
  child.once("error",fail);child.once("exit",()=>fail(new Error("Codex app-server exited during discovery.")));
  child.stderr.on("data",()=>{});child.stdin.on("error",()=>{});
  child.stdout.on("error",fail);child.stderr.on("error",fail);
  child.stdout.on("data",chunk=>{buffer+=String(chunk);if(buffer.length>2_000_000) {fail(new Error("Codex discovery output exceeded its bound."));child.kill();return;}let at:number;while((at=buffer.indexOf("\n"))>=0) {
    const line=buffer.slice(0,at);buffer=buffer.slice(at+1);
    try {const message=JSON.parse(line);const row=pending.get(message.id);if(row){pending.delete(message.id);if(message.error) row.reject(new Error("Codex catalog/usage method unavailable."));else row.resolve(message.result);}} catch { /* Diagnostics are not protocol events. */ }
  }});
  const request=(method:string,params:unknown)=>new Promise<unknown>((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+"\n");});
  const timeout=setTimeout(()=>{fail(new Error("Codex discovery timed out."));child.kill();},8000);
  try {
    await request("initialize",{clientInfo:{name:"bunny_a_host",version:"0.2.0"},capabilities:{experimentalApi:false}});
    child.stdin.write('{"method":"initialized","params":{}}\n');
    const [models,usage]=await Promise.all([
      request("model/list",{includeHidden:false}).catch(()=>null),
      request("account/rateLimits/read",{}).catch(()=>null),
    ]);
    const catalogue=models as {data?:{model:string;isDefault?:boolean;hidden?:boolean}[]}|null;
    const visible=(catalogue?.data ?? []).filter(m=>!m.hidden);
    const model=visible.find(m=>m.isDefault)?.model ?? visible[0]?.model ?? null;
    const limits=usage as {rateLimits?:Bucket;rateLimitsByLimitId?:Record<string,Bucket>;ordinaryUsageAllowed?:boolean}|null;
    const usageWindows=codexUsageWindows(limits?.rateLimitsByLimitId?.codex ?? limits?.rateLimits);
    return {model,models:visible.map(m=>m.model),usageWindows,limited:limits?.ordinaryUsageAllowed === false,usageRead:!!limits};
  } finally {clearTimeout(timeout);child.stdin.end();child.kill();}
}

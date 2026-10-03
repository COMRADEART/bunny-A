import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { HostDatabase } from "./persistence.server.ts";
import { TaskManager } from "./manager.server.ts";
import { sampleHost } from "../orch/telemetry.server.ts";
import { validateVerifySpec, verifyTask } from "./verification.server.ts";
import type { Mode, OrchTask, Project, ProviderId, TaskConstraints } from "../orch/types.ts";
import type { AgentSession, HostSnapshot } from "./contracts.ts";
import { MissionManager, type MissionManagerOptions } from "../bunny-missions/manager.server.ts";
import { MISSION_ACTIONS, missionCommand } from "../bunny-missions/commands.server.ts";
import { hostStatePaths } from "./state-paths.server.ts";

const PROVIDERS: ProviderId[]=["codex","claude","ollama","opencode","cline","cursor"];
function record(value: unknown): Record<string,unknown> {if(!value || typeof value!=="object" || Array.isArray(value)) throw new Error("Expected an object.");return value as Record<string,unknown>;}
function text(value: unknown,max=100000): string {if(typeof value!=="string" || !value.trim() || value.length>max) throw new Error("Invalid or oversized text.");return value;}
function provider(value: unknown): ProviderId {if(!PROVIDERS.includes(value as ProviderId)) throw new Error("Unknown provider.");return value as ProviderId;}
export function validateConstraints(value: unknown): TaskConstraints {
  if(value===undefined) return {};
  const input=record(value);const output:TaskConstraints={};
  for(const key of ["localOnly","offlineOnly","requiresFilesystem","requiresTerminal","requiresGit","requiresGPU"] as const) if(input[key]!==undefined) {if(typeof input[key]!=="boolean") throw new Error("Invalid constraint.");output[key]=input[key];}
  if(input.workingDirectory!==undefined) output.workingDirectory=text(input.workingDirectory,2000);
  for(const key of ["providerAllowlist","providerDenylist"] as const) if(input[key]!==undefined) {if(!Array.isArray(input[key]) || input[key].length>6) throw new Error("Invalid provider constraint.");output[key]=input[key].map(provider);}
  if(input.maxRuntimeMs!==undefined) {if(!Number.isInteger(input.maxRuntimeMs) || Number(input.maxRuntimeMs)<1000 || Number(input.maxRuntimeMs)>3600000) throw new Error("Runtime must be 1–3600 seconds.");output.maxRuntimeMs=Number(input.maxRuntimeMs);}
  for(const key of Object.keys(input)) if(!(key in output)) throw new Error(`Unsupported constraint: ${key}`);
  return output;
}
export function validateSubmit(value: unknown) {
  const input=record(value);const mode=input.mode;
  if(!["fast","balanced","deep"].includes(String(mode))) throw new Error("Unknown routing mode.");
  const projectId=input.projectId==null ? null : text(input.projectId,200);
  const override=input.override===undefined || input.override === "auto" ? "auto" as const : provider(input.override);
  return {prompt:text(input.prompt),mode:mode as Mode,projectId,override,constraints:validateConstraints(input.constraints),verify:validateVerifySpec(input.verify)};
}
/** Counts failures only, in a fixed window that blocked requests never extend, and clears on success. */
export class FailureLimiter {
  entries=new Map<string,{count:number;resetAt:number}>();
  limit:number;windowMs:number;maxKeys:number;
  constructor(limit:number,windowMs:number,maxKeys=1000) {this.limit=limit;this.windowMs=windowMs;this.maxKeys=maxKeys;}
  blocked(key:string,now=Date.now()) {const e=this.entries.get(key);if(!e) return false;if(e.resetAt<=now) {this.entries.delete(key);return false;}return e.count>=this.limit;}
  fail(key:string,now=Date.now()) {
    const e=this.entries.get(key);
    if(e && e.resetAt>now) {e.count++;return;}
    this.entries.delete(key);
    if(this.entries.size>=this.maxKeys) {for(const [k,v] of this.entries) if(v.resetAt<=now) this.entries.delete(k);if(this.entries.size>=this.maxKeys) this.entries.delete(this.entries.keys().next().value!);}
    this.entries.set(key,{count:1,resetAt:now+this.windowMs});
  }
  succeed(key:string) {this.entries.delete(key);}
}
function hash(value: string) {return createHash("sha256").update(value).digest("hex");}
function equal(a: string,b: string) {const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length && timingSafeEqual(aa,bb);}
async function body(request: IncomingMessage) {let data="";for await(const chunk of request) {data+=String(chunk);if(Buffer.byteLength(data)>4_000_000) throw new Error("Request too large.");}return record(JSON.parse(data));}
// charset is explicit: Windows PowerShell 5.1 (the native Island) otherwise decodes JSON as Latin-1.
function json(response: ServerResponse,value: unknown,status=200) {response.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store","x-content-type-options":"nosniff"});response.end(JSON.stringify(value));}

export async function startHost(options: { dataDirectory?: string; root?: string; port?: number; missions?: Omit<MissionManagerOptions,"dataDirectory"> }={}) {
  const paths=hostStatePaths(options.dataDirectory);
  const dataDirectory=paths.data;
  if(!paths.installed) mkdirSync(dataDirectory,{recursive:true});
  const credentialPath=paths.credentials;
  const saved=existsSync(credentialPath) ? JSON.parse(readFileSync(credentialPath,"utf8")) as { token: string } : null;
  const token=saved?.token ?? randomBytes(32).toString("base64url");
  const port=options.port ?? Number(process.env.BUNNY_HOST_PORT ?? 43119);
  const db=new HostDatabase(paths.database);
  const manager=new TaskManager(db,options.root ?? process.cwd(),undefined,{sessionDirectory:paths.sessions});
  // M-A-0 mission layer: additive tables are created, but nothing runs unless missions are enabled.
  const missions=new MissionManager(manager,{dataDirectory,...options.missions});
  const snapshot=(after:number):HostSnapshot=>({...manager.snapshot(after),missions:missions.snapshot()});
  manager.remoteConfigured=!!process.env.BUNNY_REMOTE_ORIGIN || existsSync(paths.remote);
  if(existsSync(paths.remote)) manager.remoteUrl=JSON.parse(readFileSync(paths.remote,"utf8")).url;
  let pairing: {codeHash: string;expiresAt:number} | null=null;
  // Per-client limit stops guessing from one source; the global cap stops header rotation.
  // Pairing codes carry 96 bits of entropy, so both limits are defence in depth.
  const clientAttempts=new FailureLimiter(5,600000);
  const globalAttempts=new FailureLimiter(100,600000,1);
  const server=createServer(async(req,res)=>{
    const host=req.headers.host ?? "";
    if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host)) return json(res,{error:"Host header rejected."},403);
    if(req.headers.origin || req.headers["sec-fetch-site"] === "cross-site") return json(res,{error:"Use the authenticated same-origin application bridge."},403);
    const path=new URL(req.url ?? "/",`http://${host}`);
    if(path.pathname === "/health" && req.method === "GET") return json(res,{app:"Bunny-A",instanceId:manager.instanceId,pid:process.pid});
    const bearer=(req.headers.authorization ?? "").replace(/^Bearer /,"");
    const local=equal(bearer,token);
    const device=local ? null : db.db.prepare("SELECT id FROM devices WHERE token_hash=? AND revoked_at IS NULL").get(hash(bearer)) as { id:string } | undefined;
    if(path.pathname === "/pair" && req.method === "POST") {
      const key=String(req.headers["x-bunny-pair-client"] ?? "bridge").slice(0,80);const now=Date.now();
      if(clientAttempts.blocked(key,now) || globalAttempts.blocked("*",now)) return json(res,{error:"Pairing attempts limited. Try again later."},429);
      const reject=(status:number,error:string)=>{clientAttempts.fail(key,now);globalAttempts.fail("*",now);return json(res,{error},status);};
      try {
        const input=await body(req);
        if(!pairing || pairing.expiresAt<now || !equal(hash(text(input.code,100)),pairing.codeHash)) return reject(403,"Invalid or expired pairing code.");
        const deviceToken=randomBytes(32).toString("base64url");const id=randomUUID();
        db.db.prepare("INSERT INTO devices VALUES(?,?,?,?,NULL)").run(id,text(input.name,100),hash(deviceToken),now);
        pairing=null;clientAttempts.succeed(key);manager.emit(db.event("device.paired",null,`Paired device ${id}`));
        return json(res,{token:deviceToken,deviceId:id});
      } catch(error) {return reject(400,String(error));}
    }
    if(!local && !device) return json(res,{error:"Authentication required."},401);
    try {
      const after=Number(path.searchParams.get("after") ?? 0);if(!Number.isSafeInteger(after) || after<0) throw new Error("Invalid event cursor.");
      if(req.method === "GET" && path.pathname === "/state") return json(res,snapshot(after));
      if(req.method === "GET" && path.pathname === "/events") {
        res.writeHead(200,{"content-type":"text/event-stream; charset=utf-8","cache-control":"no-cache","connection":"keep-alive"});
        let cursor=after;const taskId=path.searchParams.get("task");
        // ?task=<id> streams one task's normalized events (the Host-side streamEvents for that session).
        const read=(from:number)=>taskId ? db.taskEvents(taskId,from) : db.events(from);
        const drain=()=>{let events;do {events=read(cursor);for(const event of events) {res.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`);cursor=event.sequence;}} while(events.length===500);};
        drain();manager.bus.on("event",drain);const heartbeat=setInterval(()=>res.write(": heartbeat\n\n"),15000);
        req.on("close",()=>{clearInterval(heartbeat);manager.bus.off("event",drain);});return;
      }
      if(req.method!=="POST" || path.pathname!=="/command") return json(res,{error:"Not found"},404);
      const input=await body(req);const data=record(input.data ?? {});let task:OrchTask | undefined;let pairCode:string | undefined;let session:AgentSession | undefined;let extra:{mission?:unknown;data?:unknown}={};
      if(typeof input.action==="string" && MISSION_ACTIONS.has(input.action)) extra=await missionCommand(missions,input.action,data,{local,actor:local ? "workstation" : `device:${device!.id}`});
      else switch(input.action) {
        case "submit": task=manager.submit(validateSubmit(data));break;
        case "approve": task=manager.approve(text(data.id,200),local ? "workstation" : `device:${device!.id}`);break;
        case "stop": task=await manager.stop(text(data.id,200));break;
        case "retarget": task=manager.retarget(text(data.id,200),provider(data.provider));break;
        case "discover": await manager.discover();break;
        case "session.get": session=manager.getSession(text(data.id,200));break;
        case "input": case "session.input": await manager.sendInput(text(data.id,200),text(data.input,100000));break;
        case "terminal": manager.terminal(text(data.id,200));break;
        case "task.feedback": {
          if(data.value!=="positive" && data.value!=="negative") throw new Error("Feedback must be positive or negative.");
          task=manager.feedback(text(data.id,200),data.value);break;
        }
        case "provider.configure_path":
          if(!local) throw new Error("Executable paths can only be configured on the workstation.");
          await manager.configureProviderPath(provider(data.provider),data.path==null ? null : text(data.path,2000));break;
        case "remote.configure":
          if(!local) throw new Error("Remote connection configuration requires workstation access.");
          if(typeof data.enabled!=="boolean") throw new Error("Invalid remote connection setting.");
          if(data.enabled) {const url=new URL(text(data.url,2000));if(url.protocol!=="https:" || url.username || url.password || url.pathname!=="/" || url.search || url.hash) throw new Error("Expected an HTTPS origin.");manager.remoteUrl=url.origin;}
          manager.remoteConfigured=data.enabled;break;
        case "thermal.configure":
          if(!local) throw new Error("Thermal policy configuration requires workstation access.");
          if(typeof data.autoStop!=="boolean") throw new Error("Explicit automatic-stop preference required.");
          manager.configureThermal(Number(data.cpuWarn),Number(data.gpuWarn),data.autoStop);break;
        case "verification.record": {
          if(!local) throw new Error("Independent verification requires workstation access.");
          const original=db.get(text(data.id,200));const verification=await verifyTask(original,text(data.kind,100));
          task=manager.update(original,{verification},"verification.completed",verification.detail);
          db.outcome(task);break;
        }
        case "policy.candidate": {
          if(!local) throw new Error("Policy evaluation requires workstation access.");
          const result=manager.policy.candidate(Number(data.historyWeight),Number(data.workloadWeight),manager.live(),data.latencyWeight===undefined ? 0 : Number(data.latencyWeight));
          manager.emit(db.event("policy.evaluated",null,JSON.stringify(result)));break;
        }
        case "policy.promote":
          if(!local) throw new Error("Policy promotion requires workstation access.");
          manager.policy.promote(text(data.id,200));break;
        case "policy.rollback":
          if(!local) throw new Error("Policy rollback requires workstation access.");
          manager.policy.rollback();break;
        case "project.add":
          if(!local) throw new Error("Project root registration requires this workstation.");
          manager.registerProject(text(data.name,100),text(data.path,2000));break;
        case "project.remove": {
          if(!local) throw new Error("Project removal requires this workstation.");
          const id=text(data.id,200);if(manager.db.tasks().some(t=>t.projectId===id && !["completed","failed","stopped"].includes(t.state))) throw new Error("Project has active tasks.");
          db.db.prepare("DELETE FROM projects WHERE id=?").run(id);break;
        }
        case "legacy.import": {
          if(!local) throw new Error("Legacy import requires workstation access.");
          if(!Array.isArray(data.tasks) || !Array.isArray(data.projects) || data.tasks.length>100 || data.projects.length>100) throw new Error("Invalid migration.");
          for(const value of data.tasks) {const t=record(value);text(t.id,200);text(t.prompt);provider(t.provider);record(t.decision);if(!Array.isArray(t.logs) || !Number.isFinite(t.createdAt)) throw new Error("Invalid legacy task.");}
          for(const value of data.projects) {const p=record(value);text(p.id,200);text(p.path,2000);text(p.name,100);}
          manager.importLegacy(data.tasks as OrchTask[],data.projects as Project[]);break;
        }
        case "pairing.create": {
          if(!local) throw new Error("Pairing can only be initiated on the workstation.");
          pairCode=randomBytes(12).toString("base64url");pairing={codeHash:hash(pairCode),expiresAt:Date.now()+600000};manager.emit(db.event("pairing.created",null,"One-time pairing code created; expires in 10 minutes."));break;
        }
        case "device.revoke":
          if(!local) throw new Error("Device revocation requires workstation access.");
          db.db.prepare("UPDATE devices SET revoked_at=? WHERE id=?").run(Date.now(),text(data.id,200));manager.emit(db.event("device.revoked",null,"Device credential revoked."));break;
        case "resume": case "pause": throw new Error("Pause and resume are not supported: the current provider sessions expose no reliable pause or resume mechanism.");
        default: throw new Error("Unknown Host action.");
      }
      manager.emit(db.event("audit.command",task?.id ?? null,`${local ? "workstation" : `device ${device!.id}`}: ${String(input.action)}`));
      json(res,{snapshot:snapshot(after),task,pairCode,session,...extra});
    } catch(error) {json(res,{error:error instanceof Error ? error.message : String(error)},400);}
  });
  await new Promise<void>((resolveListen,reject)=>{server.once("error",reject);server.listen(port,"127.0.0.1",resolveListen);});
  writeFileSync(credentialPath,JSON.stringify({token,port,pid:process.pid,instanceId:manager.instanceId}),{mode:0o600});
  await manager.discover();
  let closing=false;
  const poll=async()=>{if(closing) return;try {manager.sample(await sampleHost());} catch { /* Sensor failure leaves last known samples and timestamps. */ }};
  // Every 30 s: cheap health checks; full CLI probes only when their interval is due (the registry decides).
  await poll();const telemetry=setInterval(()=>void poll(),3000);const discovery=setInterval(()=>void manager.refreshProviders().catch(()=>{}),30000);
  const close=async()=>{closing=true;clearInterval(telemetry);clearInterval(discovery);for(const id of manager.sessions.keys()) await manager.stop(id,"Host shutdown stopped this owned task.").catch(()=>{});await missions.close().catch(()=>{});await new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r());});db.close();};
  process.once("SIGTERM",()=>void close().then(()=>process.exit(0)));process.once("SIGINT",()=>void close().then(()=>process.exit(0)));
  console.log(`Bunny-A Host ready on loopback (${manager.instanceId}).`);
  return {server,manager,missions,close,token,port};
}

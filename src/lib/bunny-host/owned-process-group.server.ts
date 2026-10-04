import { randomUUID, createHash } from "node:crypto";
import { createRequire } from "node:module";
import { createServer, type Socket } from "node:net";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread } from "node:worker_threads";
import { assertApplicationDirectory } from "./state-paths.server.ts";
import { trackOwnedGroup } from "./owned-processes.server.ts";

export type OwnedProcessIdentity = { pid: number; createdAt: number; file?: string };
export type OwnedProcessRecord = {
  schema: "bunny-owned-operation/1"; operationId: string; missionId: string | null; stepId: string | null;
  capabilityRunId: string | null; containerId: string; mechanism: "windows-job-object";
  launcherPath: string; launcherPid: number; launcherCreatedAt: number; members: OwnedProcessIdentity[];
  startedAt: number; endedAt: number | null; repo: string; cwd: string; action: string;
  state: "running" | "succeeded" | "failed" | "stopped" | "timeout" | "interrupted";
  exitCode: number | null; killOnClose: true; breakaway: false; closed: boolean;
};
export type ProcessOwner = { missionId?: string | null; stepId?: string | null; capabilityRunId?: string | null; dataDirectory?: string; action?: string; records?: OwnedProcessRecord[] };
type Snapshot = { launcherPid: number; launcherCreatedAt: number; exitCode: number | null; limitFlags: number; members: OwnedProcessIdentity[] };
type Native = { launch(file: string, line: string, cwd: string, env: string, out: string, err: string): object; inspect(group: object): Snapshot; close(group: object): void };
const root = fileURLToPath(new URL("../../../", import.meta.url));
let loaded: Native | undefined;
/** Integrity is checked before loading native code. Packaged authority comes
 * from the release manifest; a source build must match its current C source. */
export function windowsOwnershipModule(): Native {
  if (process.platform !== "win32" || process.arch !== "x64" || !isMainThread) throw new Error("Windows ownership requires the reviewed Windows x64 Host main thread.");
  if (loaded) return loaded;
  const relative = "native/bunny-owned-process.node", binary = join(root, relative);
  const hash = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const proof = JSON.parse(readFileSync(binary + ".json", "utf8"));
  if (proof.schema !== "bunny-native-build/1" || proof.architecture !== "windows-x64" || proof.nodeApi !== 8 || hash(binary) !== proof.binarySha256 || hash(join(root,"native/bunny-owned-process.c")) !== proof.sourceSha256) throw new Error("Windows ownership native build integrity failed; Git was not launched.");
  const manifestPath = join(root,"release-manifest.json");
  if (existsSync(manifestPath)) {
    const manifest = JSON.parse(readFileSync(manifestPath,"utf8"));
    for (const path of [relative, relative + ".json", "native/bunny-owned-process.c"]) {
      if (manifest.files.find((file: {path:string;sha256:string}) => file.path === path)?.sha256 !== hash(join(root,path))) throw new Error("Windows ownership release integrity failed; Git was not launched.");
    }
    if (manifest.compatibility.gitProcessOwnershipPolicyVersion !== 1) throw new Error("Windows ownership policy is missing from the release.");
  }
  loaded = createRequire(import.meta.url)(binary) as Native;
  return loaded;
}
/** Windows argv quoting (CreateProcess/CommandLineToArgvW conventions), no shell. */
export function windowsArgument(value: string) {
  if (value.includes("\0")) throw new Error("Process arguments cannot contain NUL.");
  return '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, '$1$1') + '"';
}
export function windowsEnvironment(env: NodeJS.ProcessEnv) {
  const unique = new Map<string,[string,string]>();
  for (const [key,value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (key.includes("=") || key.includes("\0") || value.includes("\0")) throw new Error("Invalid process environment.");
    unique.set(key.toUpperCase(),[key,value]);
  }
  return [...unique.values()].sort(([a],[b]) => a.toUpperCase().localeCompare(b.toUpperCase())).map(([key,value]) => `${key}=${value}`).join("\0") + "\0\0";
}
function recordPath(owner: ProcessOwner, id: string) {
  if (!owner.dataDirectory) return null;
  const folder = assertApplicationDirectory(join(owner.dataDirectory,"runtime/git-operations"));
  mkdirSync(folder,{recursive:true});return join(folder,id + ".json");
}
function persist(path: string | null, record: OwnedProcessRecord) {
  if (!path) return;
  const temporary=path+".tmp";writeFileSync(temporary,JSON.stringify(record)+"\n",{mode:0o600});renameSync(temporary,path);
}
/** Restart can mark history interrupted, NEVER recreate handles or kill PIDs. */
export function recoverOwnedGitOperations(dataDirectory: string) {
  const folder=assertApplicationDirectory(join(dataDirectory,"runtime/git-operations"));
  if(!existsSync(folder)) return 0;
  let recovered=0;
  for(const name of readdirSync(folder)) {
    if(!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
    const path=join(folder,name),record=JSON.parse(readFileSync(path,"utf8")) as OwnedProcessRecord;
    if(record.schema!=="bunny-owned-operation/1") throw new Error("Unknown Git ownership history schema.");
    if(record.state==="running") {record.state="interrupted";record.endedAt=Date.now();record.closed=true;persist(path,record);recovered++;}
  }
  return recovered;
}
async function outputPipe(append: (chunk: Buffer) => void) {
  const name=`\\\\.\\pipe\\bunny-owned-${randomUUID()}`;
  const sockets=new Set<Socket>();
  const server=createServer(socket=>{sockets.add(socket);socket.on("data",append);socket.on("error",()=>{});socket.once("close",()=>sockets.delete(socket));});
  await new Promise<void>((done,reject)=>{server.once("error",reject);server.listen(name,done);});
  return {name,close:async()=>{
    // Kill-on-close ends pipe writers first. Bound draining even for broken I/O.
    await new Promise<void>(done=>{
      const timer=setTimeout(()=>{for(const socket of sockets) socket.destroy();done();},1500);
      server.close(()=>{clearTimeout(timer);done();});
    });
  }};
}
/** One live kernel-backed boundary per operation. The opaque native external
 * never appears in records, IPC, diagnostics or a restart interface. */
export class OwnedProcessGroup {
  private native: Native; private handle: object | null=null;
  private record: OwnedProcessRecord; private path: string | null;
  private release: () => void = () => {};
  private stopping: (() => void) | null=null;
  constructor(file: string,cwd: string,owner: ProcessOwner={}) {
    this.native=windowsOwnershipModule();const operationId=randomUUID();
    this.record={schema:"bunny-owned-operation/1",operationId,containerId:operationId,mechanism:"windows-job-object",missionId:owner.missionId??null,stepId:owner.stepId??null,capabilityRunId:owner.capabilityRunId??null,launcherPath:file,launcherPid:0,launcherCreatedAt:0,members:[],startedAt:Date.now(),endedAt:null,repo:cwd,cwd,action:owner.action??"git",state:"running",exitCode:null,killOnClose:true,breakaway:false,closed:false};
    this.path=recordPath(owner,operationId);owner.records?.push(this.record);
    persist(this.path,this.record);
  }
  spawn(file: string,args: string[],cwd: string,env: NodeJS.ProcessEnv,out: string,err: string) {
    if(this.handle) throw new Error("An ownership group can spawn only one root.");
    this.handle=this.native.launch(file,[file,...args].map(windowsArgument).join(" "),cwd,windowsEnvironment(env),out,err);
    this.release=trackOwnedGroup(()=>{if(this.stopping)this.stopping();else this.close("stopped");});
    try {this.inspect();persist(this.path,this.record);} catch(error){this.close("failed");throw error;}
  }
  inspect() {
    if(!this.handle) throw new Error("No live ownership handle.");
    const snapshot=this.native.inspect(this.handle);
    if(snapshot.limitFlags!==0x2000) throw new Error("Git ownership limits changed; breakaway or missing kill-on-close was detected.");
    this.record.launcherPid=snapshot.launcherPid;this.record.launcherCreatedAt=snapshot.launcherCreatedAt;
    this.record.exitCode=snapshot.exitCode;
    let changed=false;
    for(const member of snapshot.members) if(!this.record.members.some(old=>old.pid===member.pid&&old.createdAt===member.createdAt)){this.record.members.push(member);changed=true;}
    if(changed) persist(this.path,this.record);
    return snapshot;
  }
  close(state: OwnedProcessRecord["state"]) {
    if(this.record.closed)return;
    if(this.handle){this.native.close(this.handle);this.handle=null;}
    this.release();this.record.state=state;this.record.closed=true;this.record.endedAt=Date.now();persist(this.path,this.record);
  }
  inspectHistory(){return structuredClone(this.record);}
  onStop(stop: () => void){this.stopping=stop;}
}
export async function runWindowsOwnedProcess(file: string,args: string[],options: {cwd:string;signal:AbortSignal;timeoutMs:number;maxOutput?:number;env?:NodeJS.ProcessEnv;owner?:ProcessOwner}) {
  if(options.signal.aborted) throw new Error("Aborted before start.");
  const started=Date.now(),max=options.maxOutput??200_000;
  let stdout="",stderr="",timedOut=false,aborted=false;
  const append=(current:string,chunk:Buffer)=>(current+chunk.toString("utf8")).slice(0,max);
  const out=await outputPipe(chunk=>{stdout=append(stdout,chunk);});
  let err: Awaited<ReturnType<typeof outputPipe>> | undefined,group: OwnedProcessGroup | undefined;
  try {
    err=await outputPipe(chunk=>{stderr=append(stderr,chunk);});
    if(options.signal.aborted) throw new Error("Aborted before start.");
    group=new OwnedProcessGroup(file,options.cwd,options.owner);
    group.spawn(file,args,options.cwd,options.env??process.env,out.name,err.name);
    let exitCode:number|null=null;
    await new Promise<void>((done,reject)=>{
      let finished=false;
      const finish=(state:OwnedProcessRecord["state"],error?:unknown)=>{
        if(finished)return;finished=true;clearInterval(poll);clearTimeout(timer);options.signal.removeEventListener("abort",stop);
        try{group!.close(state);}catch(caught){error??=caught;}
        if(error)reject(error);else done();
      };
      const stop=()=>{if(/timed out/i.test(String(options.signal.reason))){timedOut=true;finish("timeout");}else{aborted=true;finish("stopped");}};
      group!.onStop(stop);
      const timer=setTimeout(()=>{timedOut=true;finish("timeout");},Math.max(1,options.timeoutMs-(Date.now()-started)));
      const poll=setInterval(()=>{try{const snapshot=group!.inspect();if(snapshot.exitCode!==null){exitCode=snapshot.exitCode;finish(exitCode===0?"succeeded":"failed");}}catch(error){finish("failed",error);}},40);
      options.signal.addEventListener("abort",stop,{once:true});
      if(options.signal.aborted)stop();
    });
    await Promise.all([out.close(),err.close()]);
    return {exitCode,stdout,stderr,durationMs:Date.now()-started,timedOut,aborted,ownership:group.inspectHistory()};
  } catch(error) {
    group?.close("failed");await Promise.all([out.close(),err?.close()]);throw error;
  }
}

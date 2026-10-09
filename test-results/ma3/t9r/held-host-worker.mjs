// Test-only scheduling barrier. Real Host admission, adapter and filesystem remain authoritative.
import {startHost} from '../../../src/lib/bunny-host/http.server.ts';
import {FilesystemCapability,GitCapability,TerminalCapability} from '../../../src/lib/bunny-missions/capabilities/local.server.ts';
const [dataDirectory,workspaceRoot,port]=process.argv.slice(2);
delete process.env.BUNNY_STATE_LAYOUT;delete process.env.BUNNY_RELEASE_ROOT;delete process.env.BUNNY_HOST_WORKSPACE;
let release;const barrier=new Promise(done=>{release=done;});let released=false;
class HeldFilesystem extends FilesystemCapability {
 async execute(action,params,context){
  if(action==='filesystem.write'&&!released){process.send({kind:'held-write',missionId:context.missionId,capabilityRunId:context.capabilityRunId,path:params.path});await barrier;context.signal.throwIfAborted();}
  return super.execute(action,params,context);
 }
}
const host=await startHost({dataDirectory,root:workspaceRoot,workspaceRoot,port:Number(port),adapters:[],missions:{adapters:[new HeldFilesystem(),new GitCapability(dataDirectory),new TerminalCapability()]},sample:async()=>({at:Date.now(),cpu:{utilization:null,clockMhz:null,temperatureC:null},memory:{usedBytes:0,availableBytes:1,totalBytes:1},gpus:[],notes:['T9R test scheduling barrier']})});
await host.missions.bus.refreshHealth();
process.on('message',message=>{if(message==='release-held'){released=true;release();}else if(message==='close'){release();void host.close().then(()=>process.exit(0));}});
process.send({token:host.token,pid:process.pid,generation:host.manager.instanceId});

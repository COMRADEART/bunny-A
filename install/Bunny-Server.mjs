import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { HostContainment } from "./src/lib/bunny-host/failure.server.ts";
import { assertApplicationDirectory } from "./src/lib/bunny-host/state-paths.server.ts";
if(process.env.BUNNY_STATE_LAYOUT!=="2" || !process.env.BUNNY_HOST_CREDENTIALS_FILE || !process.env.BUNNY_REMOTE_CONFIG) throw new Error("Start the installed gateway through Start-Bunny-Release.ps1. Installed state must be configured explicitly.");
import { desktopManifest, allowedOrigins, requestAllowed } from "./manifest.mjs";
import { releaseIdentity } from "./src/lib/bunny-host/release-identity.server.ts";
const installedIdentity=releaseIdentity(new URL("./release-manifest.json",import.meta.url));

const remotePath=resolve(process.env.BUNNY_REMOTE_CONFIG ?? "remote.json");
function remoteOrigins() {
  const config=existsSync(remotePath) ? JSON.parse(readFileSync(remotePath,"utf8")) : {};
  const origins=allowedOrigins(config.url,8084);
  if(config.url) process.env.BUNNY_REMOTE_ORIGIN=new URL(config.url).origin;
  else delete process.env.BUNNY_REMOTE_ORIGIN;
  return origins;
}
if(!process.env.BUNNY_HOST_DATA_DIRECTORY) throw new Error("Installed gateway requires an explicit application-data state directory.");
process.env.BUNNY_HOST_DATA_DIRECTORY=resolve(process.env.BUNNY_HOST_DATA_DIRECTORY);
const gatewayState=assertApplicationDirectory(process.cwd());
const containment=new HostContainment({diagnosticDirectory:assertApplicationDirectory(join(gatewayState,"logs/gateway")),runtimeDirectory:assertApplicationDirectory(join(gatewayState,"runtime/gateway")),exit:()=>process.exit(71),shutdown:async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));}});
containment.installProcessHandlers();
const {middleware}=await import("./.output/server/index.mjs");
// M-A-3 T9: the dashboard and the remote companion are never framed (approval clickjacking) and never leak a referrer.
const SECURITY_HEADERS={"x-frame-options":"DENY","content-security-policy":"frame-ancestors 'none'","referrer-policy":"no-referrer"};
const handler=async(req,res)=>{
  for(const [name,value] of Object.entries(SECURITY_HEADERS)) res.setHeader(name,value);
  const origins=remoteOrigins();
  if(!requestAllowed(req.headers,req.method ?? "GET",origins)) {res.writeHead(403);res.end("Bunny-A origin refused.");return;}
  const path=(req.url ?? "/").split("?")[0];
  if(path === "/bunny-health" && req.method === "GET") {const local=["127.0.0.1:8084","localhost:8084"].includes(req.headers.host);res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(local ? {app:"Bunny-A",pid:process.pid,root:process.cwd(),gatewayOperationalState:containment.health.operationalState,release:installedIdentity} : {app:"Bunny-A"}));return;}
  if(["/__grok/manifest.webmanifest","/__grok/manifest.json"].includes(path)) {res.writeHead(200,{"content-type":"application/manifest+json"});res.end(JSON.stringify(desktopManifest));return;}
  await middleware(req,res);
};
const server=createServer((req,res)=>{
  res.on("error",()=>res.destroy());
  containment.background({subsystem:"gateway-request"},()=>handler(req,res),()=>{if(!res.headersSent) res.writeHead(500);res.end("Bunny-A gateway request failed; Host health must be checked independently.");});
});
server.on("error",error=>containment.fatal(error,{subsystem:"gateway"}));
server.listen(8084,"127.0.0.1",()=>console.log("Bunny-A dashboard ready."));

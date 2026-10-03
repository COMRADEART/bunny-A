import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
if(process.env.BUNNY_STATE_LAYOUT!=="2" || !process.env.BUNNY_HOST_CREDENTIALS_FILE || !process.env.BUNNY_REMOTE_CONFIG) throw new Error("Start the installed gateway through Start-Bunny-Release.ps1. Installed state must be configured explicitly.");
import { desktopManifest, allowedOrigins, requestAllowed } from "./manifest.mjs";

const remotePath=resolve(process.env.BUNNY_REMOTE_CONFIG ?? "remote.json");
function remoteOrigins() {
  const config=existsSync(remotePath) ? JSON.parse(readFileSync(remotePath,"utf8")) : {};
  const origins=allowedOrigins(config.url,8084);
  if(config.url) process.env.BUNNY_REMOTE_ORIGIN=new URL(config.url).origin;
  else delete process.env.BUNNY_REMOTE_ORIGIN;
  return origins;
}
process.env.BUNNY_HOST_DATA_DIRECTORY=resolve(process.env.BUNNY_HOST_DATA_DIRECTORY ?? ".bunny-a");
const {middleware}=await import("./.output/server/index.mjs");
const server=createServer(async(req,res)=>{
  const origins=remoteOrigins();
  if(!requestAllowed(req.headers,req.method ?? "GET",origins)) {res.writeHead(403);res.end("Bunny-A origin refused.");return;}
  const path=(req.url ?? "/").split("?")[0];
  if(path === "/bunny-health" && req.method === "GET") {const local=["127.0.0.1:8084","localhost:8084"].includes(req.headers.host);res.writeHead(200,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(local ? {app:"Bunny-A",pid:process.pid,root:process.cwd()} : {app:"Bunny-A"}));return;}
  if(["/__grok/manifest.webmanifest","/__grok/manifest.json"].includes(path)) {res.writeHead(200,{"content-type":"application/manifest+json"});res.end(JSON.stringify(desktopManifest));return;}
  try {await middleware(req,res);} catch(error) {console.error(error);if(!res.headersSent) res.writeHead(500);res.end("Bunny-A dashboard request failed.");}
});
server.listen(8084,"127.0.0.1",()=>console.log("Bunny-A dashboard ready."));

// Harmless local-only process tree used by T4 regression/live verification.
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
const [mode, log, depth = "0"] = process.argv.slice(2);
const record = (type, pid=process.pid) => appendFileSync(log,JSON.stringify({type,pid,at:Date.now()})+"\n");
record(mode);
const child = (kind,detached=false) => {
  const processChild=spawn(process.execPath,[process.argv[1],kind,log,String(Number(depth)+1)],{detached,windowsHide:true,stdio:detached?"ignore":"inherit"});
  record("spawned",processChild.pid);return processChild;
};
if(mode==="fail") process.exitCode=7;
else if(mode==="normal") console.log("harmless hook completed");
else if(mode==="exit-child"||mode==="detached") child("sleep",mode==="detached").unref();
else if(mode==="nested"&&Number(depth)<2) await new Promise(done=>child("nested").once("exit",done));
else if(mode==="wait-child") await new Promise(done=>child("sleep").once("exit",done));
else {
  const timer=mode==="output"?setInterval(()=>{process.stdout.write("child stdout\n");process.stderr.write("child stderr\n");},5):null;
  await new Promise(done=>setTimeout(done,Number(process.env.BUNNY_T4_SLEEP_MS??30_000)));
  if(timer)clearInterval(timer);
  record("delayed-completion");
}

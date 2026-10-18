// Android's official QR pairing format: https://android.googlesource.com/platform/packages/modules/adb/+/HEAD/docs/dev/adb_wifi.md
// Session credentials and QR pixels stay in memory; only sanitized status is written.
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import QRCode from './local-tools/node_modules/qrcode/lib/index.js';
const out = import.meta.dirname;
const adb = resolve(out, '../../android-tools/platform-tools/adb.exe');
const instance = 'studio-' + randomBytes(8).toString('hex');
let password = randomBytes(20).toString('hex');
let png = await QRCode.toBuffer(`WIFI:T:ADB;S:${instance};P:${password};;`, { type:'png', errorCorrectionLevel:'M', margin:4, width:560 });
let status = 'waiting-for-scan';
let busy = false;
const started = Date.now();
const commands = [];
function record() { writeFileSync(join(out,'qr-session.json'),JSON.stringify({recordedAt:new Date().toISOString(),status,commands,credentialRetained:false,qrRetained:false,identifiersRetained:false,expiresAfterSeconds:300},null,2)+'\n'); }
function run(args, input) {
  return new Promise((resolveResult,reject) => {
    const child = spawn(adb,args,{windowsHide:true,stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='';
    const timer=setTimeout(()=>child.kill(),10000);
    child.stdout.on('data',b=>stdout+=b); child.stderr.on('data',b=>stderr+=b);
    child.on('error',reject);
    child.on('close',exit=>{clearTimeout(timer);resolveResult({exit,stdout,stderr});});
    child.stdin.on('error',()=>{});
    child.stdin.end(input ? input+'\n' : '');
  });
}
const server=createServer((req,res)=>{
  if(req.headers.host!==`127.0.0.1:${server.address().port}`){res.writeHead(403);res.end();return;}
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');
  if(req.method!=='GET'){res.writeHead(405);res.end();return;}
  if(req.url==='/qr.png') {if(!png){res.writeHead(410);res.end();return;}res.writeHead(200,{'Content-Type':'image/png'});res.end(png);return;}
  if(req.url==='/status'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({status}));return;}
  if(req.url!=='/'){res.writeHead(404);res.end();return;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});
  res.end(`<!doctype html><html><head><title>Pair Android with this laptop</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font:18px system-ui;text-align:center;background:#fff;color:#162332;margin:28px auto;max-width:650px;padding:12px}img{width:min(100%,440px);image-rendering:pixelated}p{line-height:1.5}#status{font-weight:650;color:#20553b}</style></head><body><h1>Pair your Android phone</h1><p>On your phone: <b>Developer options → Wireless debugging → Pair device with QR code</b>. Scan below.</p><img src="/qr.png" alt="Temporary Android debugging pairing QR code"><p id="status">Waiting for your scan…</p><p>This code expires in five minutes. It authorizes Android debugging on this laptop.</p><script>const t=setInterval(async()=>{try{const r=await fetch('/status');const s=(await r.json()).status;document.getElementById('status').textContent=s.replaceAll('-',' ');if(s==='paired'||s==='expired'){clearInterval(t);document.querySelector('img').remove()}}catch{}},1000)</script></body></html>`);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
console.log(JSON.stringify({localPage:`http://127.0.0.1:${server.address().port}/`,expiresAfterSeconds:300,credentialsLogged:false}));
record();
const timer=setInterval(async()=>{
  if(busy)return;
  if(Date.now()-started>300_000){clearInterval(timer);password='';png=null;status='expired';record();setTimeout(()=>server.close(),30000);return;}
  busy=true;
  try{
    const found=await run(['mdns','services']);
    const line=found.stdout.split(/\r?\n/).find(l=>l.startsWith(instance)&&l.includes('_adb-tls-pairing._tcp'));
    const endpoint=line?.match(/\b((?:\d{1,3}\.){3}\d{1,3}:\d+)\s*$/)?.[1];
    if(endpoint){
      status='pairing';record();
      const pair=await run(['pair',endpoint],password);
      commands.push({command:'adb pair <QR-selected-phone> (credential via stdin)',exitCode:pair.exit,recordedAt:new Date().toISOString()});
      if(pair.exit===0&&pair.stdout.includes('Successfully paired')){status='paired';password='';png=null;clearInterval(timer);record();setTimeout(()=>server.close(),60000);}
      else {status='pairing-failed';password='';png=null;clearInterval(timer);record();setTimeout(()=>server.close(),60000);}
    }
  }catch(e){status='discovery-error';record();}finally{busy=false;}
},1500);

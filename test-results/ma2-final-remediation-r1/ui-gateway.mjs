import {createServer} from 'node:http';import {readFileSync} from 'node:fs';import {join} from 'node:path';import {pathToFileURL} from 'node:url';
const installRoot=join(process.env.LOCALAPPDATA,'Bunny-A-R1-stage'),config=JSON.parse(readFileSync(join(installRoot,'install.json'),'utf8'));
if(config.currentRelease.name!=='Bunny-A-Windows-v26-MA2-R1')throw new Error('Wrong candidate');
process.env.BUNNY_STATE_LAYOUT='2';process.env.BUNNY_HOST_DATA_DIRECTORY=join(installRoot,'state');process.env.BUNNY_HOST_CREDENTIALS_FILE=join(installRoot,'state/credentials/credentials.json');delete process.env.BUNNY_REMOTE_ORIGIN;
process.chdir(config.currentRelease.folder);const {middleware}=await import(pathToFileURL(join(config.currentRelease.folder,'.output/server/index.mjs')).href);
const server=createServer(async(req,res)=>{if(!['127.0.0.1:8089','localhost:8089'].includes(req.headers.host)||req.headers['x-forwarded-for']||req.headers['cf-connecting-ip']){res.writeHead(403);res.end('QA loopback only');return;}try{await middleware(req,res);}catch{res.writeHead(500);res.end('Staged dashboard unavailable');}});
server.listen(8089,'127.0.0.1',()=>console.log('Exact installed v26 dashboard on isolated loopback port'));

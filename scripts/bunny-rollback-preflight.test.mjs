import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { idleCheck } from './bunny-rollback-preflight.mjs';
async function fixture(work) {
 const root=mkdtempSync(join(tmpdir(),'bunny-t10-rollback-'));
 const db=new DatabaseSync(join(root,'host.sqlite'));
 db.exec('CREATE TABLE tasks(record TEXT);CREATE TABLE missions(record TEXT);CREATE TABLE capability_runs(record TEXT);CREATE TABLE approval_batches(record TEXT);CREATE TABLE settings(key TEXT,value TEXT)');
 db.prepare('INSERT INTO settings VALUES (?,?)').run('missions_config',JSON.stringify({enabled:false,triggersEnabled:false}));
 const server=createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({missions:{enabled:false,missions:[]},tasks:[]}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try {await work({root,db,port:server.address().port});}finally{server.closeAllConnections();await new Promise(r=>server.close(r));db.close();rmSync(root,{recursive:true,force:true});}
}
test('T10-XG-06: rollback refuses a paused Mission with a live desktop grant, even outside the snapshot page',async()=>fixture(async({db,root,port})=>{
 db.prepare('INSERT INTO missions VALUES (?)').run(JSON.stringify({id:'paused',state:'waiting_for_user'}));
 db.prepare('INSERT INTO approval_batches VALUES (?)').run(JSON.stringify({id:'grant',status:'active',expiresAt:Date.now()+120000}));
 await assert.rejects(idleCheck(port,'fixture',root),/active-work.*"missions":1.*"grants":1/);
}));
test('T10 rollback preflight preserves the idle positive control, and refuses enabled scheduling',async()=>fixture(async({db,root,port})=>{
 assert.equal((await idleCheck(port,'fixture',root)).idle,true);
 db.prepare('UPDATE settings SET value=?').run(JSON.stringify({enabled:true,triggersEnabled:false}));
 await assert.rejects(idleCheck(port,'fixture',root),/missionsEnabled":true/);
}));
test('T10 rollback preflight refuses orphan grant and interrupted or waiting work independently',async()=>fixture(async({db,root,port})=>{
 db.prepare('INSERT INTO approval_batches VALUES (?)').run(JSON.stringify({status:'active',expiresAt:Date.now()+120000}));
 await assert.rejects(idleCheck(port,'fixture',root),/"grants":1/);db.exec('DELETE FROM approval_batches');
 db.prepare('INSERT INTO tasks VALUES (?)').run(JSON.stringify({id:'waiting',state:'waiting_for_approval'}));
 await assert.rejects(idleCheck(port,'fixture',root),/"tasks":1/);db.exec('DELETE FROM tasks');
 db.prepare('INSERT INTO missions VALUES (?)').run(JSON.stringify({state:'interrupted'}));
 await assert.rejects(idleCheck(port,'fixture',root),/"missions":1/);
}));

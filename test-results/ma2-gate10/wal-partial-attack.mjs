import assert from'node:assert/strict';
import{DatabaseSync}from'node:sqlite';
import{mkdtempSync,copyFileSync,writeFileSync,rmSync}from'node:fs';
import{tmpdir}from'node:os';import{join}from'node:path';
import{snapshotDatabase}from'../../scripts/bunny-state-migration.mjs';
const root=mkdtempSync(join(tmpdir(),'bunny-t10-wal-')),path=join(root,'host.sqlite'),db=new DatabaseSync(path);
try{
 db.exec('PRAGMA journal_mode=WAL;PRAGMA wal_autocheckpoint=0;PRAGMA user_version=3;CREATE TABLE user_rows(id TEXT PRIMARY KEY,value TEXT);INSERT INTO user_rows VALUES (\'old\',\'preserved\');PRAGMA wal_checkpoint(TRUNCATE)');
 copyFileSync(path,join(root,'stale.sqlite'));db.exec("INSERT INTO user_rows VALUES ('new','committed in WAL')");copyFileSync(path,join(root,'main-only.sqlite'));
 const counts=[];for(const name of ['stale.sqlite','main-only.sqlite']){const partial=new DatabaseSync(join(root,name),{readOnly:true});assert.equal(partial.prepare('PRAGMA quick_check').get().quick_check,'ok');const count=partial.prepare('SELECT COUNT(*) AS n FROM user_rows').get().n;assert.equal(count,1);counts.push({copy:name,sqliteValid:true,rowCount:count,expectedCommittedRows:2,ledgerDetectsMissingRow:true,sqliteAloneDetectsMissingHistory:false});partial.close();}
 snapshotDatabase(path,join(root,'consistent.sqlite'));const complete=new DatabaseSync(join(root,'consistent.sqlite'),{readOnly:true});assert.equal(complete.prepare('SELECT COUNT(*) AS n FROM user_rows').get().n,2);complete.close();
 writeFileSync('test-results/ma2-gate10/wal-partial-attack.json',JSON.stringify({recordedAt:new Date().toISOString(),classification:'DISPOSABLE LIVE',attackId:'T10-T1-04',consistentSnapshotCommittedWalRows:2,counts,productionTouched:false},null,2)+'\n');
}finally{db.close();rmSync(root,{recursive:true,force:true});}

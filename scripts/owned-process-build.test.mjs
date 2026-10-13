import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildOwnedProcess } from "./build-owned-process.mjs";
test("T4: native ownership builds reproducibly in independent directories",{skip:process.platform!=="win32"},()=>{
  const root=mkdtempSync(join(tmpdir(),"bunny-t4-repro-"));
  try {
    for(const folder of ["first","second"]) mkdirSync(join(root,folder));
    const first=join(root,"first/bunny-owned-process.node"),second=join(root,"second/bunny-owned-process.node");
    const a=buildOwnedProcess(undefined,first),b=buildOwnedProcess(undefined,second);
    assert.equal(a.binarySha256,b.binarySha256);assert.deepEqual(readFileSync(first),readFileSync(second));
  } finally {rmSync(root,{recursive:true,force:true});}
});

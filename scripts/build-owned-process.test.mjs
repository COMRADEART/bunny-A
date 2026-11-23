import assert from "node:assert/strict";
import test from "node:test";
import { delimiter, dirname, join } from "node:path";
import { compilerCommandEnv } from "./build-owned-process.mjs";

test("compilerCommandEnv searches the compiler directory before any other toolchain", () => {
  const compiler = join("/toolchains/ucrt64/bin", "gcc.exe");
  const bin = dirname(compiler);
  const git = "/toolchains/git/usr/bin";
  const env = compilerCommandEnv(compiler, { PATH: `${git}${delimiter}${bin}${delimiter}${git}`, Path: "stale" });
  const entries = env.PATH.split(delimiter);
  assert.equal(entries[0], bin);
  assert.equal(env.Path, env.PATH);
  assert.deepEqual(entries.filter(entry => entry.toLowerCase() === bin.toLowerCase()), [bin]);
  assert.deepEqual(entries.filter(entry => entry === git), [git, git]);
});

test("compilerCommandEnv still names the compiler directory when PATH is unset", () => {
  const compiler = join("/toolchains/ucrt64/bin", "gcc.exe");
  const env = compilerCommandEnv(compiler, {});
  assert.equal(env.PATH, dirname(compiler));
  assert.equal(env.Path, env.PATH);
});

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { delimiter, dirname, resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

/** cc1.exe does not sit next to its DLLs. Another toolchain earlier on PATH (Git's MinGW, for example)
 * makes a newer GCC exit 1 with an empty stderr. The compiler directory has to be searched first. */
export function compilerCommandEnv(compiler, env = process.env) {
  const bin = dirname(compiler);
  const current = env.PATH ?? env.Path ?? "";
  const entries = current.split(delimiter).filter(entry => entry && entry.toLowerCase() !== bin.toLowerCase());
  const path = [bin, ...entries].join(delimiter);
  return { ...env, PATH: path, Path: path };
}

export function buildOwnedProcess(root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), output = resolve(root, "native/bunny-owned-process.node")) {
  if (process.platform !== "win32") return { applicable: false };
  if (process.arch !== "x64") throw new Error("The reviewed Windows ownership build targets x64; other architectures fail closed.");
  const compiler = process.env.BUNNY_NATIVE_CC || "C:\\msys64\\ucrt64\\bin\\gcc.exe";
  if (!existsSync(compiler)) throw new Error("A local MinGW-w64 GCC compiler is required. No prebuilt ownership module is downloaded.");
  const source = resolve(root, "native/bunny-owned-process.c");
  const flags = ["-std=c11", "-O2", "-Wall", "-Wextra", "-Werror", "-shared", "-s", "-static-libgcc", "-Wl,--no-insert-timestamp", "-Wl,--image-base,0x180000000", "-Wl,--nxcompat", "-Wl,--dynamicbase"];
  mkdirSync(dirname(output), { recursive: true });
  const sha = p => createHash("sha256").update(readFileSync(p)).digest("hex");
  const temporary=mkdtempSync(join(dirname(output),".bunny-native-build-"));
  const commandEnv = compilerCommandEnv(compiler);
  let binarySha256;
  try {
    const compiled=join(temporary,basename(output));
    try {
      execFileSync(compiler, [...flags, source, "-o", compiled], { windowsHide: true, stdio: "pipe", env: commandEnv });
    } catch (error) {
      const detail = [error.stderr, error.stdout].map(chunk => chunk?.toString?.().trim()).filter(Boolean).join("\n");
      throw new Error(detail ? `owned-process compile failed:\n${detail}` : error.message);
    }
    binarySha256=sha(compiled);
    // Loaded Windows DLLs cannot be overwritten. Identical builds need no write.
    if(!existsSync(output)||sha(output)!==binarySha256) writeFileSync(output,readFileSync(compiled));
  } finally {rmSync(temporary,{recursive:true,force:true});}
  const proof = { schema: "bunny-native-build/1", architecture: "windows-x64", nodeApi: 8, sourceSha256: sha(source), binarySha256, compilerSha256: sha(compiler), compilerVersion: execFileSync(compiler,["--version"],{encoding:"utf8", env: commandEnv}).split(/\r?\n/)[0], flags };
  writeFileSync(output + ".json", JSON.stringify(proof, null, 2) + "\n");
  return proof;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(buildOwnedProcess(process.argv[2], process.argv[3])));

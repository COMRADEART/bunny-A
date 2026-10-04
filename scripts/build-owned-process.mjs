import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname, resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";

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
  let binarySha256;
  try {
    const compiled=join(temporary,basename(output));
    execFileSync(compiler, [...flags, source, "-o", compiled], { windowsHide: true, stdio: "pipe" });
    binarySha256=sha(compiled);
    // Loaded Windows DLLs cannot be overwritten. Identical builds need no write.
    if(!existsSync(output)||sha(output)!==binarySha256) writeFileSync(output,readFileSync(compiled));
  } finally {rmSync(temporary,{recursive:true,force:true});}
  const proof = { schema: "bunny-native-build/1", architecture: "windows-x64", nodeApi: 8, sourceSha256: sha(source), binarySha256, compilerSha256: sha(compiler), compilerVersion: execFileSync(compiler,["--version"],{encoding:"utf8"}).split(/\r?\n/)[0], flags };
  writeFileSync(output + ".json", JSON.stringify(proof, null, 2) + "\n");
  return proof;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(buildOwnedProcess(process.argv[2], process.argv[3])));

import { readFileSync, realpathSync } from "node:fs";
import { join, relative, isAbsolute } from "node:path";
import { execOwnedFile } from "./owned-processes.server.ts";
import type { OrchTask, VerifySpec } from "../orch/types.ts";
const exec=execOwnedFile;
function safeFile(root:string,name:string) {const path=realpathSync(join(root,name));const rel=relative(realpathSync(root),path);if(rel.startsWith("..") || isAbsolute(rel)) throw new Error("Verification file escapes execution root.");return path;}
export async function verifyTask(task:OrchTask,kind:string):Promise<{passed:boolean;detail:string}> {
  if(task.state!=="completed" || !task.cwd) throw new Error("Only completed tasks with a known execution root can be verified.");
  if(kind === "file") {
    const path=safeFile(task.cwd,"bunny_agent_test.txt");const contents=readFileSync(path,"utf8");
    if(contents.trimEnd()!=="Bunny-A agent execution verified") throw new Error("Disk read-back failed.");
    return {passed:true,detail:`Disk read-back: ${path}\n${contents}`};
  }
  if(kind === "python") {
    const path=safeFile(task.cwd,"hello.py");
    if(readFileSync(path,"utf8").trim()!=='print("BUNNY_A_OK")') throw new Error("Verification refuses unexpected Python source.");
    const result=await exec("python",[path],{cwd:task.cwd,windowsHide:true,timeout:10000});
    if(result.stdout.trim()!=="BUNNY_A_OK") throw new Error("stdout verification failed.");
    return {passed:true,detail:"stdout=BUNNY_A_OK; exit_code=0 (independently executed by Host)."};
  }
  throw new Error("Unsupported independent verification kind.");
}

/** Shape rules for a verification request; anything else is refused before a task is created. */
export function validateVerifySpec(value: unknown): VerifySpec | null {
  if (value == null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid verification request.");
  const input = value as Record<string, unknown>;
  const name = input.name, expected = input.expected;
  if (typeof name !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,79}$/.test(name) || name.includes("..")) throw new Error("Verification file must be a plain file name inside the project folder.");
  if (input.kind === "file") {
    if (typeof expected !== "string" || !expected.length || expected.length > 2000) throw new Error("Expected file contents are required (up to 2,000 characters).");
    return { kind: "file", name, expected };
  }
  if (input.kind === "python") {
    if (!/\.py$/.test(name)) throw new Error("Python verification needs a .py file.");
    if (typeof expected !== "string" || !/^[A-Za-z0-9_ .:-]{1,80}$/.test(expected)) throw new Error("Expected stdout must be plain text (letters, digits, spaces and _ . : -).");
    return { kind: "python", name, expected };
  }
  throw new Error("Unsupported verification kind.");
}

/**
 * Bunny-A's own check after the agent exits: it reads the file from disk itself, or runs the
 * one-line script itself. Agent-written code other than the exact expected one-liner is never executed.
 */
export async function verifySpec(task: OrchTask, spec: VerifySpec): Promise<{ passed: boolean; detail: string }> {
  if (!task.cwd) return { passed: false, detail: "No execution root recorded." };
  let path: string;
  try { path = safeFile(task.cwd, spec.name); } catch (error) { return { passed: false, detail: `${spec.name} not found in ${task.cwd}: ${error instanceof Error ? error.message : String(error)}` }; }
  const contents = readFileSync(path, "utf8");
  if (spec.kind === "file") {
    const exact = contents === spec.expected;
    return { passed: exact, detail: `Bunny-A read ${path} from disk: ${JSON.stringify(contents)} (${Buffer.byteLength(contents)} bytes). ${exact ? "Exact match" : `Does not exactly match ${JSON.stringify(spec.expected)}`}.` };
  }
  const source = `print("${spec.expected}")`;
  if (contents.trim() !== source) return { passed: false, detail: `Refused to execute ${path}: its source is not exactly ${source} (found ${JSON.stringify(contents.slice(0, 200))}).` };
  try {
    const result = await exec("python", [path], { cwd: task.cwd, windowsHide: true, timeout: 15000 });
    const stdout = result.stdout.trim();
    return { passed: stdout === spec.expected, detail: `Bunny-A ran python ${path}: stdout=${JSON.stringify(stdout)}, exit_code=0.` };
  } catch (error) {
    const failure = error as { code?: number | string; stdout?: string; stderr?: string };
    return { passed: false, detail: `Bunny-A ran python ${path}: exit_code=${failure.code ?? "unknown"}, stderr=${JSON.stringify(String(failure.stderr ?? "").slice(0, 300))}.` };
  }
}

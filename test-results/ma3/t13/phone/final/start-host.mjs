// Starts the disposable T13 phone Host (same data and workspace, port 43890) detached and prints its pid.
import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
const repo = resolve(import.meta.dirname, "../../../../..");
const SCR = "C:/Users/allam/AppData/Local/Temp/claude/C--Users-allam-Documents-new-bun-router/35b0c361-0c81-44b1-8728-b68995af842f/scratchpad/t13-phone-final-host";
const child = spawn(process.execPath, ["--experimental-strip-types", join(repo, "scripts/fixtures/project-host-worker.mjs"), `${SCR}/state`, `${SCR}/workspace`, "43890"], { cwd: repo, stdio: "ignore", windowsHide: true, detached: true });
child.unref();
console.log(child.pid);

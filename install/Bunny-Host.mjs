import { runHostEntry } from "./src/lib/bunny-host/entry.server.ts";
import { assertApplicationDirectory } from "./src/lib/bunny-host/state-paths.server.ts";
if(process.env.BUNNY_STATE_LAYOUT!=="2" || !process.env.BUNNY_HOST_DATA_DIRECTORY || !process.env.BUNNY_HOST_WORKSPACE) throw new Error("Start the installed Host through Start-Bunny-Release.ps1. Installed state and workspace must be configured explicitly.");
export const host = await runHostEntry({root:assertApplicationDirectory(process.env.BUNNY_HOST_WORKSPACE)});

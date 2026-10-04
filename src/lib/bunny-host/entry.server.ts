import { join } from "node:path";
import { HostContainment } from "./failure.server.ts";
import { assertApplicationDirectory, developmentStateDirectory } from "./state-paths.server.ts";
import { startHost } from "./http.server.ts";
import { recoverOwnedGitOperations } from "./owned-process-group.server.ts";

/** Both source and installed entry points install the real process policy before starting any async Host work. */
export async function runHostEntry(options: Parameters<typeof startHost>[0] = {}) {
  const data = assertApplicationDirectory(
    options.dataDirectory ?? process.env.BUNNY_HOST_DATA_DIRECTORY ?? developmentStateDirectory(),
  );
  const containment = new HostContainment({
    diagnosticDirectory: join(data, "logs"),
    runtimeDirectory: join(data, "runtime"),
  });
  const removeHandlers = containment.installProcessHandlers();
  try {
    recoverOwnedGitOperations(data);
    return await startHost({ ...options, containment, removeProcessHandlers: removeHandlers });
  } catch (error) {
    await containment.fatal(error, { subsystem: "startup" });
    return undefined;
  }
}

import { execFile, type ChildProcess, type ExecFileOptions } from "node:child_process";

/** Live handles created by Bunny only. Persisted PIDs and executable names confer no authority. */
const owned = new Set<ChildProcess>();
export function trackOwnedChild<T extends ChildProcess>(child: T): T {
  owned.add(child);
  const release = () => owned.delete(child);
  child.once("close", release);
  child.once("error", () => {
    if (!child.pid || child.exitCode !== null || child.signalCode !== null) release();
  });
  return child;
}
export function execOwnedFile(
  command: string,
  args: string[],
  options: ExecFileOptions,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    trackOwnedChild(
      execFile(command, args, options, (error, stdout, stderr) => {
        if (error) reject(error);
        else resolve({ stdout: String(stdout), stderr: String(stderr) });
      }),
    );
  });
}
export async function stopOwnedChildren() {
  await Promise.all(
    [...owned].map(async (child) => {
      if (!child.pid || child.exitCode !== null || child.signalCode !== null || !owned.has(child))
        return;
      if (process.platform === "win32")
        await new Promise<void>((done) =>
          execFile(
            "taskkill.exe",
            ["/PID", String(child.pid), "/T", "/F"],
            { windowsHide: true, timeout: 1800 },
            () => {
              done();
            },
          ),
        );
      else
        try {
          child.kill("SIGKILL");
        } catch {
          /* Closed owned handle. */
        }
    }),
  );
}

import { HostContainment } from "../src/lib/bunny-host/failure.server.ts";

/** Bounded owned-worker supervisor. Production retries at 10/20 seconds, then requires an explicit relaunch. */
export async function superviseTunnel({
  start,
  output,
  unavailable,
  signal,
  containment = new HostContainment(),
  maxAttempts = 3,
  delayMs = 10000,
}) {
  let attempts = 0,
    lastExit = null;
  while (!signal?.aborted && attempts < Math.min(maxAttempts, 3)) {
    attempts++;
    let child;
    let stop;
    let outputFailed = false;
    const jobs = new Set();
    try {
      child = start();
      stop = () => {
        try {
          child.kill();
        } catch {
          /* Only the live owned handle is stopped. */
        }
      };
      signal?.addEventListener("abort", stop, { once: true });
      const receive = (chunk) => {
        if (outputFailed) return;
        const job = (async () => {
          try {
            await output(chunk);
          } catch (error) {
            outputFailed = true;
            stop();
            await containment.contain(error, "boundary", {
              owner: { subsystem: "tunnel" },
              failureClass: "SUBSYSTEM_FAILURE",
            });
          }
        })();
        jobs.add(job);
        job
          .then(() => jobs.delete(job))
          .catch((error) => containment.fatal(error, { subsystem: "tunnel" }));
      };
      child.stdout?.on("data", receive);
      child.stderr?.on("data", receive);
      const streamFailure = (error) => {
        outputFailed = true;
        stop();
        containment.background(
          { subsystem: "tunnel" },
          () => {
            throw error;
          },
          undefined,
          "SUBSYSTEM_FAILURE",
        );
      };
      child.stdout?.on("error", streamFailure);
      child.stderr?.on("error", streamFailure);
      lastExit = await new Promise((resolve) => {
        child.once("error", () => resolve(-1));
        child.once("exit", resolve);
      });
      await Promise.all(jobs);
    } catch (error) {
      await containment.contain(error, "boundary", {
        owner: { subsystem: "tunnel" },
        failureClass: "SUBSYSTEM_FAILURE",
      });
    } finally {
      if (stop) {
        signal?.removeEventListener("abort", stop);
        stop();
      }
    }
    try {
      await unavailable(lastExit);
    } catch (error) {
      await containment.contain(error, "boundary", {
        owner: { subsystem: "tunnel" },
        failureClass: "SUBSYSTEM_FAILURE",
      });
    }
    if (signal?.aborted || attempts >= Math.min(maxAttempts, 3)) break;
    await new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, Math.min(delayMs * 2 ** (attempts - 1), 60000));
      signal?.addEventListener("abort", done, { once: true });
    });
  }
  return { attempts, lastExit, recoveryRequired: !signal?.aborted };
}

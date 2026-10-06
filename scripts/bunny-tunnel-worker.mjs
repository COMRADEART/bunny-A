import { HostContainment } from "../src/lib/bunny-host/failure.server.ts";
import { parseRegistrationEvents } from "./bunny-tunnel-state.mjs";

/** Bounded owned-worker supervisor. Production retries at 10/20 seconds, then requires an explicit relaunch.
 *
 * A child that stays alive while its edge registrations decay is a failure too: T6 recorded a live
 * child with 7 registers / 6 unregisters and a single active connection while the public origin
 * served intermittent 530/1033 for ~40 minutes. Health rules watch this child's own registration
 * ledger plus an end-to-end probe, and stop the owned child — the recovery BUNNY_REMOTE.md documents
 * manually, automated and bounded by the same attempt budget. The probe distinguishes a tunnel fault
 * from a gateway fault: an origin that fails directly is not counted against the child, so local
 * Bunny stays independent of remote transport remediation. */
const HEALTH_DEFAULTS = {
  zeroActiveWindowMs: 60000,
  churnWindowMs: 900000,
  churnEventFloor: 7,
  churnActiveFloor: 2,
  checkIntervalMs: 10000,
  probeIntervalMs: 20000,
  probeFailureStreakFloor: 6,
  probeRateSampleFloor: 8,
  probeRateFailureFloor: 0.75,
};

export async function superviseTunnel({
  start,
  output,
  unavailable,
  signal,
  containment = new HostContainment(),
  maxAttempts = 3,
  delayMs = 10000,
  health = null,
}) {
  const policy = health ? { ...HEALTH_DEFAULTS, ...health } : null;
  let attempts = 0,
    lastExit = null;
  const degradations = [];
  while (!signal?.aborted && attempts < Math.min(maxAttempts, 3)) {
    attempts++;
    let child;
    let stop;
    let outputFailed = false;
    let probing = false;
    let lastProbeAt = 0;
    let healthTimer = null;
    const jobs = new Set();
    const startedAt = Date.now();
    const registration = { active: new Set(), registeredTotal: 0, unregisteredTotal: 0 };
    const probeHistory = [];
    let lineBuf = "";
    let lastActiveAt = startedAt;
    let degradeReason = null;
    const updateLedger = (line) => {
      for (const event of parseRegistrationEvents(line)) {
        if (event.kind === "register") {
          registration.active.add(event.connIndex);
          registration.registeredTotal++;
          lastActiveAt = Date.now();
        } else {
          registration.active.delete(event.connIndex);
          registration.unregisteredTotal++;
        }
      }
    };
    const degrade = (reason) => {
      if (degradeReason !== null) return;
      degradeReason = reason;
      const event = {
        at: new Date().toISOString(),
        reason,
        activeCount: registration.active.size,
        registeredTotal: registration.registeredTotal,
        unregisteredTotal: registration.unregisteredTotal,
      };
      degradations.push(event);
      policy?.onDegraded?.(event);
      if (stop) stop();
    };
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
            lineBuf = (lineBuf + String(chunk)).replace(/\r/g, "").slice(-4000);
            const lines = lineBuf.split("\n");
            lineBuf = lines.pop() ?? "";
            for (const line of lines) if (line.trim()) updateLedger(line);
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
      if (policy) {
        const evaluate = () => {
          if (degradeReason !== null) return;
          const activeCount = registration.active.size;
          if (activeCount === 0 && Date.now() - lastActiveAt >= policy.zeroActiveWindowMs) return degrade("zero-active-edge-connections");
          if (Date.now() - startedAt <= policy.churnWindowMs && registration.registeredTotal + registration.unregisteredTotal >= policy.churnEventFloor && activeCount < policy.churnActiveFloor) return degrade("edge-connection-churn");
          let tailStreak = 0;
          for (let index = probeHistory.length - 1; index >= 0; index--) {
            const outcome = probeHistory[index].outcome;
            if (outcome === "public") tailStreak++;
            else if (outcome === "ok" || outcome === "origin") break;
          }
          if (tailStreak >= policy.probeFailureStreakFloor) return degrade("public-endpoint-unreachable");
          if (probeHistory.length >= policy.probeRateSampleFloor) {
            const failures = probeHistory.filter((entry) => entry.outcome === "public").length;
            if (failures / probeHistory.length >= policy.probeRateFailureFloor) return degrade("public-endpoint-degraded");
          }
        };
        healthTimer = setInterval(() => {
          if (probing || degradeReason !== null) return;
          evaluate();
          if (typeof policy.probe === "function" && degradeReason === null && !probing && Date.now() - lastProbeAt >= policy.probeIntervalMs) {
            probing = true;
            lastProbeAt = Date.now();
            Promise.resolve()
              .then(() => policy.probe())
              .then((result) => {
                if (degradeReason !== null) return;
                const outcome = result && typeof result === "object" && "outcome" in result ? result.outcome : result === true ? "ok" : result === false ? "public" : "skip";
                probeHistory.push({ at: Date.now(), outcome });
                if (probeHistory.length > 12) probeHistory.shift();
                evaluate();
              })
              .catch(() => {
                if (degradeReason !== null) return;
                probeHistory.push({ at: Date.now(), outcome: "public" });
                evaluate();
              })
              .finally(() => {
                probing = false;
              });
          }
        }, policy.checkIntervalMs);
      }
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
      if (healthTimer) clearInterval(healthTimer);
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
  return { attempts, lastExit, recoveryRequired: !signal?.aborted, degradations };
}
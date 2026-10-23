// MA4-S2-T1-CI1: summarizes a host-trace log (ci-diag branch scripts/ci/host-trace.mjs) for the failing request:
// which listener accepted the socket it went out on, how long before the send that socket had been destroyed by the
// server, and how long after the restarted Host's listen() the send happened.
//   node docs/ma4-s2-t1-ci1/evidence/analyze-trace.mjs <host-trace-*.log>...
import { readFileSync } from "node:fs";

for (const file of process.argv.slice(2)) {
  const events = readFileSync(file, "utf8").trim().split("\n").map((line) => {
    const a = line.indexOf(" "), b = line.indexOf(" ", a + 1);
    return { t: Date.parse(line.slice(0, a)), e: line.slice(a + 1, b), d: JSON.parse(line.slice(b + 1)) };
  });
  const error = events.find((x) => x.e === "error");
  if (!error) { console.log(file, "| no client error"); continue; }
  const send = events.slice(0, events.indexOf(error)).reverse().find((x) => x.e === "send");
  const owner = events.find((x) => x.e === "server-accepted" && x.d.peer === send.d.local);
  const listeners = events.filter((x) => x.e === "listener-open");
  const restarted = listeners[listeners.length - 1];
  const destroyed = events.find((x) => x.e === "server-socket-destroy" && x.d.peer === send.d.local);
  const accepted = events.filter((x) => x.e === "server-accepted" && x.d.server === restarted.d.server && x.t <= error.t).length;
  console.log([
    file,
    `failing ${send.d.method} ${send.d.path}`,
    `error ${error.d.code}`,
    `socket accepted by listener ${owner?.d.server}`,
    `restarted listener ${restarted.d.server} accepted ${accepted} before the error`,
    `socket destroyed ${destroyed ? send.t - destroyed.t : "?"} ms before the send`,
    `send ${send.t - restarted.t} ms after the restarted listen()`,
  ].join(" | "));
}

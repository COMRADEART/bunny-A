// MA4-S1R3-CI2 diagnostics preload (NODE_OPTIONS=--import <file URL>, with BUNNY_CI_HTTP_TRACE=<dir>): logs every fetch
// connection (local/remote port, open and close) and every request with the local port of the socket that carried it,
// so a failed request shows whether it went out on a fresh connection or on a pooled one from an earlier server.
import diagnostics from "node:diagnostics_channel";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.BUNNY_CI_HTTP_TRACE;
if (dir) {
  const file = join(dir, `http-trace-${process.pid}.log`);
  const log = (event, data) => {
    try {
      appendFileSync(file, `${new Date().toISOString()} ${event} ${JSON.stringify(data)}\n`);
    } catch {}
  };
  diagnostics.subscribe("undici:client:connected", ({ socket }) => {
    const local = socket.localPort;
    log("connected", { local, remote: socket.remotePort });
    socket.once("end", () => log("socket-end", { local }));
    socket.once("close", (hadError) => log("socket-close", { local, hadError }));
  });
  diagnostics.subscribe("undici:client:sendHeaders", ({ request, socket }) => log("send", { local: socket?.localPort, method: request.method, origin: String(request.origin), path: request.path }));
  diagnostics.subscribe("net.server.socket", ({ socket }) => {
    const peer = socket.remotePort;
    log("server-accepted", { peer, local: socket.localPort });
    socket.once("close", (hadError) => log("server-socket-close", { peer, hadError }));
  });
  diagnostics.subscribe("undici:request:error", ({ request, error }) => log("error", { path: request.path, code: error?.code, message: error?.message }));
}

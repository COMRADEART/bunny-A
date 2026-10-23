// MA4-S2-T1-CI1 diagnostics preload (NODE_OPTIONS=--import <file URL>, with BUNNY_CI_HTTP_TRACE=<dir>). Extends the
// CI2 fetch trace with the server side: which listener (by sequence number) accepted each socket, listener open/close,
// each request's method + path (no query, headers or bodies) and response status, and server-side socket close.
// A failed client request then shows whether it went out on a socket the previous Host accepted.
import diagnostics from "node:diagnostics_channel";
import net from "node:net";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.BUNNY_CI_HTTP_TRACE;
if (dir) {
  const file = join(dir, `host-trace-${process.pid}.log`);
  const log = (event, data) => {
    try {
      appendFileSync(file, `${new Date().toISOString()} ${event} ${JSON.stringify(data)}\n`);
    } catch {}
  };
  const ids = new WeakMap();
  const live = new Map(); // server id -> accepted sockets whose 'close' has not fired yet
  let next = 0;
  const id = (server) => (server ? ids.get(server) : undefined);
  const listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args) {
    if (!ids.has(this)) {
      ids.set(this, ++next);
      this.once("listening", () => { const a = this.address(); log("listener-open", { server: id(this), address: a?.address, port: a?.port }); });
      this.once("close", () => log("listener-closed", { server: id(this) }));
      const close = this.close;
      this.close = function (...c) {
        const open = [...(live.get(id(this)) ?? [])].map((s) => ({ peer: s.remotePort, destroyed: s.destroyed }));
        log("listener-close-called", { server: id(this), connections: this._connections, open });
        return close.apply(this, c);
      };
    }
    return listen.apply(this, args);
  };
  diagnostics.subscribe("net.server.socket", ({ socket }) => {
    const peer = socket.remotePort, server = id(socket.server ?? socket._server);
    log("server-accepted", { server, peer, local: socket.localPort });
    if (!live.has(server)) live.set(server, new Set());
    live.get(server).add(socket);
    const destroy = socket.destroy;
    socket.destroy = function (...d) { log("server-socket-destroy", { server, peer }); return destroy.apply(this, d); };
    socket.once("end", () => log("server-socket-end", { server, peer }));
    socket.once("close", (hadError) => { live.get(server)?.delete(socket); log("server-socket-close", { server, peer, hadError }); });
  });
  diagnostics.subscribe("http.server.request.start", ({ request, socket, server }) => log("server-request", { server: id(server), peer: socket?.remotePort, method: request.method, path: String(request.url).split("?")[0] }));
  diagnostics.subscribe("http.server.response.finish", ({ request, response, socket, server }) => log("server-response", { server: id(server), peer: socket?.remotePort, path: String(request.url).split("?")[0], status: response.statusCode }));
  diagnostics.subscribe("undici:client:connected", ({ socket }) => {
    const local = socket.localPort;
    log("connected", { local, remote: socket.remotePort });
    socket.once("end", () => log("socket-end", { local }));
    socket.once("close", (hadError) => log("socket-close", { local, hadError }));
  });
  diagnostics.subscribe("undici:client:sendHeaders", ({ request, socket }) => log("send", { local: socket?.localPort, method: request.method, path: String(request.path).split("?")[0] }));
  diagnostics.subscribe("undici:request:error", ({ request, error }) => log("error", { path: String(request.path).split("?")[0], code: error?.code, message: error?.message }));
  process.once("exit", (code) => log("process-exit", { code }));
}
